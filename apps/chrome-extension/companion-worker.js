// The Chrome companion's background half. Every Pulse call goes through here, so one place rotates the device
// credential (two contexts rotating at once would look like a replay and sign the device out). It keeps the toolbar
// badge current, shows reminders with a button, and finishes browser pairing even after the popup closes.
import { actionRequest, badge, clockOffset, createClient, demoClient, dueReminders, prefsWith, verifyUrl } from './shared/index.js';
import { companionBase, companionStore } from './companion-store.js';

const ALARM = 'pulse-companion';
const TONE = { success: '#328267', info: '#4167cf', warning: '#9a6209', neutral: '#66687e' };
const ACTION_LABEL = { 'check-in': 'Check in', 'break-start': 'Take a break', 'break-end': 'I’m back', 'check-out': 'Check out' };
const version = chrome.runtime.getManifest().version;
let demo = null;
let polling = false;
let gateway = null;
let gatewayBase = null;

async function client() {
  const base = await companionBase();
  if (!gateway || gatewayBase !== base) {
    gatewayBase = base;
    gateway = createClient({ base, store: companionStore, credentials: 'include', client: `chrome/${version}` });
  }
  return gateway;
}
const plainError = (e) => ({ message: e?.message ?? String(e), status: e?.status ?? 0, gate: !!e?.gate, offline: !!e?.offline, signedOut: !!e?.signedOut });

async function setBadge(b) {
  await chrome.action.setBadgeText({ text: b?.text ?? '' });
  await chrome.action.setBadgeBackgroundColor({ color: TONE[b?.tone] ?? TONE.neutral });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setTitle({ title: b?.title ?? 'Pulse · sign in to check in' });
}

/** The day, fetched at most every few minutes for the badge, always fresh when the popup asks (force). */
async function day(force = false) {
  if (demo) return { payload: await demo.companion(), offset: 0, demo: true };
  if (!(await companionStore.get())) return null;
  const { companionDay } = await chrome.storage.session.get('companionDay');
  if (!force && companionDay && Date.now() - companionDay.fetchedAt < 4 * 60000) return companionDay;
  const payload = await (await client()).companion();
  const next = { payload, offset: clockOffset(payload), fetchedAt: Date.now() };
  await chrome.storage.session.set({ companionDay: next });
  return next;
}

async function tick() {
  let d = null;
  try { d = await day(); } catch (e) { if (e?.signedOut) { await companionStore.clear(); await setBadge(null); } return; }
  if (!d) { await setBadge(null); return; }
  const at = Date.now() + d.offset;
  await setBadge(badge(d.payload, at));
  if (d.demo) return;
  const { companionShown = [], companionPrefs = {} } = await chrome.storage.local.get(['companionShown', 'companionPrefs']);
  for (const r of dueReminders(d.payload, companionPrefs, at, companionShown)) {
    companionShown.push(r.id);
    chrome.notifications.create(`pulse:${r.action}:${r.id}`, { type: 'basic', iconUrl: 'icons/128.png', title: r.title, message: r.body, buttons: [{ title: ACTION_LABEL[r.action] }], priority: 1 });
  }
  await chrome.storage.local.set({ companionShown: companionShown.slice(-60) });
}

async function act(action, extra = {}) {
  if (demo) { await demo.act(action, extra); return day(true); }
  const { path, body } = actionRequest(action, { via: 'chrome', trigger: 'manual', ...extra });
  await (await client()).call(path, body);
  const d = await day(true);
  await setBadge(badge(d.payload, Date.now() + d.offset));
  return d;
}

