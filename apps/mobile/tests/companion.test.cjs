// Phone companion with simulated inputs: offline queue, region and Wi-Fi presence, automatic check-in, reminders and
// notification buttons. Expo modules and the network are stubs; the decisions are the shared core's.
const { test } = require('node:test'); const assert = require('node:assert/strict'); const vm = require('node:vm'); const fs = require('node:fs'); const path = require('node:path'); const ts = require('typescript');
const core = require(path.resolve(__dirname, '../../../packages/companion/src/index.js'));
const IST = (hhmm) => Date.parse(`2026-10-08T${hhmm}:00+05:30`);
const plain = (x) => JSON.parse(JSON.stringify(x));
const real = (state, at) => ({ ...core.demoPayload(state, at), demo: false });

function fixture({ at = IST('09:50'), autoHr = false, prefs = { presence: true }, wifi = null, offline = false } = {}) {
  const keychainOptions = new Map();
  const secure = new Map([['pulse.companion-prefs', JSON.stringify(prefs)]]);
  let queue = [], clock = at, generation = 0, gpsReads = 0, wifiConfigurations = 0, net = { offline };
  const requests = [], scheduled = [], cancelled = [], categories = [];
  const office = { id: '11111111-1111-4111-8111-111111111111', name: 'Demo office', lat: 0.5, lng: 0.5, radius: 150, wifi: [{ ssid: 'Demo-WiFi', bssids: ['a4:2b:b0:11:22:33'] }] };
  let state = 'out';
  const payload = () => { const p = core.demoPayload(state, clock); p.presence = { autoCheckIn: autoHr, offices: [office], sites: [] }; p.now = new Date(clock).toISOString(); return p; };
  const offlineError = () => Object.assign(new Error('Offline · saved work remains pending'), { offline: true });
  const client = {
    sessionGeneration: () => generation,
    request: async (p, body) => { requests.push({ path: p, body }); if (net.offline) throw offlineError(); if (p === 'attendance/check-in') state = 'in'; if (p === 'attendance/check-out') state = 'done'; if (p === 'attendance/break') state = body.action === 'start' ? 'break' : 'in'; return { ok: true }; },
    load: async (p) => { if (net.offline) throw offlineError(); return { data: payload(), at: new Date(clock).toISOString(), offline: false }; },
    cached: async () => ({ data: payload(), at: new Date(clock).toISOString() }),
    queueRead: async () => JSON.parse(JSON.stringify(queue)),
    queueWrite: async (items) => { queue = JSON.parse(JSON.stringify(items)); },
  };
  const stubs = {
    'react-native': { Platform: { OS: 'android' } },
    'expo-secure-store': { AFTER_FIRST_UNLOCK: 17, getItemAsync: async (k) => secure.get(k) ?? null, setItemAsync: async (k, v, options) => { secure.set(k, v); keychainOptions.set(k, options); } },
    'expo-location': { requestForegroundPermissionsAsync: async () => ({ granted: true }), getForegroundPermissionsAsync: async () => ({ granted: true }), getBackgroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true }), requestBackgroundPermissionsAsync: async () => ({ granted: true }),
      startGeofencingAsync: async (task, regions) => { requests.push({ geofence: task, regions }); }, hasStartedGeofencingAsync: async () => false, stopGeofencingAsync: async () => {}, getLastKnownPositionAsync: async () => { gpsReads++; return null; }, getCurrentPositionAsync: async () => { gpsReads++; return null; }, Accuracy: { Balanced: 3 } },
    'expo-notifications': { DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT', SchedulableTriggerInputTypes: { DATE: 'date' }, AndroidImportance: { HIGH: 4 },
      setNotificationHandler: () => {}, setNotificationChannelAsync: async () => {}, setNotificationCategoryAsync: async (id, actions) => { categories.push({ id, actions }); },
      scheduleNotificationAsync: async (n) => { scheduled.push(n); return n.identifier ?? `n${scheduled.length}`; }, getAllScheduledNotificationsAsync: async () => scheduled.filter((n) => n.identifier).map((n) => ({ identifier: n.identifier })), cancelScheduledNotificationAsync: async (id) => { cancelled.push(id); } },
    '@react-native-community/netinfo': { __esModule: true, default: { configure: () => { wifiConfigurations++; }, fetch: async () => (wifi ? { type: 'wifi', details: wifi } : { type: 'cellular', details: null }) } },
    './client': client,
    '../../../packages/companion/src/index.js': core,
  };
  const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/companion.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  vm.runInNewContext(source, { module, exports: module.exports, require: (n) => { if (!(n in stubs)) throw Error('unexpected import ' + n); return stubs[n]; }, Date: FakeDate, JSON, Math, Promise, Error, Set, Map, Object, Array, String, Number, Infinity, console });
  return { m: module.exports, keychainOptions, wifiConfigurations: () => wifiConfigurations, gpsReads: () => gpsReads, requests, scheduled, cancelled, categories, secure, net, office, setClock: (t) => { clock = t; }, queue: () => queue, setState: (s) => { state = s; }, switchPerson: () => { generation++; queue = []; } };
}

