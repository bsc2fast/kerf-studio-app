// Kerf desktop bridge — Tauri v2.
// Serves the shared web app (../../app) in a window, exposes a tray icon, and
// provides two commands the frontend calls to talk to the cutter over TCP:
//   ping_machine(ip, port) -> latency ms
//   send_plt(ip, port, data) -> bytes written
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

fn resolve(ip: &str, port: u16) -> Result<std::net::SocketAddr, String> {
    (ip, port)
        .to_socket_addrs()
        .map_err(|e| format!("bad address {ip}:{port}: {e}"))?
        .next()
        .ok_or_else(|| format!("could not resolve {ip}:{port}"))
}

#[tauri::command]
fn ping_machine(ip: String, port: u16) -> Result<f64, String> {
    let addr = resolve(&ip, port)?;
    let start = Instant::now();
    TcpStream::connect_timeout(&addr, Duration::from_secs(2)).map_err(|e| e.to_string())?;
    Ok((start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0)
}

#[tauri::command]
fn send_plt(ip: String, port: u16, data: String) -> Result<usize, String> {
    let addr = resolve(&ip, port)?;
    let mut stream =
        TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(15)))
        .ok();
    let bytes = data.as_bytes();
    stream.write_all(bytes).map_err(|e| e.to_string())?;
    stream.flush().ok();
    Ok(bytes.len())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping_machine, send_plt])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Kerf", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Kerf")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Kerf");
}

fn main() {
    run();
}
