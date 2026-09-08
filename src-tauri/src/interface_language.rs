use serde::Deserialize;
use tauri::AppHandle;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InterfaceLanguage {
    Zh,
    En,
}

fn translated_menu_text(text: &str, language: InterfaceLanguage) -> Option<String> {
    let pairs = [
        ("File", "文件"), ("Edit", "编辑"), ("View", "视图"),
        ("Window", "窗口"), ("Help", "帮助"), ("Services", "服务"),
        ("Undo", "撤销"), ("Redo", "重做"), ("Cut", "剪切"),
        ("Copy", "复制"), ("Paste", "粘贴"), ("Select All", "全选"),
        ("Minimize", "最小化"), ("Zoom", "缩放"), ("Maximize", "最大化"),
        ("Close Window", "关闭窗口"), ("Close", "关闭"),
        ("Hide Others", "隐藏其他"), ("Show All", "显示全部"),
        ("Enter Full Screen", "进入全屏幕"), ("Exit Full Screen", "退出全屏幕"),
        ("Toggle Fullscreen", "切换全屏幕"), ("Bring All to Front", "前置全部窗口"),
        ("Quit", "退出"), ("About", "关于"), ("Hide", "隐藏"),
    ];
    for (english, chinese) in pairs {
        if text == english || text == chinese {
            return Some(match language { InterfaceLanguage::Zh => chinese, InterfaceLanguage::En => english }.into());
        }
    }
    for (english, chinese) in [("About ", "关于 "), ("Hide ", "隐藏 "), ("Quit ", "退出 ")] {
        if let Some(name) = text.strip_prefix(english).or_else(|| text.strip_prefix(chinese)) {
            let prefix = match language { InterfaceLanguage::Zh => chinese, InterfaceLanguage::En => english };
            return Some(format!("{prefix}{name}"));
        }
    }
    None
}

#[cfg(desktop)]
fn update_items(items: Vec<tauri::menu::MenuItemKind<tauri::Wry>>, language: InterfaceLanguage) -> tauri::Result<()> {
    use tauri::menu::MenuItemKind;
    for item in items {
        match item {
            MenuItemKind::Submenu(item) => {
                if let Some(text) = translated_menu_text(&item.text()?, language) { item.set_text(text)?; }
                update_items(item.items()?, language)?;
            }
            MenuItemKind::MenuItem(item) => {
                if let Some(text) = translated_menu_text(&item.text()?, language) { item.set_text(text)?; }
            }
            MenuItemKind::Predefined(item) => {
                if let Some(text) = translated_menu_text(&item.text()?, language) { item.set_text(text)?; }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Only labels change. Preserve menu IDs, native actions and the custom quit/save handshake.
#[tauri::command]
pub fn set_interface_language(app: AppHandle, language: InterfaceLanguage) -> Result<(), String> {
    #[cfg(desktop)]
    if let Some(menu) = app.menu() {
        update_items(menu.items().map_err(|error| error.to_string())?, language)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_round_trip_without_changing_app_names() {
        assert_eq!(translated_menu_text("Hide Others", InterfaceLanguage::Zh).as_deref(), Some("隐藏其他"));
        assert_eq!(translated_menu_text("退出 Laniakea", InterfaceLanguage::En).as_deref(), Some("Quit Laniakea"));
        assert_eq!(translated_menu_text("Laniakea", InterfaceLanguage::Zh), None);
        assert_eq!(translated_menu_text("Enter Full Screen", InterfaceLanguage::Zh).as_deref(), Some("进入全屏幕"));
    }
}
