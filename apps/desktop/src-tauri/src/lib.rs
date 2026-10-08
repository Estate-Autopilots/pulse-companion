mod companion;
mod updater;
use updater::{update_check, update_prepare, update_install, update_healthy, Updates, Gate};

use companion::Companion;
use pulse_desktop_core::{
    tracker::{Settings, Status, Tracker},
    AgentCore, AgentStatus,
};
use serde_json::Value;
use std::{
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

const ICON_IDLE: &[u8] = include_bytes!("../icons/tray.png");
const ICON_IN: &[u8] = include_bytes!("../icons/tray-in.png");
const ICON_BREAK: &[u8] = include_bytes!("../icons/tray-break.png");
const ICON_ALERT: &[u8] = include_bytes!("../icons/tray-alert.png");
#[cfg(target_os = "macos")]
const ICON_TEMPLATE: &[u8] = include_bytes!("../icons/tray-template.png");
const PANEL: &str = "panel";
const PANEL_WIDTH: f64 = 360.0;
const MARGIN: f64 = 14.0;

/// Where the panel opens: under the tray icon on a Mac, above the bottom-right corner on Windows.
#[derive(Default)]
struct Anchor {
    tray: Option<(f64, f64, f64, f64)>,
    hidden_at: Option<Instant>,
    shown_at: Option<Instant>,
    pinned: bool,
}

// ------------------------------------------------------------------------------------------------ the panel
fn panel(app: &AppHandle) -> Option<WebviewWindow> { app.get_webview_window(PANEL) }

fn place(app: &AppHandle, win: &WebviewWindow) {
    let Ok(size) = win.outer_size() else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let margin = (MARGIN * scale) as i32;
    let tray = app.state::<Mutex<Anchor>>().lock().unwrap().tray;
    let monitor = tray
        .and_then(|(x, y, _, _)| app.monitor_from_point(x, y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let area = monitor.work_area();
    let (left, top) = (area.position.x, area.position.y);
    let (right, bottom) = (left + area.size.width as i32, top + area.size.height as i32);
    let (w, h) = (size.width as i32, size.height as i32);
    let (mut x, mut y) = (right - w - margin, bottom - h - margin);
    if cfg!(target_os = "macos") {
        if let Some((tx, ty, tw, th)) = tray {
            x = (tx + tw / 2.0) as i32 - w / 2;
            y = (ty + th) as i32 + margin / 2;
        } else {
            y = top + margin / 2;
        }
    }
    x = x.clamp(left + margin, (right - w - margin).max(left + margin));
    y = y.clamp(top, (bottom - h).max(top));
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

fn show_panel(app: &AppHandle) {
    let Some(win) = panel(app) else { return };
    place(app, &win);
    app.state::<Mutex<Anchor>>().lock().unwrap().shown_at = Some(Instant::now());
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    let _ = win.eval("window.pulsePanel?.shown()");
}

fn hide_panel(app: &AppHandle) {
    if let Some(win) = panel(app) {
        let _ = win.hide();
        app.state::<Mutex<Anchor>>().lock().unwrap().hidden_at = Some(Instant::now());
    }
}

fn toggle_panel(app: &AppHandle) {
    let Some(win) = panel(app) else { return };
    // A click on the tray first takes focus from the panel (which hides it); don't reopen it straight away.
    let just_hidden = app.state::<Mutex<Anchor>>().lock().unwrap().hidden_at.is_some_and(|t| t.elapsed() < Duration::from_millis(350));
    if win.is_visible().unwrap_or(false) { hide_panel(app); } else if !just_hidden { show_panel(app); }
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();
    result.map(|_| ()).map_err(|_| format!("Open {url} in your browser"))
}

fn show_privacy(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("privacy") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, "privacy", WebviewUrl::App("privacy.html".into()))
        .title("Pulse · Settings & privacy")
        .inner_size(1040., 720.)
        .min_inner_size(880., 600.)
        .center()
        .build();
}

// ------------------------------------------------------------------------------------------- companion commands
fn err(e: companion::CallError) -> String { e.text() }

#[tauri::command]
fn companion_session(state: State<'_, Companion>) -> Value { state.session() }

#[tauri::command]
async fn companion_request(app: AppHandle, path: String, body: Option<Value>) -> Result<Value, String> {
    if !path.chars().all(|c| c.is_ascii_alphanumeric() || "/-?=&".contains(c)) { return Err(companion::CallError::default().text()); }
    {
        let gate_state = app.state::<Gate>(); let mut gate = gate_state.0.lock().unwrap();
        if gate.1 { return Err("Pulse is installing an update. Try again after restart.".into()); }
        gate.0 += 1;
    }
    let request_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || request_app.state::<Companion>().request(&path, body).map_err(err))
        .await.map_err(|_| "{\"message\":\"Pulse request interrupted\"}".to_string());
    app.state::<Gate>().0.lock().unwrap().0 -= 1;
    result?
}

#[tauri::command]
async fn companion_pair_start(app: AppHandle, base: String) -> Result<Value, String> {
    let started = tauri::async_runtime::spawn_blocking(move || app.state::<Companion>().pair_start(&base).map_err(err))
        .await
        .map_err(|_| "{\"message\":\"Pulse request interrupted\"}".to_string())??;
    if let Some(url) = started["verifyUrl"].as_str() { let _ = open_url(url); }
    Ok(started)
}

#[tauri::command]
async fn companion_pair_poll(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Companion>().pair_poll().map_err(err))
        .await
        .map_err(|_| "{\"message\":\"Pulse request interrupted\"}".to_string())?
}

#[tauri::command]
fn companion_pair_cancel(state: State<'_, Companion>) { state.pair_cancel(); }

#[tauri::command]
async fn companion_password(app: AppHandle, base: String, username: String, password: String, code: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let c = app.state::<Companion>();
        match code.filter(|c| !c.trim().is_empty()) { Some(code) => c.two_step(code.trim()), None => c.password(&base, &username, &password) }.map_err(err)
    })
    .await
    .map_err(|_| "{\"message\":\"Pulse request interrupted\"}".to_string())?
}

#[tauri::command]
async fn companion_sign_out(app: AppHandle) -> Result<Value, String> {
    if app.state::<Gate>().0.lock().unwrap().1 { return Err("Wait for Pulse to finish installing".into()); }
    tauri::async_runtime::spawn_blocking(move || app.state::<Companion>().sign_out())
        .await
        .map_err(|_| "Sign-out interrupted".to_string())
}

#[tauri::command]
fn open_pulse(state: State<'_, Companion>, path: String) -> Result<(), String> {
    let path = if path.starts_with('/') && !path.starts_with("//") { path } else { "/me".into() };
    open_url(&format!("{}{}", companion::site(&state.base()), path))
}

#[tauri::command]
fn panel_fit(app: AppHandle, height: f64) {
    let Some(win) = panel(&app) else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let height = height.clamp(220.0, 680.0);
    let _ = win.set_size(PhysicalSize::new((PANEL_WIDTH * scale) as u32, (height * scale) as u32));
    if win.is_visible().unwrap_or(false) { place(&app, &win); }
}

#[tauri::command]
fn panel_show(app: AppHandle) { show_panel(&app); }

#[tauri::command]
fn panel_hide(app: AppHandle) { hide_panel(&app); }

#[tauri::command]
fn panel_pin(app: AppHandle, pinned: bool) { app.state::<Mutex<Anchor>>().lock().unwrap().pinned = pinned; }

/// The tray mirrors the day: icon tone, tooltip, and on a Mac the timer next to the icon.
#[tauri::command]
fn set_tray(app: AppHandle, text: String, tone: String, title: String) {
    let Some(tray) = app.tray_by_id("pulse") else { return };
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_title(if text.is_empty() { None } else { Some(text.chars().take(8).collect::<String>()) });
        let _ = tone;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = &text;
        let bytes = match tone.as_str() { "success" => ICON_IN, "info" => ICON_BREAK, "warning" => ICON_ALERT, _ => ICON_IDLE };
        if let Ok(icon) = Image::from_bytes(bytes) { let _ = tray.set_icon(Some(icon)); }
    }
    let _ = tray.set_tooltip(Some(title.chars().take(120).collect::<String>()));
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification().builder().title(title.chars().take(80).collect::<String>()).body(body.chars().take(200).collect::<String>()).show().map_err(|_| "Notifications are turned off for Pulse".to_string())
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool { app.autolaunch().is_enabled().unwrap_or(false) }

#[tauri::command]
fn autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled { manager.enable() } else { manager.disable() }.map_err(|_| "Your computer did not allow Pulse to change this".to_string())?;
    Ok(manager.is_enabled().unwrap_or(enabled))
}

