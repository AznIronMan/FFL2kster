//! Desktop shell: one window showing the web build (port/apps/web/dist). Game data and saves stay
//! in the web view's IndexedDB (the app's data directory); the dialog and fs plugins let the page
//! choose a ROM and export or import save files (platform.ts).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running the Tower of Legends desktop shell");
}
