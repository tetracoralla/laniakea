mod storage;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use tauri::Manager;
use tauri::State;
#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const GLOBAL_SHORTCUT: &str = "CommandOrControl+Shift+M";

#[derive(Default)]
struct DesktopRuntimeState {
    global_shortcut_registered: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeStatus {
    global_shortcut_registered: bool,
    global_shortcut: &'static str,
}

#[tauri::command]
fn desktop_runtime_status(state: State<'_, DesktopRuntimeState>) -> DesktopRuntimeStatus {
    DesktopRuntimeStatus {
        global_shortcut_registered: state.global_shortcut_registered.load(Ordering::Relaxed),
        global_shortcut: GLOBAL_SHORTCUT,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            })
            .build(),
    );
    builder
        .manage(DesktopRuntimeState::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let registered = app.global_shortcut().register(GLOBAL_SHORTCUT).is_ok();
                app.state::<DesktopRuntimeState>()
                    .global_shortcut_registered
                    .store(registered, Ordering::Relaxed);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            storage::load_local_document,
            storage::save_local_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running 原点");
}
