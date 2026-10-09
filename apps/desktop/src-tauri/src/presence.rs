//! Laptop office presence. With the person's opt-in, this computer reports which Wi-Fi it is on (name and access
//! point only) to the same presence endpoint phones use; Pulse's gateway adds whether the request came from the
//! office public IP. The server applies triangulation and dwell confirmation, HR policy and the person's own
//! auto-check-in choice. Nothing is sent while the opt-in is off; no location, history or other networks are read.
use crate::companion::Companion;
use pulse_desktop_core::wifi::{self, Wifi};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice { pub consent: bool, pub auto_consent: bool }

#[derive(Default)]
pub struct Presence { last: Mutex<Value>, sent: Mutex<Option<(Instant, Option<String>)>> }

fn choice_file(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_config_dir().ok().map(|d| d.join("presence.json")) }
fn choice(app: &AppHandle) -> Choice { choice_file(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default() }
fn save_choice(app: &AppHandle, c: Choice) {
    if let Some(p) = choice_file(app) { if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); } let _ = std::fs::write(p, serde_json::to_vec(&c).unwrap_or_default()); }
}

/// Reads the current Wi-Fi with the OS's own tool, without a console window.
pub fn current_wifi() -> Wifi {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("netsh").args(["wlan", "show", "interfaces"]).creation_flags(0x0800_0000).output();
        out.map(|o| wifi::parse_netsh(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
    }
    #[cfg(target_os = "macos")]
    {
        for interface in ["en0", "en1"] {
            if let Ok(o) = std::process::Command::new("/usr/sbin/ipconfig").args(["getsummary", interface]).output() {
                let w = wifi::parse_ipconfig_summary(&String::from_utf8_lossy(&o.stdout));
                if w.ssid.is_some() || w.needs_location { return w; }
            }
        }
        Wifi::default()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    { let _ = wifi::clean_bssid; Wifi::default() }
}

fn send(app: &AppHandle, c: Choice, w: &Wifi) -> Result<Value, String> {
    let body = if c.consent {
        json!({"consent": true, "autoConsent": c.auto_consent, "wifi": {"ssid": w.ssid, "bssid": w.bssid}})
    } else {
        json!({"consent": false, "autoConsent": false})
    };
    app.state::<Companion>().request("companion/presence", Some(body)).map_err(|e| e.message)
}

fn record(app: &AppHandle, c: Choice, w: &Wifi, result: Result<Value, String>) -> Value {
    let checked_in = result.as_ref().ok().and_then(|r| r["checkedIn"].as_bool()).unwrap_or(false);
    let status = json!({
        "consent": c.consent, "autoConsent": c.auto_consent,
        "wifi": {"ssid": w.ssid, "connected": w.ssid.is_some(), "accessPoint": w.bssid.is_some(), "needsLocation": w.needs_location},
        "server": result.as_ref().ok(), "error": result.as_ref().err(), "at": time_now(),
    });
    *app.state::<Presence>().last.lock().unwrap() = status.clone();
    if checked_in { let _ = app.emit("pulse:presence", status.clone()); }
    status
}
fn time_now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

/// What Settings → Devices shows for this computer: the app version, whether pings can arrive and whether office
/// presence is on. Sent every 30 minutes while signed in; never activity or location.
fn report_health(app: &AppHandle) {
    let session = app.state::<Companion>().session();
    let Some(device) = session["deviceId"].as_str() else { return };
    let push = crate::pings::permission().is_ok();
    let caps = json!({"push": if push { "healthy" } else { "denied" }, "work_sites": if choice(app).consent { "healthy" } else { "unknown" }});
    let _ = app.state::<Companion>().request(&format!("devices/{device}/health"), Some(json!({"health": if push { "healthy" } else { "permission_missing" }, "appVersion": env!("CARGO_PKG_VERSION"), "capabilities": caps})));
}

/// Every 90 seconds while opted in (sooner when the Wi-Fi changes); one opt-out message when turned off.
pub fn start(app: AppHandle) {
    let mut last_health: Option<(Instant, String)> = None;
    let _ = std::thread::Builder::new().name("pulse-presence".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        if !app.state::<Companion>().session()["signedIn"].as_bool().unwrap_or(false) { continue; }
        let device = app.state::<Companion>().session()["deviceId"].as_str().unwrap_or_default().to_string();
        if last_health.as_ref().map_or(true, |(at, d)| at.elapsed() >= Duration::from_secs(1800) || *d != device) {
            last_health = Some((Instant::now(), device));
            report_health(&app);
        }
        let c = choice(&app);
        if !c.consent { continue; }
        let w = current_wifi();
        let due = {
            let sent = app.state::<Presence>().sent.lock().unwrap();
            sent.as_ref().map_or(true, |(at, ssid)| at.elapsed() >= Duration::from_secs(90) || *ssid != w.ssid)
        };
        if !due { continue; }
        *app.state::<Presence>().sent.lock().unwrap() = Some((Instant::now(), w.ssid.clone()));
        let result = send(&app, c, &w);
        record(&app, c, &w, result);
    });
}

#[tauri::command]
pub fn presence_status(app: AppHandle) -> Value {
    let last = app.state::<Presence>().last.lock().unwrap().clone();
    if !last.is_null() { return last; }
    let c = choice(&app);
    let w = current_wifi();
    json!({"consent": c.consent, "autoConsent": c.auto_consent, "wifi": {"ssid": w.ssid, "connected": w.ssid.is_some(), "accessPoint": w.bssid.is_some(), "needsLocation": w.needs_location}, "server": null, "error": null})
}

/// Settings → Check-in & presence: save the person's choice and check right away.
#[tauri::command]
pub async fn presence_check(app: AppHandle, consent: Option<bool>, auto_consent: Option<bool>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut c = choice(&app);
        let was = c.consent;
        if let Some(v) = consent { c.consent = v; }
        if let Some(v) = auto_consent { c.auto_consent = v && c.consent; }
        if !c.consent { c.auto_consent = false; }
        save_choice(&app, c);
        let w = if c.consent { current_wifi() } else { Wifi::default() };
        if !c.consent && !was { return Ok(record(&app, c, &w, Ok(json!({"enabled": false})))); }
        *app.state::<Presence>().sent.lock().unwrap() = Some((Instant::now(), w.ssid.clone()));
        let result = send(&app, c, &w);
        Ok(record(&app, c, &w, result))
    })
    .await
    .map_err(|_| "Presence check interrupted".to_string())?
}
