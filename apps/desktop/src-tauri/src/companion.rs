//! Pulse Companion connection: the person's device credential (kept in the OS credential store), token-only calls
//! to the native gateway with single-flight refresh, browser pairing ("Sign in with your Pulse account") and the
//! username/password fallback. Secrets never reach the web view; it only sees the day and plain error messages.
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::Mutex, time::Duration};

pub const DEFAULT_BASE: &str = "https://pulse.estateautopilots.com/api/native/v0";
const SERVICE: &str = "com.pulse.work";
const ENTRY: &str = "companion-device";

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub base: String,
    pub access_token: String,
    pub refresh_token: String,
    pub device_id: String,
    #[serde(default)]
    pub person_name: String,
}

/// An error the panel can explain: offline, the outer Access gate, signed out, or Pulse's own message.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallError {
    pub status: u16,
    pub message: String,
    pub gate: bool,
    pub offline: bool,
    pub signed_out: bool,
}
impl CallError {
    fn offline() -> Self { Self { message: "You’re offline. Pulse will catch up when you’re back online.".into(), offline: true, ..Default::default() } }
    fn gate() -> Self { Self { message: "Pulse’s front door is not open for apps yet. Your admin needs to allow app access; until then use Pulse in the browser.".into(), gate: true, ..Default::default() } }
    fn status(status: u16, message: &str) -> Self { Self { status, message: message.into(), ..Default::default() } }
    fn signed_out() -> Self { Self { status: 401, message: "This computer was signed out of Pulse. Sign in again.".into(), signed_out: true, ..Default::default() } }
    pub fn text(&self) -> String { serde_json::to_string(self).unwrap_or_else(|_| "{\"message\":\"Pulse request failed\"}".into()) }
}

struct Pairing { base: String, pair_id: String, poll_secret: String }
struct TwoStep { base: String, challenge: String }

pub struct Companion {
    client: Client,
    tokens: Mutex<Option<Tokens>>,
    refresh: Mutex<()>,
    pairing: Mutex<Option<Pairing>>,
    two_step: Mutex<Option<TwoStep>>,
}

#[cfg(any(windows, target_os = "macos"))]
fn load_tokens() -> Option<Tokens> {
    let secret = keyring::Entry::new(SERVICE, ENTRY).ok()?.get_password().ok()?;
    serde_json::from_str(&secret).ok()
}
#[cfg(any(windows, target_os = "macos"))]
fn save_tokens(t: &Tokens) -> Result<(), CallError> {
    keyring::Entry::new(SERVICE, ENTRY)
        .and_then(|e| e.set_password(&serde_json::to_string(t).unwrap_or_default()))
        .map_err(|_| CallError::status(0, "This computer’s credential store refused to keep the Pulse sign-in"))
}
#[cfg(any(windows, target_os = "macos"))]
fn forget_tokens() { if let Ok(e) = keyring::Entry::new(SERVICE, ENTRY) { let _ = e.delete_credential(); } }
// Other systems keep the credential for this run only.
#[cfg(not(any(windows, target_os = "macos")))]
fn load_tokens() -> Option<Tokens> { None }
#[cfg(not(any(windows, target_os = "macos")))]
fn save_tokens(_t: &Tokens) -> Result<(), CallError> { Ok(()) }
#[cfg(not(any(windows, target_os = "macos")))]
fn forget_tokens() {}

pub fn platform() -> &'static str { if cfg!(target_os = "macos") { "macos" } else { "windows" } }

/// "Pulse on DESKTOP-4KQ" / "Pulse on Asha’s MacBook": what the person sees in Settings → Devices.
pub fn device_name() -> String {
    #[cfg(target_os = "macos")]
    let host = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output().ok().and_then(|o| String::from_utf8(o.stdout).ok());
    #[cfg(not(target_os = "macos"))]
    let host = std::env::var("COMPUTERNAME").ok().or_else(|| std::env::var("HOSTNAME").ok());
    let host: String = host.unwrap_or_default().trim().chars().filter(|c| !c.is_control()).take(60).collect();
    if host.is_empty() { format!("Pulse for {}", if cfg!(target_os = "macos") { "Mac" } else { "Windows" }) } else { format!("Pulse on {host}") }
}

