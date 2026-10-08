import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import Constants from 'expo-constants';
// Region callbacks and notification actions may run while locked, after the first unlock since boot.
async function secureSet(key:string,value:string){return SecureStore.setItemAsync(key,value,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK});}
export type Identity={person:string;name:string;role:string;mustChange:boolean};
export type Event={id:string;deviceId:string;personId:string;purpose:string;kind:string;at:string;projectId:string|null;data:Record<string,unknown>;consentReceipt:string;sourceSession:string;sequence:number;intervalStart:string};
let secureWrites:Promise<void>=Promise.resolve();
async function secureAt(expected:number,work:()=>Promise<unknown>){const run=secureWrites.catch(()=>{}).then(async()=>{requireEpoch(expected);await work();requireEpoch(expected);});secureWrites=run;return run;}
let captureEpoch=0;
let attendanceWrites:Promise<void>=Promise.resolve();
let db:SQLite.SQLiteDatabase;let token='';let refreshToken='';let bootstrap='';let base=Constants.expoConfig?.extra?.apiUrl as string;let identity:Identity|null=null;let deviceId='';let epoch=0;let receipts:Record<string,string>={};let shiftEnd=0;let sourceSession='';let sequence=0;let flushing:Promise<{sent:number;pending:number}>|null=null;
export const uuid=()=>Crypto.randomUUID();
const requireEpoch=(expected:number)=>{if(epoch!==expected)throw Error('Your sign-in changed. Try again in the current workspace.');};
const cacheKey=(path:string)=>JSON.stringify([base,identity?.person??'',path]);
export const currentPerson=()=>identity?.person??null;
export const sessionGeneration=()=>epoch;
export const currentIdentity=()=>identity;
export async function init(){
 const expected=epoch;
 await secureAt(expected,async()=>{for(const name of ['pulse.api','pulse.session','pulse.refresh','pulse.device','pulse.person','pulse.identity','pulse.cache-key','pulse.companion-prefs','pulse.presence-recent']){const value=await SecureStore.getItemAsync(name);requireEpoch(expected);if(value!==null)await secureSet(name,value);}});
 token=await SecureStore.getItemAsync('pulse.session')??'';refreshToken=await SecureStore.getItemAsync('pulse.refresh')??'';base=await SecureStore.getItemAsync('pulse.api')??base;deviceId=await SecureStore.getItemAsync('pulse.device')??'';
 const saved=await SecureStore.getItemAsync('pulse.identity');identity=saved?JSON.parse(saved):null;sourceSession=uuid();
 let key=await SecureStore.getItemAsync('pulse.cache-key');if(!key){key=uuid().replaceAll('-','')+uuid().replaceAll('-','');await secureSet('pulse.cache-key',key);}
 db=await SQLite.openDatabaseAsync('pulse.db');await db.execAsync(`PRAGMA key="x'${key}'"; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cache(path TEXT PRIMARY KEY,data TEXT,at TEXT); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS attendance_queue(id TEXT PRIMARY KEY,data TEXT);`);
 const cipher=await db.getFirstAsync<{cipher_version:string}>('PRAGMA cipher_version');if(!cipher?.cipher_version)throw Error('Encrypted storage unavailable: use an approved SQLCipher native build.');
 // Capture resumes only after an online permission/work-window handshake. Cached workflows remain readable offline.
 return !!token;
}
async function send(path:string,body?:unknown){let r:Response;try{r=await fetch(`${base}/${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:bootstrap?{'x-pulse-session':bootstrap}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(Error('Offline · saved work remains pending'),{offline:true});}let data:any;try{data=await r.json();}catch{throw Object.assign(Error('Pulse’s front door is not open for apps yet. Your admin needs to allow app access; until then use Pulse in the browser.'),{gate:true});}return {r,data};}
let rotating:Promise<void>|null=null;
async function rotate(){if(!refreshToken)throw Error('Sign in again');const expected=epoch;const old=refreshToken;const {r,data}=await send('native/refresh',{refreshToken:old});requireEpoch(expected);if(!r.ok)throw Error('Device access expired or revoked');token=data.accessToken;refreshToken=data.refreshToken;await secureAt(expected,async()=>{await secureSet('pulse.session',token);await secureSet('pulse.refresh',refreshToken);});}
export async function request<T=any>(path:string,body?:unknown):Promise<T>{const expected=epoch;let result=await send(path,body);requireEpoch(expected);if(result.r.status===401&&token&&refreshToken){if(!rotating)rotating=rotate().finally(()=>{rotating=null;});await rotating;requireEpoch(expected);result=await send(path,body);}requireEpoch(expected);if(!result.r.ok)throw Object.assign(Error(result.data.error??`Pulse returned ${result.r.status}`),{status:result.r.status});return result.data;}
export async function cached(path:string){const expected=epoch;const row=await db.getFirstAsync<{data:string;at:string}>('SELECT * FROM cache WHERE path=?',cacheKey(path));if(epoch!==expected)return null;return row?{data:JSON.parse(row.data),at:row.at}:null;}
export async function load(path:string){const expected=epoch;const key=cacheKey(path);try{const data=await request(path);requireEpoch(expected);const at=new Date().toISOString();await db.runAsync('INSERT OR REPLACE INTO cache VALUES(?,?,?)',key,JSON.stringify(data),at);requireEpoch(expected);return {data,at,offline:false};}catch(error){requireEpoch(expected);if(!(error as {offline?:boolean}).offline)throw error;const row=await db.getFirstAsync<{data:string;at:string}>('SELECT * FROM cache WHERE path=?',key);requireEpoch(expected);if(row&&Date.parse(row.at)>Date.now()-7*86400000)return {data:JSON.parse(row.data),at:row.at,offline:true};throw error;}}
export async function signIn(api:string,username:string,password:string){const url=new URL(api);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use an approved secure HTTPS API address');const nextBase=api.replace(/\/$/,'');if(token||bootstrap||base!==nextBase)await signOut();base=nextBase;await secureAt(epoch,()=>secureSet('pulse.api',base));const d=await request('auth/sign-in',{username,password});if(d.twoStep)return d;epoch++;bootstrap=d.token;identity=null;return d;}
export async function enroll(platform:string){
 const expected=epoch;const me=await request<Identity>('me');requireEpoch(expected);const prior=await SecureStore.getItemAsync('pulse.person');requireEpoch(expected);
 if(prior&&prior!==me.person){await db.execAsync('DELETE FROM cache;DELETE FROM outbox;DELETE FROM attendance_queue;PRAGMA wal_checkpoint(TRUNCATE);VACUUM;');requireEpoch(expected);deviceId='';await SecureStore.deleteItemAsync('pulse.device');}
 await secureAt(expected,()=>secureSet('pulse.person',me.person));requireEpoch(expected);identity=me;
 if(me.mustChange)return me;
 if(deviceId){const d=await request('devices');requireEpoch(expected);if(!d.devices.some((x:any)=>x.id===deviceId&&!x.revokedAt)){deviceId='';await db.runAsync('DELETE FROM outbox');}}
 if(!deviceId){const d=await request('devices',{name:`Pulse ${platform}`,platform});requireEpoch(expected);deviceId=d.id;await secureAt(expected,()=>secureSet('pulse.device',deviceId));}
 if(bootstrap){const d=await request('native/exchange',{deviceId});requireEpoch(expected);token=d.accessToken;refreshToken=d.refreshToken;bootstrap='';await secureAt(expected,async()=>{await secureSet('pulse.session',token);await secureSet('pulse.refresh',refreshToken);});}
 await secureAt(expected,()=>secureSet('pulse.identity',JSON.stringify(me)));return me;
}
export const device=()=>deviceId;
export async function consent(purposes:string[]){
 // Withdrawal stops at source before network permission can fail.
 captureEpoch++;receipts={};shiftEnd=0;await db.execAsync('DELETE FROM outbox;');
 const policy=await request('devices/policy');const notice=policy.notices.find((n:any)=>n.body.dataItems.includes('explicit_shoot_wrap'));
 await request(`devices/${deviceId}/consent`,{purposes, ...(purposes.length?{notice:notice?.id}:{})});
}
export async function resume(endsAt:string){const d=await request(`devices/${deviceId}/resume`,{endsAt});receipts=Object.fromEntries(d.receipts.map((r:any)=>[r.purpose,r.id]));shiftEnd=Date.parse(d.endsAt);return d;}
export async function pause(){captureEpoch++;receipts={};shiftEnd=0;await db.execAsync('DELETE FROM outbox;');await request(`devices/${deviceId}/pause`,{paused:true});}
export async function queueShoot(projectId:string,data:Record<string,unknown>,expectedPerson:string){const generation=captureEpoch;const expected=epoch;if(!identity||identity.person!==expectedPerson)throw Error('Your shoot declaration was cancelled because sign-in changed.');if(!receipts.shoot_presence||Date.now()>=shiftEnd)throw Error('Confirm your purpose receipt and shift end first');const at=new Date().toISOString();const e:Event={id:uuid(),deviceId,personId:identity.person,purpose:'shoot_presence',kind:'shoot',at,intervalStart:at,projectId,data,consentReceipt:receipts.shoot_presence,sourceSession,sequence:sequence++};const rows=await db.getAllAsync<{id:string;data:string}>('SELECT * FROM outbox');requireEpoch(expected);if(generation!==captureEpoch)throw Error('Capture was paused');if(rows.length>=1000||rows.reduce((n,r)=>n+r.data.length,0)>1048576)throw Error('Queue full · pause and sync before adding evidence');await db.runAsync('INSERT INTO outbox VALUES(?,?)',e.id,JSON.stringify(e));if(generation!==captureEpoch||expected!==epoch){await db.runAsync('DELETE FROM outbox WHERE id=?',e.id);throw Error('Capture was paused or sign-in changed');}return flush();}
export async function flush(){if(flushing)return flushing;flushing=flushOnce().finally(()=>{flushing=null;});return flushing;}
async function flushOnce(){const rows=await db.getAllAsync<{id:string;data:string}>('SELECT * FROM outbox ORDER BY rowid');if(!identity||!deviceId)return {sent:0,pending:rows.length};const expected=epoch;let sent=0,discarded=0;for(const row of rows){try{requireEpoch(expected);const event=JSON.parse(row.data) as Event;if(event.personId!==identity.person||event.deviceId!==deviceId||Date.parse(event.at)<Date.now()-7*86400000){await db.runAsync('DELETE FROM outbox WHERE id=?',row.id);discarded++;continue;}const ack=await request('native/batches',{batchId:event.id,events:[event]});requireEpoch(expected);if(!ack.acknowledged?.includes(event.id))break;await db.runAsync('DELETE FROM outbox WHERE id=?',row.id);sent++;}catch(error){if((error as {status?:number}).status===403){captureEpoch++;receipts={};shiftEnd=0;await db.execAsync('DELETE FROM outbox;');return {sent,pending:0};}break;}}return {sent,pending:rows.length-sent-discarded};}
export async function signOut(){const old={token,bootstrap,base,deviceId};epoch++;captureEpoch++;token='';refreshToken='';bootstrap='';identity=null;deviceId='';receipts={};shiftEnd=0;await secureAt(epoch,async()=>{for(const k of ['pulse.session','pulse.refresh','pulse.device','pulse.person','pulse.identity','pulse.companion-prefs','pulse.presence-recent'])await SecureStore.deleteItemAsync(k);});await attendanceWrites.catch(()=>{});if(db)await db.execAsync('DELETE FROM cache;DELETE FROM outbox;DELETE FROM attendance_queue;PRAGMA wal_checkpoint(TRUNCATE);VACUUM;');try{if(old.token&&old.deviceId)await fetch(`${old.base}/devices/${old.deviceId}/revoke`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+old.token},body:'{}',signal:AbortSignal.timeout(15000)});if(old.bootstrap)await fetch(`${old.base}/auth/sign-out`,{method:'POST',headers:{'content-type':'application/json','x-pulse-session':old.bootstrap},body:'{}',signal:AbortSignal.timeout(15000)});}catch{}}
export function within(latitude:number,longitude:number,s:{latitude:number;longitude:number;radiusMeters:number;precision?:string;startsAt?:string;endsAt?:string},accuracy:number|null){if(s.precision!=='verified_site'||!s.startsAt||!s.endsAt||Date.now()<Date.parse(s.startsAt)||Date.now()>Date.parse(s.endsAt)||s.radiusMeters>300||accuracy===null||!Number.isFinite(accuracy)||accuracy<0||accuracy>50)return false;const rad=(n:number)=>n*Math.PI/180;const a=Math.sin(rad(latitude-s.latitude)/2)**2+Math.cos(rad(latitude))*Math.cos(rad(s.latitude))*Math.sin(rad(longitude-s.longitude)/2)**2;return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))+accuracy<=s.radiusMeters;}
export async function subscribeChats(onChange:()=>void,signal:AbortSignal){const {fetch:streamFetch}=await import('expo/fetch');while(!signal.aborted){try{const r=await streamFetch(`${base}/chats/events`,{headers:{authorization:'Bearer '+token},signal});if(!r.ok||!r.body)throw Error('Stream unavailable');const reader=r.body.getReader();let buffer='';const decoder=new TextDecoder();while(!signal.aborted){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,index);buffer=buffer.slice(index+2);if(event.includes('data:'))onChange();}}}catch{if(signal.aborted)return;}await new Promise<void>(resolve=>{const timer=setTimeout(resolve,3000);signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});}}

export async function finishSignIn(challenge:string,code:string){const d=await request('auth/two-step',{challenge,code});epoch++;bootstrap=d.token;identity=null;return d;}

// Browser sign-in ("Sign in with your Pulse account"): a short code the person approves on the Pulse site; the poll
// secret stays in memory and the device credential goes straight to SecureStore.
let pairing:{pairId:string;pollSecret:string;code:string;url:string}|null=null;
export async function pairStart(api:string,platform:string,name:string){
 const url=new URL(api);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use an approved secure HTTPS API address');
 const nextBase=api.replace(/\/$/,'');if(token||bootstrap||base!==nextBase)await signOut();base=nextBase;await secureAt(epoch,()=>secureSet('pulse.api',base));
 const d=await request('native/pair/start',{platform,name});pairing={pairId:d.pairId,pollSecret:d.pollSecret,code:d.code,url:`${new URL(base).origin}/connect?code=${d.code}`};
 return {code:pairing.code,url:pairing.url,expiresIn:d.expiresIn as number,interval:d.interval as number};
}
export async function pairPoll():Promise<'idle'|'pending'|'approved'|'denied'|'expired'>{
 if(!pairing)return 'idle';const expected=epoch;const d=await request('native/pair/poll',{pairId:pairing.pairId,pollSecret:pairing.pollSecret});requireEpoch(expected);
 if(d.status!=='approved'){if(d.status!=='pending')pairing=null;return d.status;}
 pairing=null;epoch++;token=d.accessToken;refreshToken=d.refreshToken;deviceId=d.deviceId;bootstrap='';identity=null;
 await secureAt(epoch,async()=>{await secureSet('pulse.session',token);await secureSet('pulse.refresh',refreshToken);await secureSet('pulse.device',deviceId);});
 return 'approved';
}
export const pairCancel=()=>{pairing=null;};
export const apiBase=()=>base;
export const signedIn=()=>!!token;
/** Attendance taps saved while offline, encrypted with the rest of the cache; cleared on sign-out. */
export async function queueRead<T>():Promise<T[]>{const expected=epoch;if(!db)return [];const rows=await db.getAllAsync<{data:string}>('SELECT data FROM attendance_queue ORDER BY rowid');requireEpoch(expected);return rows.map(r=>JSON.parse(r.data));}
export function queueWrite(items:{id:string}[],expected=epoch){
 const run=attendanceWrites.catch(()=>{}).then(()=>writeAttendance(items,expected));attendanceWrites=run;return run;
}
async function writeAttendance(items:{id:string}[],expected:number){
 requireEpoch(expected);if(!db)return;
 // Expo's exclusive helper opens an unkeyed connection. Key our own isolated connection before BEGIN so the
 // atomic replacement uses SQLCipher and cannot include unrelated cache/sign-out queries on the main handle.
 const key=await SecureStore.getItemAsync('pulse.cache-key');requireEpoch(expected);
 if(!key||!/^[a-f0-9]{64}$/.test(key))throw Error('Encrypted storage unavailable');
 const txn=await SQLite.openDatabaseAsync('pulse.db',{useNewConnection:true});
 try{
  await txn.execAsync(`PRAGMA key="x'${key}'"; PRAGMA busy_timeout=5000;`);
  await txn.withTransactionAsync(async()=>{
   requireEpoch(expected);await txn.execAsync('DELETE FROM attendance_queue;');
   for(const i of items){requireEpoch(expected);await txn.runAsync('INSERT INTO attendance_queue VALUES(?,?)',i.id,JSON.stringify(i));}
   requireEpoch(expected);
  });
 }finally{await txn.closeAsync();}
 requireEpoch(expected);
}