test('overlapping offline taps and a foreground sync keep both taps in order', async () => {
  const f = fixture({ offline: true });
  await Promise.all([f.m.act('check-in'), f.m.flushQueue(), f.m.act('break-start')]);
  assert.deepEqual(plain(f.queue().map((q) => q.action)), ['check-in', 'break-start']);
  f.net.offline = false;
  const before = f.requests.length;
  await Promise.all([f.m.flushQueue(), f.m.flushQueue()]);
  assert.equal(f.requests.slice(before).filter((r) => r.body?.queueId && !r.body?.action).length, 1);
  assert.equal(f.requests.slice(before).filter((r) => r.body?.queueId && r.body?.action === 'start').length, 1);
});

test('queued work from a former session cannot execute after switching person', async () => {
  const f = fixture({ offline: true });
  const pending = f.m.act('check-in').then(() => null, (e) => e);
  f.switchPerson();
  assert.match(String(await pending), /sign-in changed/);
  assert.equal(f.queue().length, 0);
  assert.equal(f.requests.length, 0);
});

test('a tap offline is kept with its time and synced once, in order, when back online', async () => {
  const f = fixture({ offline: true });
  assert.deepEqual(plain(await f.m.act('check-in', { mode: 'office' })), { queued: true });
  f.setClock(IST('12:00'));
  await f.m.act('break-start');
  assert.equal(f.queue().length, 2);
  const day = await f.m.loadDay();
  assert.equal(day.offline, true); assert.equal(day.queued, 2); assert.equal(day.payload.state, 'break', 'the phone shows what it saved');
  f.net.offline = false; f.setClock(IST('12:30'));
  const before = f.requests.length;
  const sent = await f.m.flushQueue();
  assert.equal(sent.sent, 2); assert.equal(f.queue().length, 0);
  const posts = f.requests.slice(before).filter((r) => r.path?.startsWith('attendance/') && r.body?.queueId);
  assert.deepEqual(plain(posts.map((r) => r.path)), ['attendance/check-in', 'attendance/break']);
  assert.equal(posts[0].body.at, new Date(IST('09:50')).toISOString());
  assert.equal(posts[0].body.via, 'mobile');
});

test('saved taps older than three hours are not sent; the person is told to ask for a correction', async () => {
  const f = fixture({ offline: true });
  await f.m.act('check-in');
  f.net.offline = false; f.setClock(IST('13:10'));
  const r = await f.m.flushQueue();
  assert.deepEqual(plain([r.sent, r.expired]), [0, 1]);
  assert.equal(f.requests.filter((x) => x.body?.queueId).length, 0);
});

