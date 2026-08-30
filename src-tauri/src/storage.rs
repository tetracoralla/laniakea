use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, HashSet, VecDeque},
    fs::{self, File, OpenOptions},
    hash::{Hash, Hasher},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const RECOVERY_DOCUMENT_FILE: &str = "current.mindmap.json";
const ACTIVE_DOCUMENT_FILE: &str = "active-document.json";
const BACKUP_DIRECTORY: &str = "backups";
const CORRUPT_DIRECTORY: &str = "recovery";
const DOCUMENT_STATE_DIRECTORY: &str = "document-state";
const DRAFT_DIRECTORY: &str = "drafts";
const MAX_BACKUPS: usize = 8;
const EXTERNAL_DOCUMENT_CONFLICT: &str = "EXTERNAL_DOCUMENT_CONFLICT";
const PROTECTED_SOURCE_OVERWRITE: &str = "PROTECTED_SOURCE_OVERWRITE";
const STORAGE_HASH_VERSION: &str = "sha256-v1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadDocumentResult {
    document: Option<String>,
    outline_content: Option<String>,
    document_format: Option<String>,
    document_path: Option<String>,
    recovered_from_backup: bool,
    notice: Option<String>,
    source_hash: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveDocumentResult {
    source_hash: Option<String>,
    auxiliary_warning: Option<String>,
}

