#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ollama;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ollama::ollama_status, ollama::ollama_generate])
        .run(tauri::generate_context!())
        .expect("error while running raphael application");
}