test('arriving at the office: one suggestion notification with a Check in button, not repeated within 30 minutes', async () => {
  const f = fixture();
  const d = await f.m.onRegion('enter', `office:${f.office.id}`);
  assert.equal(d.kind, 'suggest-check-in');
  assert.equal(f.scheduled.length, 1);
  const n = f.scheduled[0].content;
  assert.match(n.title, /You’re at Demo office — check in\?/);
  assert.equal(n.categoryIdentifier, 'pulse-check-in');
  assert.deepEqual(plain(n.data.body.place), { kind: 'office', id: f.office.id, signal: 'region' });
  assert.equal(JSON.stringify(n).includes('28.45'), false, 'no coordinates leave the decision');
  f.setClock(IST('10:05'));
  assert.equal((await f.m.onRegion('enter', `office:${f.office.id}`)).reason, 'repeat');
  assert.equal(f.scheduled.length, 1);
  assert.equal(await f.m.onRegion('enter', 'office:unknown'), null);
});

test('automatic check-in waits for server-confirmed dwell; each person controls consent', async () => {
  const off = fixture({ autoHr: true, prefs: { presence: true, autoCheckIn: false } });
  await off.m.onRegion('enter', `office:${off.office.id}`);
  assert.equal(off.requests.filter((r) => r.path === 'attendance/check-in').length, 0);
  const on = fixture({ autoHr: true, prefs: { presence: true, autoCheckIn: true } });
  const d = await on.m.onRegion('enter', `office:${on.office.id}`);
  assert.equal(d.kind, 'suggest-check-in');
  const post = on.requests.find((r) => r.path === 'companion/presence' && r.body.region==='enter');
  assert.equal(post.body.consent, true); assert.equal(post.body.autoConsent, true); assert.equal(post.body.region, 'enter');
  assert.equal(on.requests.filter(r=>r.path==='attendance/check-in').length,0);
  assert.match(on.scheduled[0].content.title, /check in/);
  assert.equal(JSON.stringify(post.body).includes('lat'),false);
});

test('leaving during the day offers a break or check-out; never checks out by itself', async () => {
  const f = fixture({ at: IST('13:00') });
  f.setState('in');
  const d = await f.m.onRegion('exit', `office:${f.office.id}`);
  assert.equal(d.kind, 'suggest-leave');
  assert.equal(f.scheduled[0].content.categoryIdentifier, 'pulse-leave');
  assert.equal(f.requests.filter((r) => r.path === 'attendance/check-out').length, 0);
});

test('office Wi-Fi on opening the app: strong BSSID match suggests checking in', async () => {
  const f = fixture({ wifi: { ssid: 'Demo-WiFi', bssid: 'A4:2B:B0:11:22:33' } });
  const here = await f.m.checkHere(core.demoPayload('out', IST('09:50')));
  assert.equal(here.signal.trigger, 'wifi');
  assert.equal(here.signal.place.strength, 'strong');
  assert.equal(here.decision.kind, 'suggest-check-in');
  assert.equal(f.scheduled.length, 0, 'in the app it is a banner, not a notification');
  const none = fixture({ wifi: { ssid: 'Cafe', bssid: '00:11:22:33:44:55' }, prefs: { presence: true } });
  assert.equal(await none.m.checkHere(core.demoPayload('out', IST('09:50'))), null);
});

test('opening away from office Wi-Fi never reads a GPS fix', async () => {
  const f = fixture();
  assert.equal(await f.m.checkHere(core.demoPayload('out', IST('09:50'))), null);
  assert.equal(f.gpsReads(), 0);
});

test('presence on: the OS watches the office boundary (region monitoring, no polling)', async () => {
  const f = fixture();
  const p = core.demoPayload('out', IST('09:50')); p.presence = { autoCheckIn: false, offices: [f.office], sites: [] };
  const st = await f.m.startPresence(p);
  assert.deepEqual(plain([st.on, st.background, st.regions]), [true, true, 1]);
  const g = f.requests.find((r) => r.geofence);
  assert.equal(g.geofence, 'pulse-presence');
  assert.deepEqual(plain(g.regions[0]), { identifier: `office:${f.office.id}`, latitude: f.office.lat, longitude: f.office.lng, radius: 150, notifyOnEnter: true, notifyOnExit: true });
});

