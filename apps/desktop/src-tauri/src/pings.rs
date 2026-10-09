//! A running tray app polls independently of its WebView and panel visibility.
use crate::{companion::Companion, show_panel};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashSet,sync::Mutex,time::Duration};
use tauri::{AppHandle,Emitter,Manager,State};

#[derive(Default)]
pub struct Pings { pub snapshot:Mutex<Value>,pub error:Mutex<Option<String>>,pub tray:Mutex<(String,String,String)> }
#[derive(Default,Serialize,Deserialize)]
struct Receipt { device:String,#[serde(default)] cursor:Option<String>,#[serde(default)] page:Option<String>,#[serde(default)] seen:Vec<String> }
fn same_device(app:&AppHandle,device:&str)->bool{app.state::<Companion>().session()["deviceId"].as_str()==Some(device)}
fn current_snapshot(app:&AppHandle)->Value{
 let snapshot=app.state::<Pings>().snapshot.lock().unwrap().clone();
 if snapshot["nativeDeviceId"].as_str().is_some_and(|device|same_device(app,device)){snapshot}else{Value::Null}
}
pub fn unread(app:&AppHandle)->u64 {current_snapshot(app)["counts"]["total"].as_u64().unwrap_or(0)}
fn status(app:&AppHandle,message:Option<String>){*app.state::<Pings>().error.lock().unwrap()=message;}

#[tauri::command]
pub fn companion_ping_state(app:AppHandle,state:State<'_,Pings>)->Value{
 json!({"panelVisible":app.get_webview_window(crate::PANEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"snapshot":current_snapshot(&app),"error":state.error.lock().unwrap().clone()})
}
#[tauri::command]
pub async fn companion_ping_enable(app:AppHandle)->Result<(),String>{
 #[cfg(target_os="macos")]
 {mac_usernotifications::request_auth().await.map_err(|_|"macOS refused notification permission".to_string())?;}
 permission()?;status(&app,None);Ok(())
}
fn permission()->Result<(),String>{
 #[cfg(target_os="macos")]
 {
  let settings=mac_usernotifications::blocking::get_notification_settings().map_err(|_|"Could not check macOS notification settings")?;
  if !matches!(settings.authorization_status,mac_usernotifications::AuthorizationStatus::Authorized|mac_usernotifications::AuthorizationStatus::Provisional){
   return Err("Notifications are blocked or not enabled. Choose Enable laptop pings, then allow Pulse in System Settings → Notifications.".into());
  }
 }
 #[cfg(windows)]
 {
  use windows::{core::HSTRING,UI::Notifications::{ToastNotificationManager,NotificationSetting}};
  let notifier=ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from("com.pulse.work")).map_err(|_|"Pulse notifications need an installed app. Reinstall from Settings → Devices.")?;
  if notifier.Setting().map_err(|_|"Could not check Windows notification settings")?!=NotificationSetting::Enabled{
   return Err("Windows notifications are blocked. Allow Pulse in Settings → System → Notifications.".into());
  }
 }
 Ok(())
}
fn clicked(app:AppHandle,device:String,row:Value){
 tauri::async_runtime::spawn_blocking(move||{
  if app.state::<Companion>().session()["deviceId"].as_str()!=Some(device.as_str()){
   show_panel(&app);let _=app.emit("pulse:open-conversation",json!({"error":"This ping belongs to another account. Switch back to that account to open it."}));return;
  }
  let channel=row["channelId"].as_str();
  let path=channel.map(|id|format!("chats/{id}/messages")).unwrap_or_else(||format!("companion/inbox?id={}",row["id"].as_str().unwrap_or_default()));
  let result=app.state::<Companion>().request(&path,None);
  show_panel(&app);
  match result{
   Ok(data)=>{
    if channel.is_none()&&!data["rows"].as_array().is_some_and(|rows|rows.iter().any(|n|n["id"]==row["id"])){return;}
    let _=app.emit("pulse:open-conversation",json!({"channelId":channel,"notificationId":row["id"],"href":row["href"]}));
   }
   Err(_)=>{let _=app.emit("pulse:open-conversation",json!({"error":"You are not a member of this conversation with this account, or your sign-in has expired."}));}
  }
 });
}
fn send(app:&AppHandle,device:&str,row:&Value)->Result<(),String>{
 if !same_device(app,device){return Ok(());}
 permission()?;
 #[cfg(windows)]
 {
  use tauri_winrt_notification::{Toast,Sound};
  let handle=app.clone();let device=device.to_owned();let row=row.clone();
  Toast::new("com.pulse.work").title("Pulse").text1("A new work update is ready").sound(Some(Sound::Default))
   .on_activated(move |_|{clicked(handle.clone(),device.clone(),row.clone());Ok(())})
   .show().map_err(|_|"Windows could not show a Pulse notification".to_string())?;
 }
 #[cfg(target_os="macos")]
 {
  let handle=app.clone();let device=device.to_owned();let row=row.clone();
  // Awaiting response uses an async task, not a thread per ping. AppKit owns the main run loop.
  tauri::async_runtime::spawn(async move{
   if !same_device(&handle,&device){return;}
   let result=mac_usernotifications::Notification::new().title("Pulse").message("A new work update is ready").sound(mac_usernotifications::sound::DEFAULT)
     .timeout(Duration::from_secs(86400)).send().await;
   match result{
    Ok(notification)=>{if let Ok(response)=notification.response().await{if response.is_default_action(){clicked(handle,device,row);}}}
    Err(_)=>status(&handle,Some("macOS could not deliver this notification. Check Pulse in System Settings → Notifications.".into())),
   }
  });
 }
 #[cfg(not(any(windows,target_os="macos")))]
 {let _=(app,device,row);}
 Ok(())
}
pub fn start(app:AppHandle){
 let path=app.path().app_local_data_dir().ok().map(|p|p.join("notification-receipt.json"));
 let mut receipt=path.as_ref().and_then(|p|std::fs::read(p).ok()).and_then(|b|serde_json::from_slice::<Receipt>(&b).ok()).unwrap_or_default();
 let _=std::thread::Builder::new().name("pulse-chat-pings".into()).spawn(move||'poll:loop{
  let device=app.state::<Companion>().session()["deviceId"].as_str().map(str::to_owned);
  if let Some(device)=device{
   if receipt.device!=device{receipt=Receipt{device:device.clone(),..Default::default()};}
   let mut params=url::form_urlencoded::Serializer::new(String::new());
   if let Some(cursor)=&receipt.cursor{params.append_pair("since",cursor);}
   if let Some(page)=&receipt.page{params.append_pair("page",page);}
   let query=format!("?{}",params.finish());
   match app.state::<Companion>().request(&format!("companion/updates{query}"),None){
    Ok(mut snapshot)=>{
     if app.state::<Companion>().session()["deviceId"].as_str()==Some(device.as_str()){
      status(&app,permission().err());
      let mut seen:HashSet<String>=receipt.seen.iter().cloned().collect();
      if let Some(rows)=snapshot["rows"].as_array(){for row in rows{
       if !same_device(&app,&device){continue 'poll;}
       if let Some(id)=row["id"].as_str(){if seen.insert(id.into()){
        receipt.seen.push(id.into());
        if row["pingAllowed"].as_bool()==Some(true){if let Err(error)=send(&app,&device,row){status(&app,Some(error));}}
       }}
      }}
      if let Some(rows)=snapshot["rows"].as_array(){let ids:Vec<_>=rows.iter().filter_map(|r|r["id"].as_str()).collect();if !ids.is_empty(){let _=app.state::<Companion>().request("companion/ack",Some(json!({"ids":ids})));}}
      if !same_device(&app,&device){continue 'poll;}
      receipt.page=snapshot["page"].as_str().map(str::to_owned);
      receipt.cursor=snapshot["cursor"].as_str().map(str::to_owned);
      if receipt.seen.len()>2000{receipt.seen.drain(..receipt.seen.len()-2000);}
      snapshot["nativeDeviceId"]=json!(device);
      *app.state::<Pings>().snapshot.lock().unwrap()=snapshot;
      if let Some(path)=&path{if let Ok(bytes)=serde_json::to_vec(&receipt){let temporary=path.with_extension("tmp");if std::fs::write(&temporary,bytes).is_ok(){let _=std::fs::rename(temporary,path);}}}
      crate::set_tray(app.clone(),String::new(),"neutral".into(),"Pulse".into());
     }
    }
    Err(error)=>{if same_device(&app,&device){status(&app,Some(error.message));}},
   }
  }else{
   *app.state::<Pings>().snapshot.lock().unwrap()=Value::Null;
   crate::set_tray(app.clone(),String::new(),"neutral".into(),"Pulse".into());
   receipt=Receipt::default();if let Some(path)=&path{let _=std::fs::write(path,b"{}");}
  }
  std::thread::sleep(Duration::from_secs(3));
 });
}

// Small white numerals on a red corner badge, visible in Windows' tray overflow too.
#[cfg(not(target_os="macos"))]
pub fn badge_icon(icon:tauri::image::Image<'_>,count:u64)->tauri::image::Image<'static>{
 let (w,h)=(icon.width(),icon.height());let mut rgba=icon.rgba().to_vec();
 let digit:[u16;10]=[0b111101101101111,0b010110010010111,0b111001111100111,0b111001111001111,0b101101111001001,0b111100111001111,0b111100111101111,0b111001001001001,0b111101111101111,0b111101111001111];
 let scale=(w/24).max(1);let text=count.min(99).to_string();let width=(text.len() as u32*4+2)*scale;let start=w.saturating_sub(width);
 for y in 0..(7*scale).min(h){for x in start..w{let i=((y*w+x)*4)as usize;rgba[i..i+4].copy_from_slice(&[211,48,64,255]);}}
 for (n,c) in text.chars().enumerate(){let bits=digit[c.to_digit(10).unwrap()as usize];for y in 0..5{for x in 0..3{
  if bits&(1<<(14-y*3-x))==0{continue;}
  for dy in 0..scale{for dx in 0..scale{let px=start+(n as u32*4+1+x)*scale+dx;let py=(y+1)*scale+dy;if px<w&&py<h{let i=((py*w+px)*4)as usize;rgba[i..i+4].copy_from_slice(&[255,255,255,255]);}}}
 }}}
 tauri::image::Image::new_owned(rgba,w,h)
}