/** Browser pairing: the tab with the code opens; this keeps asking until the person approves (the popup may close). */
async function pairStart() {
  const c = await client();
  const started = await c.pairStart('chrome', 'Pulse in Chrome');
  const pair = { code: started.code, pairId: started.pairId, pollSecret: started.pollSecret, url: verifyUrl(c.base, started.code), until: Date.now() + started.expiresIn * 1000, interval: started.interval ?? 3 };
  await chrome.storage.session.set({ companionPair: pair });
  await chrome.tabs.create({ url: pair.url });
  void pollPairing();
  return { code: pair.code, url: pair.url };
}
async function pollPairing() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const { companionPair: pair } = await chrome.storage.session.get('companionPair');
      if (!pair) return;
      if (Date.now() > pair.until) { await chrome.storage.session.set({ companionPair: { ...pair, status: 'expired' } }); return; }
      await new Promise((r) => setTimeout(r, pair.interval * 1000));
      let r;
      try { r = await (await client()).pairPoll(pair.pairId, pair.pollSecret); } catch (e) { if (e?.offline) continue; await chrome.storage.session.set({ companionPair: { ...pair, status: 'error', message: e.message } }); return; }
      if (r.status === 'pending') continue;
      if (r.status === 'approved') {
        await chrome.storage.session.remove('companionPair');
        demo = null;
        chrome.notifications.create('pulse:connected', { type: 'basic', iconUrl: 'icons/128.png', title: 'Pulse is connected', message: `Hello${r.person?.name ? `, ${r.person.name.split(' ')[0]}` : ''}! Click the Pulse button in the toolbar to check in.`, priority: 1 });
        await tick();
      } else await chrome.storage.session.set({ companionPair: { ...pair, status: r.status } });
      return;
    }
  } finally { polling = false; }
}

/** Popup messages: { op: 'state' | 'act' | 'pair' | 'cancelPair' | 'signOut' | 'demo' | 'prefs' | 'base' }. */
export function handleCompanionMessage(msg, respond) {
  const run = async () => {
    switch (msg.op) {
      case 'state': {
        const { companionPair: pair } = await chrome.storage.session.get('companionPair');
        const { companionPrefs = {}, companionBase: base } = await chrome.storage.local.get(['companionPrefs', 'companionBase']);
        const signedIn = !!(await companionStore.get()) || !!demo;
        let d = null, error = null;
        if (signedIn) { try { d = await day(!!msg.force); } catch (e) { error = plainError(e); if (e?.signedOut) await companionStore.clear(); } }
        if (pair && !pair.status && !polling) void pollPairing();
        return { signedIn: signedIn && !error?.signedOut, demo: !!demo, pair: pair ? { code: pair.code, url: pair.url, status: pair.status ?? 'pending', message: pair.message } : null, day: d, error, prefs: prefsWith(companionPrefs), base: base ?? null };
      }
      case 'act': return { day: await act(msg.action, msg.extra) };
      case 'pair': return await pairStart();
      case 'cancelPair': await chrome.storage.session.remove('companionPair'); return {};
      case 'signOut': demo = null; await (await client()).signOut(); await setBadge(null); return {};
      case 'demo': demo = msg.on ? demoClient('out') : null; await tick(); return {};
      case 'prefs': await chrome.storage.local.set({ companionPrefs: prefsWith(msg.prefs) }); return {};
      case 'base': await chrome.storage.local.set({ companionBase: msg.base || null }); return {};
      default: throw new Error('Unknown request');
    }
  };
  run().then((data) => respond({ ok: true, data }), (e) => respond({ ok: false, error: plainError(e) }));
  return true;
}

export function startCompanion() {
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) void tick(); });
  chrome.runtime.onStartup.addListener(() => void tick());
  chrome.notifications.onButtonClicked.addListener((id) => {
    const [, action] = id.split(':');
    if (!ACTION_LABEL[action]) return;
    void act(action, { trigger: 'reminder' }).then(
      () => chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Pulse', message: `${ACTION_LABEL[action]} — done.`, priority: 0 }),
      (e) => chrome.notifications.create({ type: 'basic', iconUrl: 'icons/128.png', title: 'Pulse could not do that', message: e.message, priority: 1 }));
    chrome.notifications.clear(id);
  });
  void tick();
}
