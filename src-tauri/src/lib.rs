mod preferences;
mod storage;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
#[cfg(desktop)]
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const DEFAULT_GLOBAL_SHORTCUT: &str = "CommandOrControl+Shift+M";
const APPLICATION_EXIT_REQUESTED_EVENT: &str = "origin://application-exit-requested";

struct DesktopRuntimeState {
    global_shortcut_registered: AtomicBool,
    global_shortcut: Mutex<String>,
    application_exit_allowed: AtomicBool,
    application_exit_listener_ready: AtomicBool,
    application_exit_request_pending: AtomicBool,
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            global_shortcut_registered: AtomicBool::new(false),
            global_shortcut: Mutex::new(DEFAULT_GLOBAL_SHORTCUT.to_string()),
            application_exit_allowed: AtomicBool::new(false),
            application_exit_listener_ready: AtomicBool::new(false),
            application_exit_request_pending: AtomicBool::new(false),
        }
    }
}

impl DesktopRuntimeState {
    fn begin_application_exit_request(&self) -> bool {
        !self
            .application_exit_request_pending
            .swap(true, Ordering::SeqCst)
    }

    fn resolve_application_exit_request(&self, saved: bool) {
        self.application_exit_request_pending
            .store(false, Ordering::SeqCst);
        if saved {
            self.application_exit_allowed.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeStatus {
    global_shortcut_registered: bool,
    global_shortcut: String,
}

#[tauri::command]
fn desktop_runtime_status(state: State<'_, DesktopRuntimeState>) -> DesktopRuntimeStatus {
    DesktopRuntimeStatus {
        global_shortcut_registered: state.global_shortcut_registered.load(Ordering::Relaxed),
        global_shortcut: state
            .global_shortcut
            .lock()
            .map(|shortcut| shortcut.clone())
            .unwrap_or_else(|_| DEFAULT_GLOBAL_SHORTCUT.to_string()),
    }
}

#[tauri::command]
fn register_application_exit_listener(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    state
        .application_exit_listener_ready
        .store(true, Ordering::SeqCst);
    if state
        .application_exit_request_pending
        .load(Ordering::SeqCst)
    {
        app.emit(APPLICATION_EXIT_REQUESTED_EVENT, ())
            .map_err(|error| format!("无法通知前端完成退出前保存: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn resolve_application_exit(app: AppHandle, state: State<'_, DesktopRuntimeState>, saved: bool) {
    state.resolve_application_exit_request(saved);
    if saved {
        app.exit(0);
    }
}

fn validate_global_shortcut(shortcut: &str) -> Result<(), String> {
    let modifiers = [
        "CommandOrControl",
        "Command",
        "Meta",
        "Control",
        "Alt",
        "Option",
        "Shift",
    ];
    let parts = shortcut.split('+').collect::<Vec<_>>();
    let modifier_count = modifiers
        .into_iter()
        .filter(|modifier| parts.iter().any(|part| part == modifier))
        .count();
    let has_key = parts
        .last()
        .is_some_and(|part| !modifiers.contains(part) && !part.is_empty());
    if shortcut.len() > 64 || parts.len() < 2 || modifier_count == 0 || !has_key {
        return Err("请使用至少一个修饰键和一个普通按键".to_string());
    }
    Ok(())
}

#[tauri::command]
fn set_global_shortcut(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
    global_shortcut: String,
) -> Result<DesktopRuntimeStatus, String> {
    validate_global_shortcut(&global_shortcut)?;
    let current = state
        .global_shortcut
        .lock()
        .map_err(|_| "无法读取当前全局快捷键".to_string())?
        .clone();
    if current == global_shortcut && state.global_shortcut_registered.load(Ordering::Relaxed) {
        return Ok(desktop_runtime_status(state));
    }

    #[cfg(desktop)]
    {
        app.global_shortcut()
            .register(global_shortcut.as_str())
            .map_err(|_| "这个快捷键已被其他应用占用，请换一个组合".to_string())?;

        if state.global_shortcut_registered.load(Ordering::Relaxed)
            && app.global_shortcut().unregister(current.as_str()).is_err()
        {
            let _ = app.global_shortcut().unregister(global_shortcut.as_str());
            return Err("无法替换当前全局快捷键".to_string());
        }

        if let Err(error) = preferences::save_global_shortcut(&app, &global_shortcut) {
            let _ = app.global_shortcut().unregister(global_shortcut.as_str());
            let restored = app.global_shortcut().register(current.as_str()).is_ok();
            state
                .global_shortcut_registered
                .store(restored, Ordering::Relaxed);
            return Err(error);
        }
    }

    *state
        .global_shortcut
        .lock()
        .map_err(|_| "无法更新全局快捷键".to_string())? = global_shortcut;
    state
        .global_shortcut_registered
        .store(true, Ordering::Relaxed);
    Ok(desktop_runtime_status(state))
}

fn validate_reveal_target(document_path: &str) -> Result<PathBuf, String> {
    if document_path.trim().is_empty() {
        return Err("文件路径为空".to_string());
    }
    let target = Path::new(document_path);
    if !target.is_file() {
        return Err("这个文件已不存在".to_string());
    }
    Ok(target.to_path_buf())
}

#[tauri::command]
fn reveal_document_in_file_manager(document_path: String) -> Result<(), String> {
    let target = validate_reveal_target(&document_path)?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(&target).status();

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .arg(format!("/select,{}", target.display()))
        .status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(target.parent().unwrap_or_else(|| Path::new("/")))
        .status();

    let status = status.map_err(|_| "无法打开文件管理器".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("无法在文件管理器中显示这个文件".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                show_main_window(app);
            })
            .build(),
    );
    builder
        .manage(DesktopRuntimeState::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let configured =
                    preferences::load_global_shortcut(app.handle(), DEFAULT_GLOBAL_SHORTCUT);
                let registered = app.global_shortcut().register(configured.as_str()).is_ok();
                let state = app.state::<DesktopRuntimeState>();
                state
                    .global_shortcut_registered
                    .store(registered, Ordering::Relaxed);
                if let Ok(mut shortcut) = state.global_shortcut.lock() {
                    *shortcut = configured;
                };
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            register_application_exit_listener,
            reveal_document_in_file_manager,
            resolve_application_exit,
            set_global_shortcut,
            storage::activate_local_document,
            storage::clear_active_document,
            storage::create_markdown_draft,
            storage::discard_internal_draft,
            storage::load_local_document,
            storage::move_internal_draft,
            storage::open_local_document,
            storage::read_outline_file,
            storage::save_local_document,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Laniakea")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Reopen {
                    has_visible_windows: false,
                    ..
                } => show_main_window(app),
                tauri::RunEvent::ExitRequested { api, .. } => {
                    let state = app.state::<DesktopRuntimeState>();
                    if !state.application_exit_allowed.load(Ordering::SeqCst) {
                        api.prevent_exit();
                        let first_request = state.begin_application_exit_request();
                        if first_request
                            && state.application_exit_listener_ready.load(Ordering::SeqCst)
                        {
                            let _ = app.emit(APPLICATION_EXIT_REQUESTED_EVENT, ());
                        }
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{validate_global_shortcut, validate_reveal_target, DesktopRuntimeState};
    use std::sync::atomic::Ordering;

    #[test]
    fn global_shortcut_requires_modifier_and_key() {
        assert!(validate_global_shortcut("CommandOrControl+Shift+J").is_ok());
        assert!(validate_global_shortcut("M").is_err());
        assert!(validate_global_shortcut("Shift").is_err());
    }

    #[test]
    fn reveal_target_rejects_missing_files() {
        let missing = std::env::temp_dir().join("origin-reveal-target-that-does-not-exist.md");
        assert!(validate_reveal_target(missing.to_string_lossy().as_ref(),).is_err());
    }

    #[test]
    fn application_exit_requires_a_successful_save_before_it_is_allowed() {
        let state = DesktopRuntimeState::default();

        assert!(state.begin_application_exit_request());
        assert!(!state.begin_application_exit_request());
        assert!(!state.application_exit_allowed.load(Ordering::SeqCst));

        state.resolve_application_exit_request(false);
        assert!(state.begin_application_exit_request());
        state.resolve_application_exit_request(true);

        assert!(state.application_exit_allowed.load(Ordering::SeqCst));
        assert!(!state
            .application_exit_request_pending
            .load(Ordering::SeqCst));
    }
}
