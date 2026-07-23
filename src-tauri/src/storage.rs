use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DOCUMENT_FILE: &str = "current.mindmap.json";
const BACKUP_DIRECTORY: &str = "backups";
const CORRUPT_DIRECTORY: &str = "recovery";
const MAX_BACKUPS: usize = 8;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadDocumentResult {
    document: Option<String>,
    recovered_from_backup: bool,
    notice: Option<String>,
}

fn storage_error(action: &str, error: impl std::fmt::Display) -> String {
    format!("{action}: {error}")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDocument {
    format_version: u64,
    title: String,
    root_id: String,
    nodes: HashMap<String, StoredNode>,
    viewport: StoredViewport,
    updated_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNode {
    id: String,
    text: String,
    parent_id: Option<String>,
    children: Vec<String>,
    collapsed: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize)]
struct StoredViewport {
    x: f64,
    y: f64,
    zoom: f64,
}

fn validate_document(document_json: &str) -> Result<(), String> {
    let document: StoredDocument = serde_json::from_str(document_json)
        .map_err(|error| storage_error("思维导图文件不是有效 JSON", error))?;
    let root = document
        .nodes
        .get(&document.root_id)
        .ok_or_else(|| "思维导图文件缺少根节点".to_string())?;
    if document.format_version != 1
        || root.parent_id.is_some()
        || !document.viewport.x.is_finite()
        || !document.viewport.y.is_finite()
        || !document.viewport.zoom.is_finite()
        || document.viewport.zoom <= 0.0
    {
        return Err("思维导图文件版本或根节点无效".to_string());
    }

    let mut visited = HashSet::new();
    let mut pending = vec![document.root_id.as_str()];
    while let Some(id) = pending.pop() {
        if !visited.insert(id) {
            return Err("思维导图节点包含循环或重复引用".to_string());
        }
        let node = document
            .nodes
            .get(id)
            .ok_or_else(|| "思维导图引用了不存在的节点".to_string())?;
        if node.id != id {
            return Err("思维导图节点索引与节点 ID 不一致".to_string());
        }
        for child_id in &node.children {
            let child = document
                .nodes
                .get(child_id)
                .ok_or_else(|| "思维导图引用了不存在的子节点".to_string())?;
            if child.parent_id.as_deref() != Some(id) {
                return Err("思维导图父子关系不一致".to_string());
            }
            pending.push(child_id);
        }
    }
    if visited.len() != document.nodes.len() {
        return Err("思维导图包含无法从根节点访问的节点".to_string());
    }

    // Deserialize every persisted field so truncated node/content records fail
    // before any existing file is replaced.
    let _ = (
        document.title,
        document.updated_at,
        root.text.as_str(),
        root.collapsed,
        root.created_at.as_str(),
        root.updated_at.as_str(),
    );
    Ok(())
}

fn unique_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| storage_error("无法同步本地目录", error))?;
    }
    Ok(())
}

fn write_atomic(directory: &Path, document_json: &str) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| storage_error("无法创建本地数据目录", error))?;
    let target = directory.join(DOCUMENT_FILE);
    let temporary = directory.join(format!(".{DOCUMENT_FILE}.{}.tmp", unique_stamp()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| storage_error("无法创建临时文件", error))?;
        file.write_all(document_json.as_bytes())
            .map_err(|error| storage_error("无法写入临时文件", error))?;
        file.sync_all()
            .map_err(|error| storage_error("无法同步临时文件", error))?;
        fs::rename(&temporary, &target)
            .map_err(|error| storage_error("无法原子替换思维导图文件", error))?;
        sync_directory(directory)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn backup_current(directory: &Path) -> Result<(), String> {
    let current = directory.join(DOCUMENT_FILE);
    let current_json = match fs::read_to_string(&current) {
        Ok(value) => value,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(storage_error("无法读取当前文件以创建备份", error)),
    };
    if validate_document(&current_json).is_err() {
        quarantine_current(directory)?;
        return Ok(());
    }

    let backup_directory = directory.join(BACKUP_DIRECTORY);
    fs::create_dir_all(&backup_directory)
        .map_err(|error| storage_error("无法创建备份目录", error))?;
    let backup = backup_directory.join(format!("origin-{}.mindmap.json", unique_stamp()));
    fs::copy(&current, &backup).map_err(|error| storage_error("无法创建自动备份", error))?;
    File::open(&backup)
        .and_then(|file| file.sync_all())
        .map_err(|error| storage_error("无法同步自动备份", error))?;
    sync_directory(&backup_directory)
}

fn sorted_backups(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let backup_directory = directory.join(BACKUP_DIRECTORY);
    let entries = match fs::read_dir(&backup_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(storage_error("无法读取备份目录", error)),
    };
    let mut backups = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("origin-") && name.ends_with(".mindmap.json"))
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    Ok(backups)
}

fn prune_backups(directory: &Path) -> Result<(), String> {
    for stale in sorted_backups(directory)?.into_iter().skip(MAX_BACKUPS) {
        fs::remove_file(&stale).map_err(|error| storage_error("无法清理旧备份", error))?;
    }
    Ok(())
}