#[derive(Debug)]
struct MarkdownSaveResult {
    source_hash: String,
    auxiliary_warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateDraftResult {
    document_path: String,
    source_hash: String,
}

#[derive(Serialize, Deserialize)]
struct ActiveDocument {
    path: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownDocumentState {
    source_hash: StoredContentHash,
    document: String,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum StoredContentHash {
    Stable(String),
    Legacy(u64),
}

impl StoredContentHash {
    fn matches(&self, content: &str) -> bool {
        match self {
            Self::Stable(hash) => hash == &content_hash_string(content),
            Self::Legacy(hash) => *hash == legacy_content_hash(content),
        }
    }
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
    #[serde(default)]
    floating_roots: Vec<StoredFloatingRoot>,
    #[serde(default)]
    spaces: Option<HashMap<String, StoredSpace>>,
    viewport: StoredViewport,
    updated_at: String,
}

#[derive(Deserialize, PartialEq)]
struct StoredFloatingRoot {
    id: String,
    x: f64,
    y: f64,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StoredNode {
    id: String,
    text: String,
    parent_id: Option<String>,
    children: Vec<String>,
    subspace_id: Option<String>,
    collapsed: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize, PartialEq)]
struct StoredViewport {
    x: f64,
    y: f64,
    zoom: f64,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StoredFlowNode {
    id: String,
    text: String,
    kind: String,
    created_at: String,
    updated_at: String,
}

#[derive(Deserialize, PartialEq)]
struct StoredFlowEdge {
    id: String,
    from: String,
    to: String,
    label: String,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StoredFlowSpace {
    id: String,
    #[serde(rename = "type")]
    space_type: String,
    anchor_node_id: String,
    nodes: HashMap<String, StoredFlowNode>,
    edges: Vec<StoredFlowEdge>,
    viewport: StoredViewport,
    updated_at: String,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StoredMapSpace {
    id: String,
    #[serde(rename = "type")]
    space_type: String,
    anchor_node_id: String,
    root_id: String,
    nodes: HashMap<String, StoredNode>,
    #[serde(default)]
    floating_roots: Vec<StoredFloatingRoot>,
    viewport: StoredViewport,
    updated_at: String,
}

#[derive(Deserialize, PartialEq)]
#[serde(untagged)]
enum StoredSpace {
    Flow(StoredFlowSpace),
    Map(StoredMapSpace),
}

impl StoredSpace {
    fn id(&self) -> &str {
        match self {
            Self::Flow(space) => &space.id,
            Self::Map(space) => &space.id,
        }
    }

    fn anchor_node_id(&self) -> &str {
        match self {
            Self::Flow(space) => &space.anchor_node_id,
            Self::Map(space) => &space.anchor_node_id,
        }
    }

    fn viewport(&self) -> &StoredViewport {
        match self {
            Self::Flow(space) => &space.viewport,
            Self::Map(space) => &space.viewport,
        }
    }
}

fn valid_viewport(viewport: &StoredViewport) -> bool {
    viewport.x.is_finite()
        && viewport.y.is_finite()
        && viewport.zoom.is_finite()
        && viewport.zoom > 0.0
}

fn validate_mind_tree(
    root_id: &str,
    nodes: &HashMap<String, StoredNode>,
    floating_roots: &[StoredFloatingRoot],
    label: &str,
) -> Result<(), String> {
    let root = nodes
        .get(root_id)
        .ok_or_else(|| format!("{label}缺少根节点"))?;
    if root.parent_id.is_some() {
        return Err(format!("{label}根节点无效"));
    }
    let mut root_ids = vec![root_id];
    let mut unique_roots = HashSet::from([root_id]);
    for floating in floating_roots {
        if !floating.x.is_finite()
            || !floating.y.is_finite()
            || !unique_roots.insert(floating.id.as_str())
        {
            return Err(format!("{label}浮动分支的位置或节点无效"));
        }
        let floating_node = nodes
            .get(&floating.id)
            .ok_or_else(|| format!("{label}浮动分支缺少根节点"))?;
        if floating_node.parent_id.is_some() {
            return Err(format!("{label}浮动分支仍属于其他节点"));
        }
        root_ids.push(floating.id.as_str());
    }

    let mut visited = HashSet::new();
    let mut pending = root_ids;
    while let Some(id) = pending.pop() {
        if !visited.insert(id) {
            return Err(format!("{label}节点包含循环或重复引用"));
        }
        let node = nodes
            .get(id)
            .ok_or_else(|| format!("{label}引用了不存在的节点"))?;
        if node.id != id {
            return Err(format!("{label}节点索引与节点 ID 不一致"));
        }
        for child_id in &node.children {
            let child = nodes
                .get(child_id)
                .ok_or_else(|| format!("{label}引用了不存在的子节点"))?;
            if child.parent_id.as_deref() != Some(id) {
                return Err(format!("{label}父子关系不一致"));
            }
            pending.push(child_id);
        }
    }
    if visited.len() != nodes.len() {
        return Err(format!("{label}包含无法从根节点访问的节点"));
    }
    Ok(())
}

fn validate_document(document_json: &str) -> Result<(), String> {
    let document: StoredDocument = serde_json::from_str(document_json)
        .map_err(|error| storage_error("思维导图文件不是有效 JSON", error))?;
    if document.format_version != 1 || !valid_viewport(&document.viewport) {
        return Err("思维导图文件版本或根节点无效".to_string());
    }
    validate_mind_tree(
        &document.root_id,
        &document.nodes,
        &document.floating_roots,
        "思维导图",
    )?;
    let root = document.nodes.get(&document.root_id).unwrap();

    let empty_spaces = HashMap::new();
    let spaces = document.spaces.as_ref().unwrap_or(&empty_spaces);
    let mut all_nodes: HashMap<&str, &StoredNode> = HashMap::new();
    let mut owner_space_by_node: HashMap<&str, Option<&str>> = HashMap::new();
    for (node_id, node) in &document.nodes {
        all_nodes.insert(node_id.as_str(), node);
        owner_space_by_node.insert(node_id.as_str(), None);
    }
    for (space_id, space) in spaces {
        if space.id() != space_id || !valid_viewport(space.viewport()) {
            return Err("下层空间版本、节点或视口无效".to_string());
        }
        match space {
            StoredSpace::Flow(flow) => {
                if flow.space_type != "flow" || flow.nodes.is_empty() {
                    return Err("流程空间版本、节点或视口无效".to_string());
                }
                for (node_id, node) in &flow.nodes {
                    if node.id != *node_id
                        || !matches!(node.kind.as_str(), "start" | "step" | "decision" | "end")
                    {
                        return Err("流程空间包含无效节点".to_string());
                    }
                }
                let mut edge_ids = HashSet::new();
                let mut endpoint_pairs = HashSet::new();
                let mut outgoing: HashMap<&str, Vec<&str>> = flow
                    .nodes
                    .keys()
                    .map(|node_id| (node_id.as_str(), Vec::new()))
                    .collect();
                let mut indegree: HashMap<&str, usize> = flow
                    .nodes
                    .keys()
                    .map(|node_id| (node_id.as_str(), 0))
                    .collect();
                for edge in &flow.edges {
                    if !edge_ids.insert(edge.id.as_str())
                        || !endpoint_pairs.insert((edge.from.as_str(), edge.to.as_str()))
                        || edge.from == edge.to
                        || !flow.nodes.contains_key(&edge.from)
                        || !flow.nodes.contains_key(&edge.to)
                    {
                        return Err("流程空间包含无效连接".to_string());
                    }
                    outgoing
                        .get_mut(edge.from.as_str())
                        .unwrap()
                        .push(edge.to.as_str());
                    *indegree.get_mut(edge.to.as_str()).unwrap() += 1;
                }
                let mut pending: VecDeque<&str> = indegree
                    .iter()
                    .filter_map(|(node_id, count)| (*count == 0).then_some(*node_id))
                    .collect();
                let mut visited = 0;
                while let Some(node_id) = pending.pop_front() {
                    visited += 1;
                    for target_id in outgoing.get(node_id).into_iter().flatten() {
                        let remaining = indegree.get_mut(target_id).unwrap();
                        *remaining -= 1;
                        if *remaining == 0 {
                            pending.push_back(target_id);
                        }
                    }
                }
                if visited != flow.nodes.len() {
                    return Err("流程空间包含循环连接".to_string());
                }
            }
            StoredSpace::Map(map) => {
                if map.space_type != "map" {
                    return Err("思维图空间版本无效".to_string());
                }
                validate_mind_tree(&map.root_id, &map.nodes, &map.floating_roots, "思维图空间")?;
                for (node_id, node) in &map.nodes {
                    if all_nodes.insert(node_id.as_str(), node).is_some() {
                        return Err("不同思维图空间使用了重复节点 ID".to_string());
                    }
                    owner_space_by_node.insert(node_id.as_str(), Some(space_id.as_str()));
                }
            }
        }
    }
    let mut referenced_space_ids = HashSet::new();
    for node in all_nodes.values() {
        if let Some(space_id) = node.subspace_id.as_deref() {
            let space = spaces
                .get(space_id)
                .ok_or_else(|| "思维导图节点引用了不存在的下层空间".to_string())?;
            if !referenced_space_ids.insert(space_id) || space.anchor_node_id() != node.id {
                return Err("思维导图节点引用了其他节点的下层空间".to_string());
            }
        }
    }
    for (space_id, space) in spaces {
        let anchor = all_nodes
            .get(space.anchor_node_id())
            .ok_or_else(|| "下层空间缺少锚点节点".to_string())?;
        if anchor.subspace_id.as_deref() != Some(space_id.as_str()) {
            return Err("下层空间与锚点节点不一致".to_string());
        }
    }

    let mut parent_space_by_map: HashMap<&str, Option<&str>> = HashMap::new();
    for (space_id, space) in spaces {
        if let StoredSpace::Map(map) = space {
            let parent_space = owner_space_by_node
                .get(map.anchor_node_id.as_str())
                .copied()
                .flatten();
            if parent_space == Some(space_id.as_str()) {
                return Err("思维图空间不能锚定自身".to_string());
            }
            parent_space_by_map.insert(space_id.as_str(), parent_space);
        }
    }
    for space_id in parent_space_by_map.keys() {
        let mut visited_spaces = HashSet::new();
        let mut current = Some(*space_id);
        while let Some(candidate) = current {
            if !visited_spaces.insert(candidate) {
                return Err("思维图空间包含循环下钻关系".to_string());
            }
            current = parent_space_by_map.get(candidate).copied().flatten();
        }
    }

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

fn same_document_content_ignoring_viewport(left: &str, right: &str) -> bool {
    let (Ok(left), Ok(right)) = (
        serde_json::from_str::<StoredDocument>(left),
        serde_json::from_str::<StoredDocument>(right),
    ) else {
        return false;
    };
    fn same_space_content(
        left: &Option<HashMap<String, StoredSpace>>,
        right: &Option<HashMap<String, StoredSpace>>,
    ) -> bool {
        let empty = HashMap::new();
        let left = left.as_ref().unwrap_or(&empty);
        let right = right.as_ref().unwrap_or(&empty);
        left.len() == right.len()
            && left.iter().all(|(id, left_space)| {
                right
                    .get(id)
                    .is_some_and(|right_space| match (left_space, right_space) {
                        (StoredSpace::Flow(left), StoredSpace::Flow(right)) => {
                            left.id == right.id
                                && left.space_type == right.space_type
                                && left.anchor_node_id == right.anchor_node_id
                                && left.nodes == right.nodes
                                && left.edges == right.edges
                                && left.updated_at == right.updated_at
                        }
                        (StoredSpace::Map(left), StoredSpace::Map(right)) => {
                            left.id == right.id
                                && left.space_type == right.space_type
                                && left.anchor_node_id == right.anchor_node_id
                                && left.root_id == right.root_id
                                && left.nodes == right.nodes
                                && left
                                    .floating_roots
                                    .iter()
                                    .map(|root| root.id.as_str())
                                    .eq(right.floating_roots.iter().map(|root| root.id.as_str()))
                                && left.updated_at == right.updated_at
                        }
                        _ => false,
                    })
            })
    }

    left.format_version == right.format_version
        && left.title == right.title
        && left.root_id == right.root_id
        && left
            .floating_roots
            .iter()
            .map(|root| root.id.as_str())
            .eq(right.floating_roots.iter().map(|root| root.id.as_str()))
        && left.nodes == right.nodes
        && same_space_content(&left.spaces, &right.spaces)
        && left.updated_at == right.updated_at
}

fn unique_stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn safe_draft_stem(title: &str) -> String {
    let cleaned = title
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| {
            if matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
                '-'
            } else {
                character
            }
        })
        .take(48)
        .collect::<String>();
    let stem = cleaned.trim_matches([' ', '.', '-']);
    if stem.is_empty() {
        "未命名思维".to_string()
    } else {
        stem.to_string()
    }
}

#[cfg(test)]
fn create_markdown_draft_in(
    app_data: &Path,
    document_json: &str,
    markdown_content: &str,
) -> Result<CreateDraftResult, String> {
    create_markdown_draft_with_activation_in(app_data, document_json, markdown_content, true)
}

fn create_markdown_draft_with_activation_in(
    app_data: &Path,
    document_json: &str,
    markdown_content: &str,
    activate_document: bool,
) -> Result<CreateDraftResult, String> {
    let document: StoredDocument = serde_json::from_str(document_json)
        .map_err(|error| storage_error("新建思维导图不是有效文档", error))?;
    validate_document(document_json)?;
    let draft_directory = app_data.join(DRAFT_DIRECTORY);
    let target = draft_directory.join(format!(
        "{}-{}.md",
        safe_draft_stem(&document.title),
        unique_stamp()
    ));
    let saved = save_markdown_document(app_data, &target, markdown_content, document_json, None)?;
    if let Some(warning) = saved.auxiliary_warning {
        let _ = fs::remove_file(&target);
        let _ = cleanup_document_artifacts(app_data, &target);
        return Err(format!("无法完整创建本地草稿: {warning}"));
    }
    if activate_document {
        set_active_document(app_data, Some(&target))?;
    }
    Ok(CreateDraftResult {
        document_path: target.to_string_lossy().into_owned(),
        source_hash: saved.source_hash,
    })
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

fn ensure_native_path(path: &Path) -> Result<(), String> {
    let valid = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".mindmap.json"));
    if valid {
        Ok(())
    } else {
        Err("原生思维导图文件必须使用 .mindmap.json 扩展名".to_string())
    }
}

fn ensure_markdown_path(path: &Path) -> Result<(), String> {
    let valid = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown")
        });
    if valid {
        Ok(())
    } else {
        Err("Markdown 文件必须使用 .md 或 .markdown 扩展名".to_string())
    }
}

fn is_markdown_path(path: &Path) -> bool {
    ensure_markdown_path(path).is_ok()
}

fn write_atomic(target: &Path, content: &str) -> Result<(), String> {
    let directory = target
        .parent()
        .ok_or_else(|| "无法定位目标文件目录".to_string())?;
    fs::create_dir_all(directory).map_err(|error| storage_error("无法创建本地目录", error))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document.mindmap.json");
    let temporary = directory.join(format!(".{file_name}.{}.tmp", unique_stamp()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| storage_error("无法创建临时文件", error))?;
        file.write_all(content.as_bytes())
            .map_err(|error| storage_error("无法写入临时文件", error))?;
        file.sync_all()
            .map_err(|error| storage_error("无法同步临时文件", error))?;
        fs::rename(&temporary, target)
            .map_err(|error| storage_error("无法原子替换本地文件", error))?;
        sync_directory(directory)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn backup_directory_for(app_data: &Path, target: &Path) -> PathBuf {
    app_data
        .join(BACKUP_DIRECTORY)
        .join(stable_storage_key(&target.to_string_lossy()))
}

fn legacy_backup_directory_for(app_data: &Path, target: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    target.to_string_lossy().hash(&mut hasher);
    app_data
        .join(BACKUP_DIRECTORY)
        .join(format!("{:016x}", hasher.finish()))
}

fn legacy_content_hash(content: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    content.hash(&mut hasher);
    hasher.finish()
}

fn content_hash_string(content: &str) -> String {
    format!("{STORAGE_HASH_VERSION}:{}", sha256_hex(content.as_bytes()))
}

fn sha256_hex(content: &[u8]) -> String {
    Sha256::digest(content)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn stable_storage_key(value: &str) -> String {
    format!("{STORAGE_HASH_VERSION}-{}", sha256_hex(value.as_bytes()))
}

fn markdown_state_path(app_data: &Path, target: &Path) -> PathBuf {
    app_data.join(DOCUMENT_STATE_DIRECTORY).join(format!(
        "{}.json",
        stable_storage_key(&target.to_string_lossy())
    ))
}

fn legacy_markdown_state_path(app_data: &Path, target: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    target.to_string_lossy().hash(&mut hasher);
    app_data
        .join(DOCUMENT_STATE_DIRECTORY)
        .join(format!("{:016x}.json", hasher.finish()))
}

fn read_markdown_state(app_data: &Path, target: &Path, content: &str) -> Option<String> {
    for state_path in [
        markdown_state_path(app_data, target),
        legacy_markdown_state_path(app_data, target),
    ] {
        let Ok(state_json) = fs::read_to_string(state_path) else {
            continue;
        };
        let Ok(state) = serde_json::from_str::<MarkdownDocumentState>(&state_json) else {
            continue;
        };
        if state.source_hash.matches(content) && validate_document(&state.document).is_ok() {
            return Some(state.document);
        }
    }
    None
}

fn write_markdown_state(
    app_data: &Path,
    target: &Path,
    content: &str,
    document_json: &str,
) -> Result<(), String> {
    validate_document(document_json)?;
    let state = MarkdownDocumentState {
        source_hash: StoredContentHash::Stable(content_hash_string(content)),
        document: document_json.to_string(),
    };
    let state_json = serde_json::to_string(&state)
        .map_err(|error| storage_error("无法记录 Markdown 画布状态", error))?;
    write_atomic(&markdown_state_path(app_data, target), &state_json)
}

fn sorted_backups(backup_directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(backup_directory) {
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

fn sorted_markdown_backups(backup_directory: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(backup_directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(storage_error("无法读取 Markdown 备份目录", error)),
    };
    let mut backups = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("origin-") && name.ends_with(".md"))
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    Ok(backups)
}

fn sorted_backups_for_target(app_data: &Path, target: &Path) -> Result<Vec<PathBuf>, String> {
    let mut backups = sorted_backups(&backup_directory_for(app_data, target))?;
    backups.extend(sorted_backups(&legacy_backup_directory_for(
        app_data, target,
    ))?);
    if target == app_data.join(RECOVERY_DOCUMENT_FILE) {
        // Before multi-document support, recovery-draft backups lived directly
        // in `backups/`. Keep them available instead of stranding existing
        // recovery history when switching to per-document backup directories.
        backups.extend(sorted_backups(&app_data.join(BACKUP_DIRECTORY))?);
    }
    backups.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    Ok(backups)
}

fn sorted_markdown_backups_for_target(
    app_data: &Path,
    target: &Path,
) -> Result<Vec<PathBuf>, String> {
    let mut backups = sorted_markdown_backups(&backup_directory_for(app_data, target))?;
    backups.extend(sorted_markdown_backups(&legacy_backup_directory_for(
        app_data, target,
    ))?);
    backups.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    Ok(backups)
}

fn preserve_unreadable(app_data: &Path, target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    let recovery_directory = app_data.join(CORRUPT_DIRECTORY);
    fs::create_dir_all(&recovery_directory)
        .map_err(|error| storage_error("无法创建恢复目录", error))?;
    let source_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unreadable.mindmap.json");
    let recovery = recovery_directory.join(format!("{source_name}.{}.recovery", unique_stamp()));
    fs::copy(target, &recovery).map_err(|error| storage_error("无法保留损坏的原文件", error))?;
    File::open(&recovery)
        .and_then(|file| file.sync_all())
        .map_err(|error| storage_error("无法同步恢复副本", error))?;
    sync_directory(&recovery_directory)
}

fn backup_current(app_data: &Path, target: &Path) -> Result<(), String> {
    let current_json = match fs::read_to_string(target) {
        Ok(value) => value,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(storage_error("无法读取当前文件以创建备份", error)),
    };
    if validate_document(&current_json).is_err() {
        return preserve_unreadable(app_data, target);
    }

    let backup_directory = backup_directory_for(app_data, target);
    if let Some(latest) = sorted_backups_for_target(app_data, target)?.first() {
        if fs::read_to_string(latest).is_ok_and(|latest_json| latest_json == current_json) {
            return Ok(());
        }
    }

    fs::create_dir_all(&backup_directory)
        .map_err(|error| storage_error("无法创建备份目录", error))?;
    let backup = backup_directory.join(format!("origin-{}.mindmap.json", unique_stamp()));
    fs::write(&backup, current_json).map_err(|error| storage_error("无法创建自动备份", error))?;
    File::open(&backup)
        .and_then(|file| file.sync_all())
        .map_err(|error| storage_error("无法同步自动备份", error))?;
    sync_directory(&backup_directory)
}

fn backup_markdown_current(app_data: &Path, target: &Path, current: &str) -> Result<(), String> {
    let backup_directory = backup_directory_for(app_data, target);
    if let Some(latest) = sorted_markdown_backups_for_target(app_data, target)?.first() {
        if fs::read_to_string(latest).is_ok_and(|latest_content| latest_content == current) {
            return Ok(());
        }
    }

    fs::create_dir_all(&backup_directory)
        .map_err(|error| storage_error("无法创建 Markdown 备份目录", error))?;
    let backup = backup_directory.join(format!("origin-{}.md", unique_stamp()));
    fs::write(&backup, current)
        .map_err(|error| storage_error("无法创建 Markdown 自动备份", error))?;
    File::open(&backup)
        .and_then(|file| file.sync_all())
        .map_err(|error| storage_error("无法同步 Markdown 自动备份", error))?;
    sync_directory(&backup_directory)
}

fn prune_backups(app_data: &Path, target: &Path) -> Result<(), String> {
    for stale in sorted_backups_for_target(app_data, target)?
        .into_iter()
        .skip(MAX_BACKUPS)
    {
        fs::remove_file(&stale).map_err(|error| storage_error("无法清理旧备份", error))?;
    }
    Ok(())
}

fn prune_markdown_backups(app_data: &Path, target: &Path) -> Result<(), String> {
    for stale in sorted_markdown_backups_for_target(app_data, target)?
        .into_iter()
        .skip(MAX_BACKUPS)
    {
        fs::remove_file(&stale)
            .map_err(|error| storage_error("无法清理旧 Markdown 备份", error))?;
    }
    Ok(())
}

fn save_to_target(app_data: &Path, target: &Path, document_json: &str) -> Result<(), String> {
    ensure_native_path(target)?;
    validate_document(document_json)?;
    match fs::read_to_string(target) {
        Ok(current_json) if current_json == document_json => return Ok(()),
        Ok(current_json) => {
            if !same_document_content_ignoring_viewport(&current_json, document_json) {
                backup_current(app_data, target)?;
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(storage_error("无法读取待替换的思维导图文件", error)),
    }
    write_atomic(target, document_json)?;
    prune_backups(app_data, target)
}

fn save_markdown_document(
    app_data: &Path,
    target: &Path,
    content: &str,
    document_json: &str,
    expected_source_hash: Option<&str>,
) -> Result<MarkdownSaveResult, String> {
    save_markdown_document_with_protected_source(
        app_data,
        target,
        content,
        document_json,
        expected_source_hash,
        None,
    )
}

fn save_markdown_view_state(
    app_data: &Path,
    target: &Path,
    document_json: &str,
    expected_source_hash: Option<&str>,
) -> Result<MarkdownSaveResult, String> {
    ensure_markdown_path(target)?;
    validate_document(document_json)?;
    let expected_source_hash =
        expected_source_hash.ok_or_else(|| "保存 Markdown 画布状态时缺少源文件版本".to_string())?;
    let content = fs::read_to_string(target).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!("{EXTERNAL_DOCUMENT_CONFLICT}: Markdown 文件已被移动或删除，画布状态未保存")
        } else {
            storage_error("无法读取 Markdown 文件", error)
        }
    })?;
    let source_hash = content_hash_string(&content);
    if expected_source_hash != source_hash {
        return Err(format!(
            "{EXTERNAL_DOCUMENT_CONFLICT}: Markdown 文件已在其他应用中修改，画布状态未保存"
        ));
    }

    write_markdown_state(app_data, target, &content, document_json)?;
    Ok(MarkdownSaveResult {
        source_hash,
        auxiliary_warning: None,
    })
}

fn canonical_path_for_comparison(path: &Path) -> Result<PathBuf, String> {
    match fs::canonicalize(path) {
        Ok(canonical) => Ok(canonical),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| "无法定位文件所在目录".to_string())?;
            let canonical_parent = fs::canonicalize(parent)
                .map_err(|error| storage_error("无法定位文件所在目录", error))?;
            let file_name = path.file_name().ok_or_else(|| "文件名为空".to_string())?;
            Ok(canonical_parent.join(file_name))
        }
        Err(error) => Err(storage_error("无法确认文件位置", error)),
    }
}

fn combine_auxiliary_warnings(warnings: Vec<String>) -> Option<String> {
    if warnings.is_empty() {
        None
    } else {
        Some(warnings.join("；"))
    }
}

fn save_markdown_document_with_protected_source(
    app_data: &Path,
    target: &Path,
    content: &str,
    document_json: &str,
    expected_source_hash: Option<&str>,
    protected_source: Option<&Path>,
) -> Result<MarkdownSaveResult, String> {
    ensure_markdown_path(target)?;
    validate_document(document_json)?;
    if let Some(protected_source) = protected_source {
        let canonical_target = canonical_path_for_comparison(target)?;
        let canonical_source = canonical_path_for_comparison(protected_source)?;
        if canonical_target == canonical_source {
            return Err(format!(
                "{PROTECTED_SOURCE_OVERWRITE}: 不能覆盖包含未受支持内容的 Markdown 源文件"
            ));
        }
    }

    let source_hash = content_hash_string(content);
    match fs::read_to_string(target) {
        Ok(current) if current == content => {
            let mut warnings = Vec::new();
            if let Err(error) = write_markdown_state(app_data, target, content, document_json) {
                warnings.push(error);
            }
            if let Err(error) = prune_markdown_backups(app_data, target) {
                warnings.push(error);
            }
            return Ok(MarkdownSaveResult {
                source_hash,
                auxiliary_warning: combine_auxiliary_warnings(warnings),
            });
        }
        Ok(current)
            if expected_source_hash
                .is_some_and(|expected| expected != content_hash_string(&current)) =>
        {
            return Err(format!(
                "{EXTERNAL_DOCUMENT_CONFLICT}: Markdown 文件已在其他应用中修改，原文件未被覆盖"
            ));
        }
        Ok(current) => backup_markdown_current(app_data, target, &current)?,
        Err(error) if error.kind() == ErrorKind::NotFound && expected_source_hash.is_some() => {
            return Err(format!(
                "{EXTERNAL_DOCUMENT_CONFLICT}: Markdown 文件已被移动或删除，未重新创建"
            ));
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(storage_error("无法读取待替换的 Markdown 文件", error)),
    }
    write_atomic(target, content)?;
    let mut warnings = Vec::new();
    if let Err(error) = write_markdown_state(app_data, target, content, document_json) {
        warnings.push(error);
    }
    if let Err(error) = prune_markdown_backups(app_data, target) {
        warnings.push(error);
    }
    Ok(MarkdownSaveResult {
        source_hash,
        auxiliary_warning: combine_auxiliary_warnings(warnings),
    })
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(storage_error("无法清理旧草稿状态", error)),
    }
}

fn remove_directory_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(storage_error("无法清理旧草稿备份", error)),
    }
}

fn cleanup_document_artifacts(app_data: &Path, target: &Path) -> Result<(), String> {
    remove_file_if_present(&markdown_state_path(app_data, target))?;
    remove_file_if_present(&legacy_markdown_state_path(app_data, target))?;
    remove_directory_if_present(&backup_directory_for(app_data, target))?;
    remove_directory_if_present(&legacy_backup_directory_for(app_data, target))
}

fn discard_internal_draft_in(app_data: &Path, source: &Path) -> Result<(), String> {
    ensure_markdown_path(source)?;
    let canonical_drafts = fs::canonicalize(app_data.join(DRAFT_DIRECTORY))
        .map_err(|error| storage_error("无法定位本地草稿目录", error))?;
    let canonical_source =
        fs::canonicalize(source).map_err(|error| storage_error("找不到待清理的本地草稿", error))?;
    if !canonical_source.starts_with(&canonical_drafts) {
        return Err("只能清理 Laniakea 管理且尚未启用的本地草稿".to_string());
    }
    let source_is_active = active_document_path(app_data)
        .and_then(|path| fs::canonicalize(path).ok())
        .is_some_and(|active| active == canonical_source);
    if source_is_active {
        return Err("当前正在编辑的草稿不能清理".to_string());
    }
    fs::remove_file(&canonical_source)
        .map_err(|error| storage_error("无法清理未启用的本地草稿", error))?;
    let _ = cleanup_document_artifacts(app_data, source);
    Ok(())
}

fn move_internal_draft_in(
    app_data: &Path,
    source: &Path,
    target: &Path,
) -> Result<SaveDocumentResult, String> {
    ensure_markdown_path(source)?;
    ensure_markdown_path(target)?;

    let canonical_app_data =
        fs::canonicalize(app_data).map_err(|error| storage_error("无法定位应用数据目录", error))?;
    let canonical_drafts = fs::canonicalize(app_data.join(DRAFT_DIRECTORY))
        .map_err(|error| storage_error("无法定位本地草稿目录", error))?;
    let canonical_source =
        fs::canonicalize(source).map_err(|error| storage_error("找不到要移动的本地草稿", error))?;
    if !canonical_source.starts_with(&canonical_drafts) {
        return Err("只能移动 Laniakea 管理的本地草稿".to_string());
    }

    let target_parent = target
        .parent()
        .ok_or_else(|| "无法定位目标文件夹".to_string())?;
    let canonical_target_parent = fs::canonicalize(target_parent)
        .map_err(|error| storage_error("无法定位目标文件夹", error))?;
    if canonical_target_parent.starts_with(&canonical_app_data) {
        return Err("请选择 Laniakea 数据目录以外的位置".to_string());
    }

    let content = fs::read_to_string(&canonical_source)
        .map_err(|error| storage_error("无法读取本地草稿", error))?;
    let document_json = read_markdown_state(app_data, source, &content)
        .ok_or_else(|| "本地草稿状态不完整，原文件未移动".to_string())?;
    let source_was_active = active_document_path(app_data)
        .and_then(|path| fs::canonicalize(path).ok())
        .is_some_and(|active| active == canonical_source);

    let saved = save_markdown_document(app_data, target, &content, &document_json, None)?;
    if let Some(warning) = saved.auxiliary_warning {
        return Err(format!(
            "目标文件已写入但配套状态不完整，原草稿仍保留: {warning}"
        ));
    }
    let written =
        fs::read_to_string(target).map_err(|error| storage_error("无法验证移动后的文件", error))?;
    if written != content {
        return Err("移动后的文件校验失败，原草稿仍保留".to_string());
    }

    if source_was_active {
        set_active_document(app_data, Some(target))?;
    }
    if let Err(error) = fs::remove_file(&canonical_source) {
        if source_was_active {
            let _ = set_active_document(app_data, Some(source));
        }
        return Err(storage_error("新文件已保存，但旧草稿无法清理", error));
    }
    // The primary draft has moved successfully at this point. Cache cleanup is
    // best-effort so an old cache permission issue cannot leave the UI bound
    // to a primary file that has already been removed.
    let _ = cleanup_document_artifacts(app_data, source);

    Ok(SaveDocumentResult {
        source_hash: Some(saved.source_hash),
        auxiliary_warning: None,
    })
}

fn load_from_target(
    app_data: &Path,
    target: &Path,
    allow_missing: bool,
) -> Result<LoadDocumentResult, String> {
    ensure_native_path(target)?;
    match fs::read_to_string(target) {
        Ok(document) if validate_document(&document).is_ok() => {
            return Ok(LoadDocumentResult {
                document: Some(document),
                outline_content: None,
                document_format: Some("native".to_string()),
                document_path: None,
                recovered_from_backup: false,
                notice: None,
                source_hash: None,
            });
        }
        Ok(_) => preserve_unreadable(app_data, target)?,
        Err(error) if error.kind() == ErrorKind::NotFound && allow_missing => {
            return Ok(LoadDocumentResult {
                document: None,
                outline_content: None,
                document_format: None,
                document_path: None,
                recovered_from_backup: false,
                notice: None,
                source_hash: None,
            });
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err("找不到要打开的思维导图文件".to_string());
        }
        Err(_) => preserve_unreadable(app_data, target)?,
    }

    for backup in sorted_backups_for_target(app_data, target)? {
        let document = match fs::read_to_string(&backup) {
            Ok(document) => document,
            Err(_) => continue,
        };
        if validate_document(&document).is_ok() {
            return Ok(LoadDocumentResult {
                document: Some(document),
                outline_content: None,
                document_format: Some("native".to_string()),
                document_path: None,
                recovered_from_backup: true,
                notice: Some("原文件无法读取，已从最近的自动备份恢复。".to_string()),
                source_hash: None,
            });
        }
    }

    Err("原文件无法读取，且没有可用的自动备份；损坏内容已保留为恢复副本。".to_string())
}

fn load_markdown_from_target(
    app_data: &Path,
    target: &Path,
    allow_missing: bool,
) -> Result<LoadDocumentResult, String> {
    ensure_markdown_path(target)?;
    let (content, recovered_from_backup, notice) = match fs::read_to_string(target) {
        Ok(content) => (content, false, None),
        Err(error) if error.kind() == ErrorKind::NotFound && allow_missing => {
            return Ok(LoadDocumentResult {
                document: None,
                outline_content: None,
                document_format: Some("markdown".to_string()),
                document_path: None,
                recovered_from_backup: false,
                notice: None,
                source_hash: None,
            });
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err("找不到要打开的 Markdown 文件".to_string());
        }
        Err(_) => {
            preserve_unreadable(app_data, target)?;
            let backup = sorted_markdown_backups_for_target(app_data, target)?
                .into_iter()
                .find_map(|path| fs::read_to_string(path).ok())
                .ok_or_else(|| {
                    "Markdown 文件无法读取，且没有可用的自动备份；原文件已保留为恢复副本。"
                        .to_string()
                })?;
            (
                backup,
                true,
                Some("Markdown 文件无法读取，已从最近的自动备份恢复。".to_string()),
            )
        }
    };
    let source_hash = content_hash_string(&content);
    Ok(LoadDocumentResult {
        document: read_markdown_state(app_data, target, &content),
        outline_content: Some(content),
        document_format: Some("markdown".to_string()),
        document_path: None,
        recovered_from_backup,
        notice,
        source_hash: Some(source_hash),
    })
}

fn load_any_target(
    app_data: &Path,
    target: &Path,
    allow_missing: bool,
) -> Result<LoadDocumentResult, String> {
    if is_markdown_path(target) {
        load_markdown_from_target(app_data, target, allow_missing)
    } else {
        load_from_target(app_data, target, allow_missing)
    }
}

fn recovery_target(app_data: &Path) -> PathBuf {
    app_data.join(RECOVERY_DOCUMENT_FILE)
}

fn active_document_path(app_data: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(app_data.join(ACTIVE_DOCUMENT_FILE)).ok()?;
    serde_json::from_str::<ActiveDocument>(&content)
        .ok()
        .map(|active| PathBuf::from(active.path))
}

fn set_active_document(app_data: &Path, path: Option<&Path>) -> Result<(), String> {
    let session_file = app_data.join(ACTIVE_DOCUMENT_FILE);
    match path {
        Some(path) => {
            let active = ActiveDocument {
                path: path.to_string_lossy().into_owned(),
            };
            let content = serde_json::to_string(&active)
                .map_err(|error| storage_error("无法记录当前文件", error))?;
            write_atomic(&session_file, &content)
        }
        None => match fs::remove_file(&session_file) {
            Ok(()) => sync_directory(app_data),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(storage_error("无法清除当前文件记录", error)),
        },
    }
}

fn load_startup_document(app_data: &Path) -> Result<LoadDocumentResult, String> {
    if let Some(active_path) = active_document_path(app_data) {
        match load_any_target(app_data, &active_path, false) {
            Ok(mut loaded) => {
                loaded.document_path = Some(active_path.to_string_lossy().into_owned());
                return Ok(loaded);
            }
            Err(_) => {
                set_active_document(app_data, None)?;
                let mut recovered = load_from_target(app_data, &recovery_target(app_data), true)?;
                recovered.notice =
                    Some("上次打开的文件已移动或无法读取，已转到应用恢复稿。".to_string());
                return Ok(recovered);
            }
        }
    }
    load_from_target(app_data, &recovery_target(app_data), true)
}

#[tauri::command]
pub(crate) async fn load_local_document(app: AppHandle) -> Result<LoadDocumentResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    tauri::async_runtime::spawn_blocking(move || load_startup_document(&app_data))
        .await
        .map_err(|error| storage_error("读取任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn open_local_document(
    app: AppHandle,
    document_path: String,
) -> Result<LoadDocumentResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    let target = PathBuf::from(document_path);
    tauri::async_runtime::spawn_blocking(move || {
        let mut loaded = load_any_target(&app_data, &target, false)?;
        loaded.document_path = Some(target.to_string_lossy().into_owned());
        Ok(loaded)
    })
    .await
    .map_err(|error| storage_error("打开任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn create_markdown_draft(
    app: AppHandle,
    document_json: String,
    markdown_content: String,
    activate_document: Option<bool>,
) -> Result<CreateDraftResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    tauri::async_runtime::spawn_blocking(move || {
        create_markdown_draft_with_activation_in(
            &app_data,
            &document_json,
            &markdown_content,
            activate_document.unwrap_or(true),
        )
    })
    .await
    .map_err(|error| storage_error("新建任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn move_internal_draft(
    app: AppHandle,
    source_path: String,
    target_path: String,
) -> Result<SaveDocumentResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    let source = PathBuf::from(source_path);
    let target = PathBuf::from(target_path);
    tauri::async_runtime::spawn_blocking(move || {
        move_internal_draft_in(&app_data, &source, &target)
    })
    .await
    .map_err(|error| storage_error("移动草稿任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn discard_internal_draft(
    app: AppHandle,
    document_path: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    let target = PathBuf::from(document_path);
    tauri::async_runtime::spawn_blocking(move || discard_internal_draft_in(&app_data, &target))
        .await
        .map_err(|error| storage_error("清理草稿任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn read_outline_file(document_path: String) -> Result<String, String> {
    let target = PathBuf::from(document_path);
    let valid = target
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt"
            )
        });
    if !valid {
        return Err("只能将 Markdown 或缩进纯文本导入为大纲".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        fs::read_to_string(target).map_err(|error| storage_error("无法读取大纲文件", error))
    })
    .await
    .map_err(|error| storage_error("导入任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn save_local_document(
    app: AppHandle,
    document_json: String,
    document_path: Option<String>,
    markdown_content: Option<String>,
    expected_source_hash: Option<String>,
    protected_source_path: Option<String>,
    viewport_only: Option<bool>,
) -> Result<SaveDocumentResult, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    let target = document_path
        .as_ref()
        .map_or_else(|| recovery_target(&app_data), PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || {
        if document_path.is_some() && is_markdown_path(&target) {
            let saved = if viewport_only.unwrap_or(false) {
                save_markdown_view_state(
                    &app_data,
                    &target,
                    &document_json,
                    expected_source_hash.as_deref(),
                )?
            } else {
                let content = markdown_content
                    .as_deref()
                    .ok_or_else(|| "保存 Markdown 文件时缺少正文内容".to_string())?;
                save_markdown_document_with_protected_source(
                    &app_data,
                    &target,
                    content,
                    &document_json,
                    expected_source_hash.as_deref(),
                    protected_source_path.as_deref().map(Path::new),
                )?
            };
            let mut warnings = saved.auxiliary_warning.into_iter().collect::<Vec<_>>();
            if let Err(error) = set_active_document(&app_data, Some(target.as_path())) {
                warnings.push(error);
            }
            Ok(SaveDocumentResult {
                source_hash: Some(saved.source_hash),
                auxiliary_warning: combine_auxiliary_warnings(warnings),
            })
        } else {
            save_to_target(&app_data, &target, &document_json)?;
            set_active_document(&app_data, document_path.as_ref().map(|_| target.as_path()))?;
            Ok(SaveDocumentResult {
                source_hash: None,
                auxiliary_warning: None,
            })
        }
    })
    .await
    .map_err(|error| storage_error("保存任务异常结束", error))?
}

#[tauri::command]
pub(crate) async fn activate_local_document(
    app: AppHandle,
    document_path: String,
) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    let target = PathBuf::from(document_path);
    tauri::async_runtime::spawn_blocking(move || {
        if !target.is_file() {
            return Err("当前文件已移动或无法读取".to_string());
        }
        set_active_document(&app_data, Some(&target))
    })
    .await
    .map_err(|error| storage_error("记录当前文件异常结束", error))?
}

#[tauri::command]
pub(crate) async fn clear_active_document(app: AppHandle) -> Result<(), String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| storage_error("无法定位本地数据目录", error))?;
    tauri::async_runtime::spawn_blocking(move || set_active_document(&app_data, None))
        .await
        .map_err(|error| storage_error("新建任务异常结束", error))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(title: &str) -> String {
        format!(
            r#"{{"formatVersion":1,"title":"{title}","rootId":"root","nodes":{{"root":{{"id":"root","text":"{title}","parentId":null,"children":[],"collapsed":false,"createdAt":"2026-07-23T00:00:00.000Z","updatedAt":"2026-07-23T00:00:00.000Z"}}}},"viewport":{{"x":0,"y":0,"zoom":1}},"updatedAt":"2026-07-23T00:00:00.000Z"}}"#
        )
    }

    fn floating_document(x: i32) -> String {
        format!(
            r#"{{"formatVersion":1,"title":"浮动分支","rootId":"root","nodes":{{"root":{{"id":"root","text":"主原点","parentId":null,"children":[],"collapsed":false,"createdAt":"2026-07-23T00:00:00.000Z","updatedAt":"2026-07-23T00:00:00.000Z"}},"floating":{{"id":"floating","text":"浮动分支","parentId":null,"children":[],"collapsed":false,"createdAt":"2026-07-23T00:00:00.000Z","updatedAt":"2026-07-23T00:00:00.000Z"}}}},"floatingRoots":[{{"id":"floating","x":{x},"y":180}}],"viewport":{{"x":0,"y":0,"zoom":1}},"updatedAt":"2026-07-23T00:00:00.000Z"}}"#
        )
    }

    fn flow_document(space_viewport_x: i32) -> String {
        serde_json::json!({
            "formatVersion": 1,
            "title": "流程锚点",
            "rootId": "root",
            "nodes": {
                "root": {
                    "id": "root",
                    "text": "流程锚点",
                    "parentId": null,
                    "children": [],
                    "subspaceId": "flow-1",
                    "collapsed": false,
                    "createdAt": "2026-07-23T00:00:00.000Z",
                    "updatedAt": "2026-07-23T00:00:00.000Z"
                }
            },
            "spaces": {
                "flow-1": {
                    "id": "flow-1",
                    "type": "flow",
                    "anchorNodeId": "root",
                    "nodes": {
                        "start": {
                            "id": "start",
                            "text": "开始",
                            "kind": "start",
                            "createdAt": "2026-07-23T00:00:00.000Z",
                            "updatedAt": "2026-07-23T00:00:00.000Z"
                        },
                        "step": {
                            "id": "step",
                            "text": "处理",
                            "kind": "step",
                            "createdAt": "2026-07-23T00:00:00.000Z",
                            "updatedAt": "2026-07-23T00:00:00.000Z"
                        },
                        "end": {
                            "id": "end",
                            "text": "完成",
                            "kind": "end",
                            "createdAt": "2026-07-23T00:00:00.000Z",
                            "updatedAt": "2026-07-23T00:00:00.000Z"
                        }
                    },
                    "edges": [
                        {"id": "edge-1", "from": "start", "to": "step", "label": ""},
                        {"id": "edge-2", "from": "step", "to": "end", "label": ""}
                    ],
                    "viewport": {"x": space_viewport_x, "y": 0, "zoom": 1},
                    "updatedAt": "2026-07-23T00:00:00.000Z"
                }
            },
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "updatedAt": "2026-07-23T00:00:00.000Z"
        })
        .to_string()
    }

    fn map_space_document(space_viewport_x: i32) -> String {
        serde_json::json!({
            "formatVersion": 1,
            "title": "下钻主题",
            "rootId": "root",
            "nodes": {
                "root": {
                    "id": "root",
                    "text": "下钻主题",
                    "parentId": null,
                    "children": [],
                    "subspaceId": "map-1",
                    "collapsed": false,
                    "createdAt": "2026-07-23T00:00:00.000Z",
                    "updatedAt": "2026-07-23T00:00:00.000Z"
                }
            },
            "spaces": {
                "map-1": {
                    "id": "map-1",
                    "type": "map",
                    "anchorNodeId": "root",
                    "rootId": "map-root",
                    "nodes": {
                        "map-root": {
                            "id": "map-root",
                            "text": "下钻主题",
                            "parentId": null,
                            "children": ["detail"],
                            "collapsed": false,
                            "createdAt": "2026-07-23T00:00:00.000Z",
                            "updatedAt": "2026-07-23T00:00:00.000Z"
                        },
                        "detail": {
                            "id": "detail",
                            "text": "细节",
                            "parentId": "map-root",
                            "children": [],
                            "collapsed": false,
                            "createdAt": "2026-07-23T00:00:00.000Z",
                            "updatedAt": "2026-07-23T00:00:00.000Z"
                        }
                    },
                    "floatingRoots": [],
                    "viewport": {"x": space_viewport_x, "y": 0, "zoom": 1},
                    "updatedAt": "2026-07-23T00:00:00.000Z"
                }
            },
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "updatedAt": "2026-07-23T00:00:00.000Z"
        })
        .to_string()
    }

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "origin-storage-{name}-{}-{}",
            std::process::id(),
            unique_stamp()
        ))
    }

    fn backup_count(app_data: &Path, target: &Path) -> usize {
        sorted_backups_for_target(app_data, target).unwrap().len()
    }

    fn markdown_backup_count(app_data: &Path, target: &Path) -> usize {
        sorted_markdown_backups_for_target(app_data, target)
            .unwrap()
            .len()
    }

    #[test]
    fn uses_a_versioned_stable_sha256_storage_key() {
        assert_eq!(
            stable_storage_key("hello"),
            "sha256-v1-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn validates_flow_space_anchors_and_edges() {
        assert!(validate_document(&flow_document(0)).is_ok());

        let mut dangling: serde_json::Value = serde_json::from_str(&flow_document(0)).unwrap();
        dangling["nodes"]["root"]
            .as_object_mut()
            .unwrap()
            .remove("subspaceId");
        assert!(validate_document(&dangling.to_string())
            .unwrap_err()
            .contains("锚点节点"));

        let mut missing_target: serde_json::Value =
            serde_json::from_str(&flow_document(0)).unwrap();
        missing_target["spaces"]["flow-1"]["edges"][0]["to"] =
            serde_json::Value::String("missing".to_string());
        assert!(validate_document(&missing_target.to_string())
            .unwrap_err()
            .contains("无效连接"));

        let mut self_loop: serde_json::Value = serde_json::from_str(&flow_document(0)).unwrap();
        self_loop["spaces"]["flow-1"]["edges"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "edge-self",
                "from": "step",
                "to": "step",
                "label": ""
            }));
        assert!(validate_document(&self_loop.to_string())
            .unwrap_err()
            .contains("无效连接"));

        let mut duplicate: serde_json::Value = serde_json::from_str(&flow_document(0)).unwrap();
        duplicate["spaces"]["flow-1"]["edges"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "edge-duplicate",
                "from": "start",
                "to": "step",
                "label": "重复"
            }));
        assert!(validate_document(&duplicate.to_string())
            .unwrap_err()
            .contains("无效连接"));

        let mut cycle: serde_json::Value = serde_json::from_str(&flow_document(0)).unwrap();
        cycle["spaces"]["flow-1"]["edges"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "id": "edge-cycle",
                "from": "end",
                "to": "start",
                "label": ""
            }));
        assert!(validate_document(&cycle.to_string())
            .unwrap_err()
            .contains("循环连接"));
    }

    #[test]
    fn validates_permanent_map_space_tree_and_anchor() {
        assert!(validate_document(&map_space_document(0)).is_ok());

        let mut broken: serde_json::Value = serde_json::from_str(&map_space_document(0)).unwrap();
        broken["spaces"]["map-1"]["nodes"]["detail"]["parentId"] =
            serde_json::Value::String("missing".to_string());
        assert!(validate_document(&broken.to_string())
            .unwrap_err()
            .contains("父子关系"));
    }

    #[test]
    fn saves_flow_viewport_without_consuming_content_backup_slots() {
        let directory = test_directory("flow-viewport-only");
        let app_data = directory.join("app-data");
        let target = directory.join("flow.mindmap.json");
        save_to_target(&app_data, &target, &flow_document(0)).unwrap();

        save_to_target(&app_data, &target, &flow_document(125)).unwrap();

        assert_eq!(backup_count(&app_data, &target), 0);
        assert!(fs::read_to_string(&target).unwrap().contains("\"x\":125"));
        let changed = flow_document(125).replace("\"text\":\"处理\"", "\"text\":\"已处理\"");
        save_to_target(&app_data, &target, &changed).unwrap();
        assert_eq!(backup_count(&app_data, &target), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_map_space_viewport_without_consuming_content_backup_slots() {
        let directory = test_directory("map-space-viewport-only");
        let app_data = directory.join("app-data");
        let target = directory.join("map.mindmap.json");
        save_to_target(&app_data, &target, &map_space_document(0)).unwrap();

        save_to_target(&app_data, &target, &map_space_document(125)).unwrap();

        assert_eq!(backup_count(&app_data, &target), 0);
        let changed = map_space_document(125).replace("\"text\":\"细节\"", "\"text\":\"新细节\"");
        save_to_target(&app_data, &target, &changed).unwrap();
        assert_eq!(backup_count(&app_data, &target), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn creates_each_new_map_as_an_independent_markdown_draft() {
        let directory = test_directory("markdown-draft");
        let app_data = directory.join("app-data");

        let first = create_markdown_draft_in(
            &app_data,
            &document("第一个想法"),
            "# 第一个想法\n\n- 第一个想法\n",
        )
        .unwrap();
        let second = create_markdown_draft_in(
            &app_data,
            &document("第二个想法"),
            "# 第二个想法\n\n- 第二个想法\n",
        )
        .unwrap();

        assert_ne!(first.document_path, second.document_path);
        assert!(first.document_path.ends_with(".md"));
        assert!(second.document_path.ends_with(".md"));
        assert!(fs::read_to_string(&first.document_path)
            .unwrap()
            .contains("第一个想法"));
        assert!(fs::read_to_string(&second.document_path)
            .unwrap()
            .contains("第二个想法"));
        assert_eq!(
            active_document_path(&app_data).unwrap(),
            PathBuf::from(&second.document_path),
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn discards_only_an_inactive_app_managed_draft_and_its_state() {
        let directory = test_directory("discard-inactive-draft");
        let app_data = directory.join("app-data");
        let created = create_markdown_draft_with_activation_in(
            &app_data,
            &document("未启用草稿"),
            "# 未启用草稿\n",
            false,
        )
        .unwrap();
        let source = PathBuf::from(&created.document_path);
        let state = markdown_state_path(&app_data, &source);

        discard_internal_draft_in(&app_data, &source).unwrap();

        assert!(!source.exists());
        assert!(!state.exists());
        assert!(active_document_path(&app_data).is_none());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn moves_an_internal_draft_to_a_user_folder_without_leaving_the_old_primary() {
        let directory = test_directory("move-internal-draft");
        let app_data = directory.join("app-data");
        let documents = directory.join("Documents");
        fs::create_dir_all(&documents).unwrap();
        let initial_document = document("要移动的想法");
        let initial_markdown = "# 要移动的想法\n\n- 初始内容\n";
        let created =
            create_markdown_draft_in(&app_data, &initial_document, initial_markdown).unwrap();
        let source = PathBuf::from(&created.document_path);
        let document_json = document("移动前的最新想法");
        let markdown = "# 移动前的最新想法\n\n- 最新内容\n";
        save_markdown_document(
            &app_data,
            &source,
            markdown,
            &document_json,
            Some(&created.source_hash),
        )
        .unwrap();
        let old_state = markdown_state_path(&app_data, &source);
        let old_backups = backup_directory_for(&app_data, &source);
        let target = documents.join("要移动的想法.md");
        assert!(old_backups.exists());

        let moved = move_internal_draft_in(&app_data, &source, &target).unwrap();

        assert_eq!(moved.source_hash, Some(content_hash_string(markdown)),);
        assert_eq!(fs::read_to_string(&target).unwrap(), markdown);
        assert!(!source.exists());
        assert!(!old_state.exists());
        assert!(!old_backups.exists());
        assert_eq!(
            read_markdown_state(&app_data, &target, markdown).as_deref(),
            Some(document_json.as_str()),
        );
        assert_eq!(active_document_path(&app_data).unwrap(), target);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn keeps_the_internal_draft_when_its_state_is_incomplete() {
        let directory = test_directory("incomplete-internal-draft");
        let app_data = directory.join("app-data");
        let documents = directory.join("Documents");
        fs::create_dir_all(&documents).unwrap();
        let created =
            create_markdown_draft_in(&app_data, &document("内部草稿"), "# 内部草稿\n").unwrap();
        let source = PathBuf::from(&created.document_path);
        let target = documents.join("内部草稿.md");
        fs::remove_file(markdown_state_path(&app_data, &source)).unwrap();

        let error = move_internal_draft_in(&app_data, &source, &target).unwrap_err();

        assert!(error.contains("状态不完整"));
        assert!(source.exists());
        assert!(!target.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn moving_an_inactive_draft_does_not_replace_the_active_document() {
        let directory = test_directory("move-inactive-draft");
        let app_data = directory.join("app-data");
        let documents = directory.join("Documents");
        fs::create_dir_all(&documents).unwrap();
        let inactive =
            create_markdown_draft_in(&app_data, &document("稍后整理"), "# 稍后整理\n").unwrap();
        let active =
            create_markdown_draft_in(&app_data, &document("当前工作"), "# 当前工作\n").unwrap();
        let inactive_source = PathBuf::from(&inactive.document_path);
        let target = documents.join("稍后整理.md");

        move_internal_draft_in(&app_data, &inactive_source, &target).unwrap();

        assert_eq!(
            active_document_path(&app_data).unwrap(),
            PathBuf::from(active.document_path),
        );
        assert!(!inactive_source.exists());
        assert!(target.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn refuses_to_move_a_file_that_is_not_an_internal_draft() {
        let directory = test_directory("reject-external-move");
        let app_data = directory.join("app-data");
        let documents = directory.join("Documents");
        fs::create_dir_all(&documents).unwrap();
        create_markdown_draft_in(&app_data, &document("内部草稿"), "# 内部草稿\n").unwrap();
        let external = documents.join("外部文件.md");
        fs::write(&external, "# 外部文件\n").unwrap();
        let target = documents.join("另一个位置.md");

        let error = move_internal_draft_in(&app_data, &external, &target).unwrap_err();

        assert!(error.contains("只能移动 Laniakea 管理的本地草稿"));
        assert!(external.exists());
        assert!(!target.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_independent_files_with_atomic_replacement_and_bounded_backups() {
        let directory = test_directory("save");
        let app_data = directory.join("app-data");
        let first = directory.join("first.mindmap.json");
        let second = directory.join("second.mindmap.json");
        for index in 0..12 {
            save_to_target(&app_data, &first, &document(&format!("版本 {index}")))
                .expect("save should succeed");
        }
        save_to_target(&app_data, &second, &document("另一张图")).unwrap();

        assert!(fs::read_to_string(&first).unwrap().contains("版本 11"));
        assert!(fs::read_to_string(&second).unwrap().contains("另一张图"));
        assert_eq!(backup_count(&app_data, &first), MAX_BACKUPS);
        assert_eq!(backup_count(&app_data, &second), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn skips_identical_writes_and_duplicate_backups() {
        let directory = test_directory("dedupe");
        let app_data = directory.join("app-data");
        let target = directory.join("dedupe.mindmap.json");

        save_to_target(&app_data, &target, &document("第一版")).unwrap();
        save_to_target(&app_data, &target, &document("第一版")).unwrap();
        assert_eq!(backup_count(&app_data, &target), 0);

        save_to_target(&app_data, &target, &document("第二版")).unwrap();
        save_to_target(&app_data, &target, &document("第二版")).unwrap();
        assert_eq!(backup_count(&app_data, &target), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_viewport_changes_without_consuming_content_backup_slots() {
        let directory = test_directory("viewport-only");
        let app_data = directory.join("app-data");
        let target = directory.join("viewport.mindmap.json");
        save_to_target(&app_data, &target, &document("内容未变")).unwrap();
        let moved_viewport = document("内容未变").replace("\"x\":0", "\"x\":125");

        save_to_target(&app_data, &target, &moved_viewport).unwrap();

        assert_eq!(backup_count(&app_data, &target), 0);
        assert!(fs::read_to_string(&target).unwrap().contains("\"x\":125"));

        save_to_target(&app_data, &target, &document("内容已变")).unwrap();
        assert_eq!(backup_count(&app_data, &target), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_markdown_view_state_without_rewriting_the_source() {
        let directory = test_directory("markdown-view-state");
        let app_data = directory.join("app-data");
        let target = directory.join("viewport.md");
        let content = "# 内容未变\n\n- 内容未变\n";
        let initial =
            save_markdown_document(&app_data, &target, content, &document("内容未变"), None)
                .unwrap();
        let moved_viewport = document("内容未变").replace("\"x\":0", "\"x\":125");

        let saved = save_markdown_view_state(
            &app_data,
            &target,
            &moved_viewport,
            Some(&initial.source_hash),
        )
        .unwrap();

        assert_eq!(saved.source_hash, initial.source_hash);
        assert_eq!(fs::read_to_string(&target).unwrap(), content);
        assert!(read_markdown_state(&app_data, &target, content)
            .unwrap()
            .contains("\"x\":125"));
        assert_eq!(markdown_backup_count(&app_data, &target), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_markdown_view_state_when_the_source_changed_externally() {
        let directory = test_directory("markdown-view-state-conflict");
        let app_data = directory.join("app-data");
        let target = directory.join("viewport.md");
        let original = "# 原内容\n\n- 原内容\n";
        let initial =
            save_markdown_document(&app_data, &target, original, &document("原内容"), None)
                .unwrap();
        fs::write(&target, "# 外部修改\n\n- 外部修改\n").unwrap();

        let error = save_markdown_view_state(
            &app_data,
            &target,
            &document("原内容").replace("\"x\":0", "\"x\":125"),
            Some(&initial.source_hash),
        )
        .unwrap_err();

        assert!(error.contains(EXTERNAL_DOCUMENT_CONFLICT));
        assert!(read_markdown_state(&app_data, &target, original)
            .unwrap()
            .contains("\"x\":0"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_floating_positions_without_consuming_content_backup_slots() {
        let directory = test_directory("floating-position-only");
        let app_data = directory.join("app-data");
        let target = directory.join("floating.mindmap.json");
        save_to_target(&app_data, &target, &floating_document(620)).unwrap();

        save_to_target(&app_data, &target, &floating_document(880)).unwrap();

        assert_eq!(backup_count(&app_data, &target), 0);
        assert!(fs::read_to_string(&target).unwrap().contains("\"x\":880"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn recovers_latest_valid_backup_and_preserves_corrupt_primary() {
        let directory = test_directory("recover");
        let app_data = directory.join("app-data");
        let target = directory.join("recover.mindmap.json");
        save_to_target(&app_data, &target, &document("第一版")).unwrap();
        save_to_target(&app_data, &target, &document("第二版")).unwrap();
        fs::write(&target, "{not-json").unwrap();

        let recovered = load_from_target(&app_data, &target, false).unwrap();
        assert!(recovered.recovered_from_backup);
        assert!(recovered.document.unwrap().contains("第一版"));
        assert_eq!(
            fs::read_dir(app_data.join(CORRUPT_DIRECTORY))
                .unwrap()
                .count(),
            1
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_backups_from_the_previous_default_hasher_directory() {
        let directory = test_directory("legacy-path-hash");
        let app_data = directory.join("app-data");
        let target = directory.join("recover.mindmap.json");
        let legacy_directory = legacy_backup_directory_for(&app_data, &target);
        fs::create_dir_all(&legacy_directory).unwrap();
        fs::write(
            legacy_directory.join("origin-100.mindmap.json"),
            document("升级前备份"),
        )
        .unwrap();
        fs::write(&target, "{not-json").unwrap();

        let recovered = load_from_target(&app_data, &target, false).unwrap();

        assert!(recovered.recovered_from_backup);
        assert!(recovered.document.unwrap().contains("升级前备份"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_markdown_backups_from_the_previous_default_hasher_directory() {
        let directory = test_directory("legacy-markdown-backup-path");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");
        let legacy_directory = legacy_backup_directory_for(&app_data, &target);
        fs::create_dir_all(&legacy_directory).unwrap();
        fs::write(
            legacy_directory.join("origin-100.md"),
            "# 方案\n\n- 升级前备份\n",
        )
        .unwrap();
        fs::write(&target, [0xff]).unwrap();

        let recovered = load_markdown_from_target(&app_data, &target, false).unwrap();

        assert!(recovered.recovered_from_backup);
        assert_eq!(
            recovered.outline_content.as_deref(),
            Some("# 方案\n\n- 升级前备份\n")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn keeps_pre_multi_document_recovery_backups_readable() {
        let directory = test_directory("legacy-recovery");
        let app_data = directory.join("app-data");
        let target = recovery_target(&app_data);
        fs::create_dir_all(app_data.join(BACKUP_DIRECTORY)).unwrap();
        fs::write(
            app_data
                .join(BACKUP_DIRECTORY)
                .join("origin-100.mindmap.json"),
            document("旧版恢复备份"),
        )
        .unwrap();
        fs::write(&target, "{not-json").unwrap();

        let recovered = load_startup_document(&app_data).unwrap();

        assert!(recovered.recovered_from_backup);
        assert!(recovered.document.unwrap().contains("旧版恢复备份"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_invalid_input_before_replacing_current_file() {
        let directory = test_directory("reject");
        let app_data = directory.join("app-data");
        let target = directory.join("reject.mindmap.json");
        save_to_target(&app_data, &target, &document("有效内容")).unwrap();

        assert!(save_to_target(&app_data, &target, "{}").is_err());
        assert!(fs::read_to_string(&target).unwrap().contains("有效内容"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn restores_the_last_active_external_document_on_startup() {
        let directory = test_directory("active-document");
        let app_data = directory.join("app-data");
        let target = directory.join("active.mindmap.json");
        save_to_target(&app_data, &target, &document("当前外部文件")).unwrap();
        set_active_document(&app_data, Some(&target)).unwrap();

        let loaded = load_startup_document(&app_data).unwrap();

        assert!(loaded.document.unwrap().contains("当前外部文件"));
        assert_eq!(
            loaded.document_path,
            Some(target.to_string_lossy().into_owned())
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn saves_markdown_as_primary_and_restores_its_cached_canvas_state() {
        let directory = test_directory("markdown-primary");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");
        let markdown = "# 方案\n\n- 原点\n  - 路径\n";
        let document_json = document("方案");

        save_markdown_document(&app_data, &target, markdown, &document_json, None).unwrap();
        set_active_document(&app_data, Some(&target)).unwrap();
        let loaded = load_startup_document(&app_data).unwrap();

        assert_eq!(fs::read_to_string(&target).unwrap(), markdown);
        assert_eq!(loaded.document_format.as_deref(), Some("markdown"));
        assert_eq!(loaded.outline_content.as_deref(), Some(markdown));
        assert_eq!(loaded.document.as_deref(), Some(document_json.as_str()));
        let expected_hash = content_hash_string(markdown);
        assert_eq!(loaded.source_hash.as_deref(), Some(expected_hash.as_str()));
        assert_eq!(
            loaded.document_path,
            Some(target.to_string_lossy().into_owned())
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_markdown_state_from_the_previous_default_hasher_format() {
        let directory = test_directory("legacy-markdown-state");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");
        let markdown = "# 方案\n\n- 原点\n";
        let document_json = document("旧版画布状态");
        let state_path = legacy_markdown_state_path(&app_data, &target);
        fs::create_dir_all(state_path.parent().unwrap()).unwrap();
        fs::write(
            state_path,
            serde_json::to_string(&MarkdownDocumentState {
                source_hash: StoredContentHash::Legacy(legacy_content_hash(markdown)),
                document: document_json.clone(),
            })
            .unwrap(),
        )
        .unwrap();

        assert_eq!(
            read_markdown_state(&app_data, &target, markdown),
            Some(document_json)
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn external_markdown_changes_invalidate_cached_canvas_state() {
        let directory = test_directory("markdown-external-change");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");
        save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 第一版\n",
            &document("第一版"),
            None,
        )
        .unwrap();
        fs::write(&target, "# 方案\n\n- 外部修改\n").unwrap();

        let loaded = load_markdown_from_target(&app_data, &target, false).unwrap();

        assert!(loaded.document.is_none());
        assert_eq!(
            loaded.outline_content.as_deref(),
            Some("# 方案\n\n- 外部修改\n")
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn refuses_to_overwrite_markdown_changed_by_another_editor() {
        let directory = test_directory("markdown-conflict");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");
        let original = "# 方案\n\n- 第一版\n";
        let expected_hash =
            save_markdown_document(&app_data, &target, original, &document("第一版"), None)
                .unwrap()
                .source_hash;
        let external = "# 方案\n\n- 外部编辑器新增内容\n";
        fs::write(&target, external).unwrap();

        let result = save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 应用内修改\n",
            &document("应用内修改"),
            Some(&expected_hash),
        );

        assert!(result.unwrap_err().starts_with(EXTERNAL_DOCUMENT_CONFLICT));
        assert_eq!(fs::read_to_string(&target).unwrap(), external);
        assert_eq!(markdown_backup_count(&app_data, &target), 0);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn refuses_to_recreate_a_bound_markdown_file_deleted_externally() {
        let directory = test_directory("markdown-deleted-conflict");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");
        let expected_hash = save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 第一版\n",
            &document("第一版"),
            None,
        )
        .unwrap()
        .source_hash;
        fs::remove_file(&target).unwrap();

        let result = save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 应用内修改\n",
            &document("应用内修改"),
            Some(&expected_hash),
        );

        assert!(result.unwrap_err().starts_with(EXTERNAL_DOCUMENT_CONFLICT));
        assert!(!target.exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn refuses_to_save_an_unbound_copy_over_its_canonical_source_path() {
        let directory = test_directory("protected-markdown-source");
        let app_data = directory.join("app-data");
        let source = directory.join("复杂方案.md");
        let rich_markdown = "# 复杂方案\n\n正文段落\n\n```ts\nconst preserved = true\n```\n";
        fs::create_dir_all(&directory).unwrap();
        fs::write(&source, rich_markdown).unwrap();
        let equivalent_target = directory.join(".").join("复杂方案.md");

        let result = save_markdown_document_with_protected_source(
            &app_data,
            &equivalent_target,
            "# 复杂方案\n\n- 普通大纲\n",
            &document("复杂方案"),
            None,
            Some(&source),
        );

        assert!(result.unwrap_err().starts_with(PROTECTED_SOURCE_OVERWRITE));
        assert_eq!(fs::read_to_string(&source).unwrap(), rich_markdown);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reports_auxiliary_state_failure_without_denial_after_markdown_commit() {
        let directory = test_directory("markdown-auxiliary-warning");
        let app_data = directory.join("app-data");
        fs::create_dir_all(&app_data).unwrap();
        fs::write(app_data.join(DOCUMENT_STATE_DIRECTORY), "blocked").unwrap();
        let target = directory.join("方案.md");
        let markdown = "# 方案\n\n- 已提交正文\n";

        let saved =
            save_markdown_document(&app_data, &target, markdown, &document("方案"), None).unwrap();

        assert_eq!(saved.source_hash, content_hash_string(markdown));
        assert!(saved.auxiliary_warning.is_some());
        assert_eq!(fs::read_to_string(&target).unwrap(), markdown);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn markdown_backups_skip_duplicates_and_keep_real_content_versions() {
        let directory = test_directory("markdown-backups");
        let app_data = directory.join("app-data");
        let target = directory.join("方案.md");

        save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 第一版\n",
            &document("第一版"),
            None,
        )
        .unwrap();
        save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 第一版\n",
            &document("第一版"),
            None,
        )
        .unwrap();
        assert_eq!(markdown_backup_count(&app_data, &target), 0);

        save_markdown_document(
            &app_data,
            &target,
            "# 方案\n\n- 第二版\n",
            &document("第二版"),
            None,
        )
        .unwrap();
        assert_eq!(markdown_backup_count(&app_data, &target), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn accepts_only_markdown_working_file_extensions() {
        assert!(ensure_markdown_path(Path::new("方案.md")).is_ok());
        assert!(ensure_markdown_path(Path::new("方案.markdown")).is_ok());
        assert!(ensure_markdown_path(Path::new("方案.mindmap.json")).is_err());
    }
}
