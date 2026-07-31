use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const PREFERENCES_FILE: &str = "preferences.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPreferences {
    global_shortcut: String,
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "无法定位偏好设置目录".to_string())?;
    fs::create_dir_all(directory).map_err(|error| format!("无法创建偏好设置目录: {error}"))?;
    let temporary = directory.join(format!(".preferences.{}.tmp", stamp()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("无法创建偏好设置临时文件: {error}"))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("无法写入偏好设置: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("无法同步偏好设置: {error}"))?;
        fs::rename(&temporary, path).map_err(|error| format!("无法更新偏好设置: {error}"))?;
        #[cfg(unix)]
        File::open(directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("无法同步偏好设置目录: {error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(crate) fn load_global_shortcut(app: &AppHandle, default_shortcut: &str) -> String {
    let Ok(directory) = app.path().app_data_dir() else {
        return default_shortcut.to_string();
    };
    let Ok(content) = fs::read_to_string(directory.join(PREFERENCES_FILE)) else {
        return default_shortcut.to_string();
    };
    serde_json::from_str::<DesktopPreferences>(&content)
        .ok()
        .map(|preferences| preferences.global_shortcut)
        .filter(|shortcut| !shortcut.trim().is_empty())
        .unwrap_or_else(|| default_shortcut.to_string())
}

pub(crate) fn save_global_shortcut(app: &AppHandle, global_shortcut: &str) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位偏好设置目录: {error}"))?;
    let content = serde_json::to_string_pretty(&DesktopPreferences {
        global_shortcut: global_shortcut.to_string(),
    })
    .map_err(|error| format!("无法序列化偏好设置: {error}"))?;
    write_atomic(&directory.join(PREFERENCES_FILE), &content)
}