fn quarantine_current(directory: &Path) -> Result<Option<PathBuf>, String> {
    let current = directory.join(DOCUMENT_FILE);
    if !current.exists() {
        return Ok(None);
    }
    let recovery_directory = directory.join(CORRUPT_DIRECTORY);
    fs::create_dir_all(&recovery_directory)
        .map_err(|error| storage_error("无法创建恢复目录", error))?;
    let recovery = recovery_directory.join(format!("unreadable-{}.mindmap.json", unique_stamp()));
    fs::rename(&current, &recovery)
        .map_err(|error| storage_error("无法保留损坏的原文件", error))?;
    sync_directory(&recovery_directory)?;
    Ok(Some(recovery))
}

fn save_to_directory(directory: &Path, document_json: &str) -> Result<(), String> {
    validate_document(document_json)?;
    fs::create_dir_all(directory).map_err(|error| storage_error("无法创建本地数据目录", error))?;
    backup_current(directory)?;
    write_atomic(directory, document_json)?;
    prune_backups(directory)
}

fn load_from_directory(directory: &Path) -> Result<LoadDocumentResult, String> {
    let current = directory.join(DOCUMENT_FILE);
    match fs::read_to_string(&current) {
        Ok(document) if validate_document(&document).is_ok() => {
            return Ok(LoadDocumentResult {
                document: Some(document),
                recovered_from_backup: false,
                notice: None,
            });
        }
        Ok(_) => {
            quarantine_current(directory)?;
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(LoadDocumentResult {
                document: None,
                recovered_from_backup: false,
                notice: None,
            });
        }
        Err(_) => {
            quarantine_current(directory)?;
        }
    }

    for backup in sorted_backups(directory)? {
        let document = match fs::read_to_string(&backup) {
            Ok(document) => document,
            Err(_) => continue,
        };
        if validate_document(&document).is_ok() {
            return Ok(LoadDocumentResult {
                document: Some(document),
                recovered_from_backup: true,
                notice: Some("主文件无法读取，已从最近的自动备份恢复。".to_string()),
            });
        }
    }

    Err("主文件无法读取，且没有可用的自动备份；损坏的原文件已保留。".to_string())
}

#[tauri::command]
pub(crate) async fn load_local_document(app: AppHandle) -> Result<LoadDocumentResult, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    tauri::async_runtime::spawn_blocking(move || load_from_directory(&directory))
        .await
        .map_err(|error| storage_error("读取任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn save_local_document(
    app: AppHandle,
    document_json: String,
) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    tauri::async_runtime::spawn_blocking(move || save_to_directory(&directory, &document_json))
        .await
        .map_err(|error| storage_error("保存任务异常结束", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(title: &str) -> String {
        format!(
            r#"{{"formatVersion":1,"title":"{title}","rootId":"root","nodes":{{"root":{{"id":"root","text":"{title}","parentId":null,"children":[],"collapsed":false,"createdAt":"2026-07-23T00:00:00.000Z","updatedAt":"2026-07-23T00:00:00.000Z"}}}},"viewport":{{"x":0,"y":0,"zoom":1}},"updatedAt":"2026-07-23T00:00:00.000Z"}}"#
        )
    }

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "origin-storage-{name}-{}-{}",
            std::process::id(),
            unique_stamp()
        ))
    }

    #[test]
    fn saves_with_atomic_replacement_and_bounded_backups() {
        let directory = test_directory("save");
        for index in 0..12 {
            save_to_directory(&directory, &document(&format!("版本 {index}")))
                .expect("save should succeed");
        }

        let current =
            fs::read_to_string(directory.join(DOCUMENT_FILE)).expect("current file should exist");
        assert!(current.contains("版本 11"));
        assert_eq!(sorted_backups(&directory).unwrap().len(), MAX_BACKUPS);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recovers_the_latest_valid_backup_and_preserves_corrupt_primary() {
        let directory = test_directory("recover");
        save_to_directory(&directory, &document("第一版")).unwrap();
        save_to_directory(&directory, &document("第二版")).unwrap();
        fs::write(directory.join(DOCUMENT_FILE), "{not-json").unwrap();

        let recovered = load_from_directory(&directory).unwrap();
        assert!(recovered.recovered_from_backup);
        assert!(recovered.document.unwrap().contains("第一版"));
        assert_eq!(
            fs::read_dir(directory.join(CORRUPT_DIRECTORY))
                .unwrap()
                .count(),
            1
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_invalid_input_before_replacing_current_file() {
        let directory = test_directory("reject");
        save_to_directory(&directory, &document("有效内容")).unwrap();

        assert!(save_to_directory(&directory, "{}").is_err());
        let current = fs::read_to_string(directory.join(DOCUMENT_FILE)).unwrap();
        assert!(current.contains("有效内容"));
        fs::remove_dir_all(directory).unwrap();
    }
}