#[tauri::command]
fn app_info() -> Value {
    serde_json::json!({"version": env!("CARGO_PKG_VERSION"), "platform": companion::platform(), "shortcut": if cfg!(target_os = "macos") { "⌃⌥P" } else { "Ctrl+Alt+P" }})
}

#[tauri::command]
fn open_privacy(app: AppHandle) { show_privacy(&app); }

// ------------------------------------------------- optional focus/idle metadata (off unless the notice is accepted)
#[tauri::command]
fn agent_status(state: State<'_, AgentCore>) -> AgentStatus { state.status() }

#[tauri::command]
fn tracker_status(state: State<'_, Tracker>, core: State<'_, AgentCore>) -> Status { state.status(&core) }
#[tauri::command]
async fn tracker_configure(app: AppHandle, settings: Settings) -> Result<(), String> {
    let tracker = app.state::<Tracker>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || tracker.configure(settings))
        .await
        .map_err(|_| "Native request interrupted".to_string())?
}
#[tauri::command]
async fn tracker_login(app: AppHandle, api: String, username: String, password: String) -> Result<Value, String> {
    let tracker = app.state::<Tracker>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || tracker.login(api, username, password))
        .await
        .map_err(|_| "Native request interrupted".to_string())?
}
#[tauri::command]
async fn tracker_verify_login(app: AppHandle, api: String, challenge: String, code: String) -> Result<Value, String> {
    let tracker = app.state::<Tracker>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || tracker.verify_login(api, challenge, code))
        .await
        .map_err(|_| "Native request interrupted".to_string())?
}
#[tauri::command]
fn tracker_open_recovery(state: State<'_, Companion>) -> Result<(), String> {
    open_url(&format!("{}/login", companion::site(&state.base())))
}
#[tauri::command]
fn tracker_pause(state: State<'_, Tracker>, core: State<'_, AgentCore>, paused: bool) -> Result<(), String> {
    state.pause(paused)?;
    core.set_pause(if paused { "until-resumed" } else { "resume" })?;
    Ok(())
}
#[tauri::command]
fn bridge_info(state: State<'_, Tracker>) -> Value {
    serde_json::json!({"url":"http://127.0.0.1:47831/commands","token":state.bridge_token()})
}
#[tauri::command]
async fn tracker_sign_out(app: AppHandle) -> Result<(), String> {
    let tracker = app.state::<Tracker>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || tracker.sign_out())
        .await
        .map_err(|_| "Native request interrupted".to_string())?
}
#[tauri::command]
fn open_workspace(state: State<'_, Companion>) -> Result<(), String> {
    open_url(&format!("{}/me", companion::site(&state.base())))
}