test('reminders are scheduled from the day with action buttons, and rebuilt each time', async () => {
  const f = fixture({ at: IST('08:00') });
  await f.m.setupNotifications();
  assert.deepEqual(plain(f.categories.map((c) => c.id).sort()), ['pulse-back', 'pulse-check-in', 'pulse-check-out', 'pulse-leave']);
  const n = await f.m.scheduleReminders(real('out', IST('08:00')), core.prefsWith({}));
  assert.ok(n >= 2);
  assert.equal(f.scheduled[0].identifier, 'reminder:check-in:2026-10-08');
  assert.equal(f.scheduled[0].content.categoryIdentifier, 'pulse-check-in');
  assert.equal(f.scheduled[0].trigger.date, IST('10:00'));
  await f.m.scheduleReminders(real('out', IST('08:00')), core.prefsWith({ checkIn: false }));
  assert.ok(f.cancelled.includes('reminder:check-in:2026-10-08'));
});

test('notification buttons map to actions; a plain tap only opens the app', () => {
  const f = fixture();
  const response = (actionIdentifier, data = {}) => ({ actionIdentifier, notification: { request: { content: { data } } } });
  assert.deepEqual(f.m.responseAction(response('check-in', { body: { mode: 'office', trigger: 'suggested', place: { kind: 'office', id: 'x', signal: 'region' } } })).extra.trigger, 'suggested');
  assert.equal(f.m.responseAction(response('break-end')).action, 'break-end');
  assert.equal(f.m.responseAction(response('expo.modules.notifications.actions.DEFAULT')), null);
  assert.equal(f.m.responseAction(response('delete-everything')), null);
});

test('presence consent and cooldown can be read by a locked-phone region callback after first unlock', async () => {
  const f = fixture();
  await f.m.writePrefs({ presence: true });
  await f.m.onRegion('enter', `office:${f.office.id}`);
  assert.equal(f.keychainOptions.get('pulse.companion-prefs')?.keychainAccessible, 17);
  assert.equal(f.keychainOptions.get('pulse.presence-recent')?.keychainAccessible, 17);
});

test('repeated office Wi-Fi lookups do not reset foreground network listeners', async () => {
  const f = fixture();
  assert.equal(f.wifiConfigurations(), 1);
  await f.m.checkHere(core.demoPayload('out', IST('09:50')));
  await f.m.checkHere(core.demoPayload('out', IST('09:50')));
  assert.equal(f.wifiConfigurations(), 1);
});

test('an opt-out saved offline is sent before the next day refresh after reconnect',async()=>{
 const f=fixture({offline:true,prefs:{presence:true,autoCheckIn:true}});
 await f.m.writePrefs({presence:false,autoCheckIn:false});f.net.offline=false;
 const before=f.requests.length;await f.m.loadDay();
 const reconciled=f.requests.slice(before).find(r=>r.path==='companion/presence');
 assert.deepEqual(plain(reconciled.body),{consent:false,autoConsent:false,consentOnly:true});
 assert.equal(f.gpsReads(),0);
});

test('headless attendance activity suppresses an update offer until all serialized work settles', async () => {
  const f = fixture({ offline: true });
  const policy = require(path.resolve(__dirname, '../../../packages/companion/src/updates.js'));
  const events = []; const stop = f.m.observeAttendance(() => events.push(f.m.attendanceInProgress()));
  const first = f.m.act('check-in'), second = f.m.act('break-start');
  assert.equal(f.m.attendanceInProgress(), true);
  const context = { signedIn: true, payload: { shiftStartsAt: '2026-10-08T01:00:00Z' }, at: Date.parse('2026-10-08T10:00:00Z') };
  assert.equal(policy.canOfferUpdate({ ...context, pending: f.m.attendanceInProgress() }), false);
  await Promise.all([first, second]);
  assert.equal(f.m.attendanceInProgress(), false);
  assert.equal(policy.canOfferUpdate({ ...context, pending: f.m.attendanceInProgress() }), true);
  assert.equal(events.at(-1), false);stop();
});
