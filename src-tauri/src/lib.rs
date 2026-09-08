mod preferences;
mod storage;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
#[cfg(target_os = "macos")]
use tauri::menu::MenuItem;
#[cfg(desktop)]
use tauri::Manager;
use tauri::{AppHandle, Emitter, State};
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const DEFAULT_GLOBAL_SHORTCUT: &str = "CommandOrControl+Shift+M";
const APPLICATION_EXIT_REQUESTED_EVENT: &str = "origin://application-exit-requested";
const WINDOW_CLOSE_REQUESTED_EVENT: &str = "tauri://close-requested";
#[cfg(target_os = "macos")]
const APPLICATION_QUIT_MENU_ID: &str = "origin-quit-after-save";

struct DesktopRuntimeState {
    global_shortcut_registered: AtomicBool,
    global_shortcut: Mutex<String>,
    application_exit_allowed: AtomicBool,
    application_exit_listener_ready: AtomicBool,
    application_exit_request_pending: AtomicBool,
    window_close: Mutex<WindowCloseState>,
}

#[derive(Default)]
struct WindowCloseState {
    listener_ready: bool,
    pending: bool,
}

impl WindowCloseState {
    fn request(&mut self) {
        if !self.listener_ready {
            self.pending = true;
        }
    }

    fn register_listener(&mut self) -> bool {
        self.listener_ready = true;
        std::mem::take(&mut self.pending)
    }
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            global_shortcut_registered: AtomicBool::new(false),
            global_shortcut: Mutex::new(DEFAULT_GLOBAL_SHORTCUT.to_string()),
            application_exit_allowed: AtomicBool::new(false),
            application_exit_listener_ready: AtomicBool::new(false),
            application_exit_request_pending: AtomicBool::new(false),
            window_close: Mutex::new(WindowCloseState::default()),
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
    window_focused: bool,
}

#[tauri::command]
fn desktop_runtime_status(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> DesktopRuntimeStatus {
    #[cfg(desktop)]
    let window_focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    #[cfg(not(desktop))]
    let window_focused = true;

    DesktopRuntimeStatus {
        global_shortcut_registered: state.global_shortcut_registered.load(Ordering::Relaxed),
        global_shortcut: state
            .global_shortcut
            .lock()
            .map(|shortcut| shortcut.clone())
            .unwrap_or_else(|_| DEFAULT_GLOBAL_SHORTCUT.to_string()),
        window_focused,
    }
}

#[tauri::command]
fn register_application_exit_listener(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    // The frontend registers onCloseRequested before this readiness command.
    // Keep the WebView alive until then and replay an early close through that
    // same handler, which waits for document recovery and the latest save.
    let replay_close = state
        .window_close
        .lock()
        .map_err(|_| "无法恢复关闭窗口请求".to_string())?
        .register_listener();
    if replay_close {
        app.emit_to(
            tauri::EventTarget::Window {
                label: "main".into(),
            },
            WINDOW_CLOSE_REQUESTED_EVENT,
            (),
        )
        .map_err(|_| "无法通知前端完成关闭前保存".to_string())?;
    }
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

#[tauri::command]
fn finish_window_close(
    app: AppHandle,
    state: State<'_, DesktopRuntimeState>,
) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        #[cfg(desktop)]
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(|_| "无法关闭窗口".to_string())?;
        }
    } else {
        // Windows/Linux have no macOS Dock reopen event. A successful close
        // ends the process instead of leaving an invisible app behind.
        resolve_application_exit(app, state, true);
    }
    Ok(())
}

#[cfg(desktop)]
fn request_frontend_application_exit(app: &AppHandle) {
    let state = app.state::<DesktopRuntimeState>();
    if state.application_exit_allowed.load(Ordering::SeqCst) {
        app.exit(0);
        return;
    }
    if !state.begin_application_exit_request() {
        return;
    }
    if state.application_exit_listener_ready.load(Ordering::SeqCst)
        && app.emit(APPLICATION_EXIT_REQUESTED_EVENT, ()).is_err()
    {
        state
            .application_exit_request_pending
            .store(false, Ordering::SeqCst);
    }
}

#[cfg(target_os = "macos")]
fn replace_macos_quit_menu(app: &AppHandle) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let menu_items = menu.items()?;
    let Some(app_menu) = menu_items.first().and_then(|item| item.as_submenu()) else {
        return Ok(());
    };
    let app_menu_items = app_menu.items()?;
    let Some(default_quit_index) = app_menu_items.len().checked_sub(1) else {
        return Ok(());
    };
    if app_menu_items[default_quit_index]
        .as_predefined_menuitem()
        .is_none()
    {
        return Ok(());
    }

    app_menu.remove_at(default_quit_index)?;
    let quit = MenuItem::with_id(
        app,
        APPLICATION_QUIT_MENU_ID,
        format!("Quit {}", app.package_info().name),
        true,
        Some("Command+Q"),
    )?;
    app_menu.append(&quit)?;
    Ok(())
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
        return Ok(desktop_runtime_status(app, state));
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
    Ok(desktop_runtime_status(app, state))
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
async fn reveal_document_in_file_manager(document_path: String) -> Result<(), String> {
    // Waiting on the file-manager process must not occupy the main thread;
    // the validation and spawn both run on the blocking pool.
    tauri::async_runtime::spawn_blocking(move || {
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
    })
    .await
    .map_err(|error| format!("无法打开文件管理器: {error}"))?
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
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopRuntimeState>();
                if !state.application_exit_allowed.load(Ordering::SeqCst) {
                    // Tauri's own veto depends on a registered JS listener.
                    // Own the veto from window creation, including cold start.
                    api.prevent_close();
                    if let Ok(mut close) = state.window_close.lock() {
                        close.request();
                    }
                }
            }
        })
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
            #[cfg(target_os = "macos")]
            {
                replace_macos_quit_menu(app.handle())?;
                app.on_menu_event(|app, event| {
                    if event.id().as_ref() == APPLICATION_QUIT_MENU_ID {
                        request_frontend_application_exit(app);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            register_application_exit_listener,
            reveal_document_in_file_manager,
            resolve_application_exit,
            finish_window_close,
            set_global_shortcut,
            storage::activate_local_document,
            storage::clear_pending_recovery,
            storage::clear_active_document,
            storage::create_markdown_draft,
            storage::discard_pending_recovery,
            storage::discard_internal_draft,
            storage::load_local_document,
            storage::move_internal_draft,
            storage::open_local_document,
            storage::read_outline_file,
            storage::save_local_document,
            storage::write_editor_recovery_draft,
            storage::write_recovery_checkpoint,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Laniakea")
        .run(|app, event| {
            #[cfg(desktop)]
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen {
                    has_visible_windows: false,
                    ..
                } => show_main_window(app),
                tauri::RunEvent::ExitRequested { api, .. } => {
                    let state = app.state::<DesktopRuntimeState>();
                    if !state.application_exit_allowed.load(Ordering::SeqCst) {
                        api.prevent_exit();
                        request_frontend_application_exit(app);
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        validate_global_shortcut, validate_reveal_target, DesktopRuntimeState, WindowCloseState,
    };
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

    #[test]
    fn early_window_closes_are_coalesced_and_replayed_once_after_registration() {
        let mut close = WindowCloseState::default();
        close.request();
        close.request();
        assert!(close.register_listener());
        assert!(!close.register_listener());
        // Once ready, Tauri delivers ordinary close events to the JS listener.
        close.request();
        assert!(!close.pending);
    }
}