/// Only the secure Pulse address (or a local test server) is accepted.
pub fn check_base(base: &str) -> Result<String, CallError> {
    let url = url::Url::parse(base).map_err(|_| CallError::status(0, "Use the Pulse address, e.g. https://pulse.estateautopilots.com/api/native/v0"))?;
    let local = url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"));
    if (url.scheme() != "https" && !local) || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err(CallError::status(0, "Use the secure Pulse address (https://…)"));
    }
    Ok(base.trim_end_matches('/').to_string())
}

/// The Pulse site that serves this gateway, for "Open Pulse" and pairing approval.
pub fn site(base: &str) -> String {
    url::Url::parse(base).map(|u| u.origin().ascii_serialization()).unwrap_or_else(|_| "https://pulse.estateautopilots.com".into())
}

impl Companion {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("PulseCompanion/{} ({})", env!("CARGO_PKG_VERSION"), platform()))
            .build()
            .expect("HTTP client");
        Self { client, tokens: Mutex::new(load_tokens()), refresh: Mutex::new(()), pairing: Mutex::new(None), two_step: Mutex::new(None) }
    }

    pub fn session(&self) -> Value {
        match self.tokens.lock().unwrap().as_ref() {
            Some(t) => json!({"signedIn": true, "base": t.base, "site": site(&t.base), "personName": t.person_name, "deviceId": t.device_id}),
            None => json!({"signedIn": false, "base": DEFAULT_BASE, "site": site(DEFAULT_BASE)}),
        }
    }
    pub fn base(&self) -> String { self.tokens.lock().unwrap().as_ref().map(|t| t.base.clone()).unwrap_or_else(|| DEFAULT_BASE.into()) }

    fn send(&self, base: &str, path: &str, body: Option<&Value>, bearer: Option<&str>, session: Option<&str>) -> Result<(u16, Value), CallError> {
        let url = format!("{base}/{path}");
        let mut req = if body.is_some() { self.client.post(&url) } else { self.client.get(&url) };
        req = req.header("x-pulse-client", format!("desktop-{}/{}", platform(), env!("CARGO_PKG_VERSION")));
        if let Some(t) = bearer { req = req.bearer_auth(t); } else if let Some(s) = session { req = req.header("x-pulse-session", s); }
        if let Some(b) = body { req = req.json(b); }
        let resp = req.send().map_err(|_| CallError::offline())?;
        let status = resp.status().as_u16();
        if (300..400).contains(&status) { return Err(CallError::gate()); }
        let json_reply = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("json"));
        if !json_reply { return Err(if status >= 500 { CallError::status(status, "Pulse is not answering right now") } else { CallError::gate() }); }
        let value: Value = resp.json().map_err(|_| CallError::status(status, "Pulse sent an unreadable answer"))?;
        Ok((status, value))
    }
    fn fail(status: u16, data: &Value) -> CallError {
        CallError::status(status, data["error"].as_str().unwrap_or("Pulse refused this request"))
    }

    /// A call with this computer's device credential; one refresh on 401, shared by concurrent callers.
    pub fn request(&self, path: &str, body: Option<Value>) -> Result<Value, CallError> {
        let tokens = self.tokens.lock().unwrap().clone().ok_or_else(CallError::signed_out)?;
        let (mut status, mut data) = self.send(&tokens.base, path, body.as_ref(), Some(&tokens.access_token), None)?;
        if status == 401 {
            let fresh = self.refreshed(&tokens)?;
            (status, data) = self.send(&fresh.base, path, body.as_ref(), Some(&fresh.access_token), None)?;
            if status == 401 { self.clear(); return Err(CallError::signed_out()); }
        }
        if !(200..300).contains(&status) { return Err(Self::fail(status, &data)); }
        Ok(data)
    }
    fn refreshed(&self, used: &Tokens) -> Result<Tokens, CallError> {
        let _one = self.refresh.lock().unwrap();
        let current = self.tokens.lock().unwrap().clone().ok_or_else(CallError::signed_out)?;
        if current.access_token != used.access_token { return Ok(current); }
        let (status, data) = self.send(&current.base, "native/refresh", Some(&json!({"refreshToken": current.refresh_token})), None, None)?;
        let (Some(access), Some(refresh)) = (data["accessToken"].as_str(), data["refreshToken"].as_str()) else { self.clear(); return Err(CallError::signed_out()); };
        if status != 200 { self.clear(); return Err(CallError::signed_out()); }
        let next = Tokens { access_token: access.into(), refresh_token: refresh.into(), ..current };
        save_tokens(&next)?;
        *self.tokens.lock().unwrap() = Some(next.clone());
        Ok(next)
    }
    fn store(&self, t: Tokens) -> Result<Value, CallError> {
        save_tokens(&t)?;
        *self.tokens.lock().unwrap() = Some(t);
        Ok(self.session())
    }
    fn clear(&self) {
        forget_tokens();
        *self.tokens.lock().unwrap() = None;
    }

    /// Browser sign-in, step 1: a short code the person approves on the Pulse site.
    pub fn pair_start(&self, base: &str) -> Result<Value, CallError> {
        let base = check_base(base)?;
        let (status, data) = self.send(&base, "native/pair/start", Some(&json!({"platform": platform(), "name": device_name()})), None, None)?;
        if status != 200 { return Err(Self::fail(status, &data)); }
        let (Some(pair_id), Some(poll_secret), Some(code)) = (data["pairId"].as_str(), data["pollSecret"].as_str(), data["code"].as_str()) else { return Err(CallError::status(status, "Pulse could not start the sign-in")); };
        *self.pairing.lock().unwrap() = Some(Pairing { base: base.clone(), pair_id: pair_id.into(), poll_secret: poll_secret.into() });
        Ok(json!({"code": code, "verifyUrl": format!("{}/connect?code={code}", site(&base)), "expiresIn": data["expiresIn"], "interval": data["interval"]}))
    }
    /// Step 2: ask until approved; the credential is stored here and never shown to the web view.
    pub fn pair_poll(&self) -> Result<Value, CallError> {
        let (base, pair_id, secret) = match self.pairing.lock().unwrap().as_ref() { Some(p) => (p.base.clone(), p.pair_id.clone(), p.poll_secret.clone()), None => return Ok(json!({"status": "idle"})) };
        let (status, data) = self.send(&base, "native/pair/poll", Some(&json!({"pairId": pair_id, "pollSecret": secret})), None, None)?;
        if status != 200 { *self.pairing.lock().unwrap() = None; return Err(Self::fail(status, &data)); }
        if data["status"] != "approved" {
            if data["status"] != "pending" { *self.pairing.lock().unwrap() = None; }
            return Ok(json!({"status": data["status"]}));
        }
        *self.pairing.lock().unwrap() = None;
        let tokens = Tokens { base, access_token: data["accessToken"].as_str().unwrap_or_default().into(), refresh_token: data["refreshToken"].as_str().unwrap_or_default().into(),
            device_id: data["deviceId"].as_str().unwrap_or_default().into(), person_name: data["person"]["name"].as_str().unwrap_or_default().into() };
        if tokens.access_token.len() != 43 || tokens.refresh_token.len() != 43 { return Err(CallError::status(status, "Pulse sent an incomplete sign-in")); }
        let session = self.store(tokens)?;
        Ok(json!({"status": "approved", "session": session}))
    }
    pub fn pair_cancel(&self) { *self.pairing.lock().unwrap() = None; }

    /// Fallback for people with a Pulse username and password.
    pub fn password(&self, base: &str, username: &str, password: &str) -> Result<Value, CallError> {
        let base = check_base(base)?;
        let (status, data) = self.send(&base, "auth/sign-in", Some(&json!({"username": username, "password": password})), None, None)?;
        if status != 200 { return Err(Self::fail(status, &data)); }
        if data["twoStep"] == true {
            *self.two_step.lock().unwrap() = Some(TwoStep { base, challenge: data["challenge"].as_str().unwrap_or_default().into() });
            return Ok(json!({"twoStep": true}));
        }
        self.enrol(&base, &data)
    }
    pub fn two_step(&self, code: &str) -> Result<Value, CallError> {
        let Some(TwoStep { base, challenge }) = self.two_step.lock().unwrap().take() else { return Err(CallError::status(0, "Start the sign-in again")); };
        let (status, data) = self.send(&base, "auth/two-step", Some(&json!({"challenge": challenge, "code": code})), None, None)?;
        if status != 200 { return Err(Self::fail(status, &data)); }
        self.enrol(&base, &data)
    }
    fn enrol(&self, base: &str, signed_in: &Value) -> Result<Value, CallError> {
        if signed_in["mustChange"] == true { return Err(CallError::status(403, "Choose your own password on the Pulse site first, then sign in here.")); }
        let session = signed_in["token"].as_str().ok_or_else(|| CallError::status(0, "Pulse did not start a session"))?.to_string();
        let (status, me) = self.send(base, "me", None, None, Some(&session))?;
        if status != 200 { return Err(Self::fail(status, &me)); }
        let (status, device) = self.send(base, "devices", Some(&json!({"name": device_name(), "platform": platform()})), None, Some(&session))?;
        if status != 200 { return Err(Self::fail(status, &device)); }
        let device_id = device["id"].as_str().unwrap_or_default().to_string();
        let (status, issued) = self.send(base, "native/exchange", Some(&json!({"deviceId": device_id})), None, Some(&session))?;
        if status != 200 { return Err(Self::fail(status, &issued)); }
        let _ = self.send(base, "auth/sign-out", Some(&json!({})), None, Some(&session));
        self.store(Tokens { base: base.into(), access_token: issued["accessToken"].as_str().unwrap_or_default().into(), refresh_token: issued["refreshToken"].as_str().unwrap_or_default().into(), device_id, person_name: me["name"].as_str().unwrap_or_default().into() })
    }

    /// Sign out: revoke this device on the server when reachable, and always forget it here.
    pub fn sign_out(&self) -> Value {
        if let Some(t) = self.tokens.lock().unwrap().clone() {
            let _ = self.send(&t.base, &format!("devices/{}/revoke", t.device_id), Some(&json!({})), Some(&t.access_token), None);
        }
        self.clear();
        self.session()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_secure_or_local_addresses() {
        assert_eq!(check_base("https://pulse.example/api/native/v0/").ok().as_deref(), Some("https://pulse.example/api/native/v0"));
        assert!(check_base("http://127.0.0.1:3200/api/native/v0").is_ok());
        assert!(check_base("http://pulse.example/api/native/v0").is_err());
        assert!(check_base("https://a:b@pulse.example/api").is_err());
        assert!(check_base("https://pulse.example/api?x=1").is_err());
        assert_eq!(site("https://pulse.example/api/native/v0"), "https://pulse.example");
    }

    #[test]
    fn errors_serialise_for_the_panel() {
        let e = CallError::gate().text();
        assert!(e.contains("\"gate\":true") && e.contains("front door"));
        assert!(CallError::offline().text().contains("\"offline\":true"));
        assert!(CallError::signed_out().text().contains("\"signedOut\":true"));
    }

    #[test]
    fn device_names_are_readable() {
        let n = device_name();
        assert!(n.starts_with("Pulse ") && n.len() <= 80);
    }
}