pub fn run() {
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP);
    let register = toggle.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_panel(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Updates::default())
        .manage(Gate::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle && event.state() == ShortcutState::Pressed { toggle_panel(app); }
                })
                .build(),
        )
        .manage(Companion::new())
        .manage(Mutex::new(Anchor::default()))
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let local_data_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&local_data_dir)?;
            // Optional activity metadata: starts paused and stays off unless the person accepts the published notice.
            let core = AgentCore::from_environment(local_data_dir.join("outbox.bin")).map_err(std::io::Error::other)?;
            app.manage(core.clone());
            let tracker = Tracker::open(local_data_dir.join("native-tracker.bin")).map_err(std::io::Error::other)?;
            if tracker.status(&core).paused { core.set_pause("until-resumed").map_err(std::io::Error::other)?; }
            app.manage(tracker.clone());
            let (bridge_tracker, bridge_core) = (tracker.clone(), core.clone());
            thread::Builder::new().name("pulse-adobe-bridge".into()).spawn(move || { let _ = pulse_desktop_core::bridge::serve(bridge_tracker, bridge_core); })?;
            let tracker_core = core.clone();
            thread::Builder::new().name("pulse-sensors".into()).spawn(move || loop { let _ = tracker.tick(&tracker_core); thread::sleep(Duration::from_secs(5)); })?;
            let sync_core = core.clone();
            let _ = thread::Builder::new().name("pulse-ingest".into()).spawn(move || loop { let _ = sync_core.sync_once(); thread::sleep(Duration::from_secs(15)); });

            // The companion panel: small, frameless, above other windows, out of the taskbar.
            let win = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("index.html".into()))
                .title("Pulse")
                .inner_size(PANEL_WIDTH, 460.0)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(true)
                .visible(false)
                .build()?;
            let handle = app.handle().clone();
            win.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    // Windows can report a focus change while the web view first appears; give the panel a moment.
                    let (pinned, settling) = { let a = handle.state::<Mutex<Anchor>>(); let a = a.lock().unwrap(); (a.pinned, a.shown_at.is_some_and(|t| t.elapsed() < Duration::from_millis(1200))) };
                    if !pinned && !settling { hide_panel(&handle); }
                }
                if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); hide_panel(&handle); }
            });

            let open = MenuItem::with_id(app, "panel", "Open Pulse panel", true, Some("CmdOrCtrl+Alt+P"))?;
            let web = MenuItem::with_id(app, "web", "Open Pulse in the browser", true, None::<&str>)?;
            let privacy = MenuItem::with_id(app, "privacy", "Settings & privacy…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Pulse", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &web, &PredefinedMenuItem::separator(app)?, &privacy, &PredefinedMenuItem::separator(app)?, &quit])?;
            #[cfg(target_os = "macos")]
            let icon = Image::from_bytes(ICON_TEMPLATE)?;
            #[cfg(not(target_os = "macos"))]
            let icon = Image::from_bytes(ICON_IDLE)?;
            TrayIconBuilder::with_id("pulse")
                .icon(icon)
                .icon_as_template(cfg!(target_os = "macos"))
                .tooltip("Pulse")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                        let app = tray.app_handle();
                        let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
                        let (p, s) = (rect.position.to_physical::<f64>(scale), rect.size.to_physical::<f64>(scale));
                        app.state::<Mutex<Anchor>>().lock().unwrap().tray = Some((p.x, p.y, s.width, s.height));
                        toggle_panel(app);
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "panel" => show_panel(app),
                    "web" => { let _ = open_url(&format!("{}/me", companion::site(&app.state::<Companion>().base()))); }
                    "privacy" => show_privacy(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            let _ = app.global_shortcut().register(register);
            // Opened by the person (not at sign-in to the computer): say hello once.
            // --pinned keeps the panel open (screenshots on build runners and demos).
            if std::env::args().any(|a| a == "--pinned") { app.state::<Mutex<Anchor>>().lock().unwrap().pinned = true; }
            if !std::env::args().any(|a| a == "--autostart") { show_panel(app.handle()); }
            updater::hosted_acceptance(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            update_check,
            update_prepare,
            update_install,
            update_healthy,
            companion_session,
            companion_request,
            companion_pair_start,
            companion_pair_poll,
            companion_pair_cancel,
            companion_password,
            companion_sign_out,
            open_pulse,
            panel_fit,
            panel_show,
            panel_hide,
            panel_pin,
            set_tray,
            notify,
            autostart_get,
            autostart_set,
            app_info,
            open_privacy,
            agent_status,
            tracker_status,
            tracker_configure,
            tracker_login,
            tracker_verify_login,
            tracker_open_recovery,
            tracker_pause,
            tracker_sign_out,
            bridge_info,
            open_workspace
        ])
        .build(tauri::generate_context!())
        .expect("error while building Pulse")
        .run(|app, event| {
            // Closing the last window keeps Pulse in the tray.
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event { api.prevent_exit(); let _ = app; }
        });
}

#[cfg(test)]
mod tests {
    use pulse_desktop_core::AgentCore;
    use std::path::PathBuf;

    #[test]
    fn unconfigured_agent_starts_paused_gate_closed_and_disconnected() {
        let core = AgentCore::from_environment(PathBuf::from("unused-test-outbox.bin")).unwrap();
        let status = core.status();
        assert!(!status.paused);
        assert!(!status.connected);
        assert_eq!(status.queued_events, 0);
    }
}
