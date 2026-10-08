// The desktop companion panel (Windows tray / Mac menu bar). Uses the shared companion core; the Rust side keeps
// the device credential, talks to Pulse, positions the window, shows notifications and drives the tray.
import { applyLocal, badge, celebration, clockOffset, deriveView, demoClient, dueReminders, enqueue, outcomeOf, prefsWith, prune, queuedRequest, settle, shouldPopUp, projected } from './companion/index.js';
import { UpdateController, canOfferUpdate } from './companion/updates.js';
import { updateCard } from './companion/update-card.js';
import { icon, mountPanel, renderConnect } from './companion/panel.js';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const root = document.getElementById('app');
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`pulse.${key}`) ?? 'null') ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`pulse.${key}`, JSON.stringify(value)); } catch { /* the choice lasts this session */ } },
};
const state = {
  session: null, payload: null, offset: 0, demo: null, screen: 'day', busy: false, status: null, celebrate: false,
  connect: { phase: 'start' }, prefs: prefsWith(store.get('prefs', {})), mode: store.get('mode', null), queue: store.get('queue', []),
  shown: new Set(store.get('shown', [])), info: { version: '', shortcut: 'Ctrl+Alt+P' }, autostart: false, lastTray: '', pollTimer: null,
};
const panel = mountPanel(root, {
  onAction: (id) => void act(id),
  onMode: (mode) => { state.mode = mode; store.set('mode', mode); render(); },
  onOpen: (href) => void invoke('open_pulse', { path: href }),
  onTool: (tool) => { if (tool === 'settings') { state.screen = 'settings'; render(); } else void invoke('panel_hide'); },
});

const updateContext = () => ({ signedIn: !!state.session?.signedIn, demo: !!state.demo, busy: state.busy || state.installing, pending: state.queue.length > 0 || state.syncing, payload: state.payload });
const updates = new UpdateController({ check: () => invoke('update_check', { channel: store.get('updateChannel', 'test') }), prepare: () => invoke('update_prepare'), clock: () => now(), changed: () => render() });
updates.laterUntil = store.get('updateLater', 0);
async function installUpdate() {
  if (!updates.offer(updateContext())) return;
  state.installing = true; render();
  try { await invoke('update_install', { safe: canOfferUpdate(updateContextForInstall()) }); }
  catch (e) { state.installing = false; state.status = { text: String(e), tone: 'warning' }; render(); }
}
function updateContextForInstall() { return { ...updateContext(), busy: state.busy }; }

function failure(e) {
  if (e && typeof e === 'object' && 'message' in e && !(e instanceof Error)) return e;
  try { return JSON.parse(String(e?.message ?? e)); } catch { return { message: String(e?.message ?? e ?? 'Something went wrong') }; }
}
const now = () => Date.now() + state.offset;
const client = () => state.demo ?? {
  companion: () => invoke('companion_request', { path: 'companion', body: null }),
  act: (id, extra = {}) => {
    const path = id === 'check-in' ? 'attendance/check-in' : id === 'check-out' ? 'attendance/check-out' : 'attendance/break';
    const body = { ...(id === 'check-in' ? { mode: 'office' } : id === 'break-start' ? { action: 'start' } : id === 'break-end' ? { action: 'end' } : {}), via: 'desktop', trigger: 'manual', ...extra };
    return invoke('companion_request', { path, body });
  },
};

// ---------------------------------------------------------------------------------------------------- render
function fit() {
  requestAnimationFrame(() => { const h = Math.ceil(root.getBoundingClientRect().height); if (h > 0) void invoke('panel_fit', { height: h }).catch(() => {}); });
}
function render() {
  if (state.screen === 'connect') {
    renderConnect(root, { ...state.connect, still: !state.prefs.mascot }, connectHandlers);
    const foot = document.createElement('div');
    foot.className = 'connect-foot';
    foot.append(Object.assign(document.createElement('span'), { textContent: new URL(state.session?.base ?? 'https://pulse.estateautopilots.com').host }));
    const settings = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Settings' });
    settings.addEventListener('click', () => { state.screen = 'settings'; render(); });
    foot.append(settings);
    root.append(foot);
    if (!state.prefs.mascot) root.querySelector('.pc-pip')?.remove();
  } else if (state.screen === 'settings') renderSettings();
  else {
    const p = state.queue.length && state.payload ? projected(state.payload, state.queue) : state.payload;
    panel.reset();
    panel.render(deriveView(p, now(), { celebrate: state.celebrate }), {
      busy: state.busy || state.installing, status: state.status?.text ?? (state.demo ? 'Demo · nothing is saved' : state.queue.length ? `${state.queue.length} saved on this computer · will sync` : undefined),
      statusTone: state.status?.tone, mode: state.mode ?? p?.shift?.mode ?? 'office', showPip: state.prefs.mascot,
      tools: [{ id: 'settings', label: 'Settings', icon: 'settings' }, { id: 'close', label: `Hide (${state.info.shortcut})`, icon: 'close' }],
    });
  }
  const update = updates.offer(updateContext());
  if (update) updateCard(state.screen === 'settings' ? root.firstElementChild : root, { update, showPip: state.prefs.mascot, onInstall: () => void installUpdate(), onLater: () => { updates.later(); store.set('updateLater', updates.laterUntil); } });
  fit();
}
function tick() {
  if (state.screen !== 'day' || !state.payload) return;
  const p = state.queue.length ? projected(state.payload, state.queue) : state.payload;
  panel.tick(deriveView(p, now(), { celebrate: state.celebrate }));
}

function renderSettings() {
  const wrap = document.createElement('section');
  wrap.className = 'settings';
  wrap.setAttribute('aria-label', 'Pulse settings');
  const head = document.createElement('header');
  const title = Object.assign(document.createElement('h2'), { textContent: 'Settings' });
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'pc-tool'; back.setAttribute('aria-label', 'Back'); back.innerHTML = icon('close');
  back.addEventListener('click', () => { state.screen = state.session?.signedIn || state.demo ? 'day' : 'connect'; render(); });
  head.append(title, back);
  wrap.append(head);
  const section = (text) => wrap.append(Object.assign(document.createElement('h3'), { textContent: text }));
  const toggle = (label, hint, checked, onChange) => {
    const row = document.createElement('label'); row.className = 'row';
    const text = document.createElement('span'); text.textContent = label;
    if (hint) { text.append(document.createElement('br'), Object.assign(document.createElement('small'), { textContent: hint })); }
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked });
    input.addEventListener('change', () => onChange(input.checked));
    row.append(text, input);
    wrap.append(row);
  };
  const setPref = (key, value) => { state.prefs = prefsWith({ ...state.prefs, [key]: value }); store.set('prefs', state.prefs); };
  section('Updates');
  const check = Object.assign(document.createElement('button'), { type: 'button', className: 'pc-btn', textContent: 'Check for updates', disabled: updates.running || !state.session?.signedIn || !!state.demo });
  check.addEventListener('click', () => void updates.poll(updateContext(), true));
  wrap.append(check, Object.assign(document.createElement('p'), { className: 'muted', textContent: updates.status || 'Pulse checks every four hours. Test channel.' }));
  const select = document.createElement('select'); select.setAttribute('aria-label', 'Update channel');
  for (const value of ['test', 'stable']) select.append(Object.assign(document.createElement('option'), { value, textContent: value === 'test' ? 'Test updates' : 'Stable updates' }));
  select.value = store.get('updateChannel', 'test');
  select.addEventListener('change', () => { store.set('updateChannel', select.value); updates.reset(); void updates.poll(updateContext(), true); });
  wrap.append(select);
  section('Reminders');
  toggle('Check in when my shift starts', null, state.prefs.checkIn, (v) => setPref('checkIn', v));
  toggle('Back from a break', `After ${state.prefs.breakMinutes} minutes away`, state.prefs.breakBack, (v) => setPref('breakBack', v));
  const minutes = document.createElement('label'); minutes.className = 'row';
  minutes.append(Object.assign(document.createElement('span'), { textContent: 'Break reminder after (minutes)' }));
  const m = Object.assign(document.createElement('input'), { type: 'number', min: 5, max: 180, step: 5, value: state.prefs.breakMinutes });
  m.addEventListener('change', () => setPref('breakMinutes', Number(m.value) || 30));
  minutes.append(m); wrap.append(minutes);
  toggle('Check out when my shift ends', null, state.prefs.checkOut, (v) => setPref('checkOut', v));
  section('This computer');
  toggle('Slide the panel up when my workday starts', null, state.prefs.popAtStart, (v) => setPref('popAtStart', v));
  toggle('Open Pulse when I sign in to the computer', 'Off unless you turn it on', state.autostart, (v) => { void invoke('autostart_set', { enabled: v }).then((on) => { state.autostart = on; }).catch((e) => { state.status = { text: failure(e).message, tone: 'warning' }; }); });
  toggle('Show Pip, the Pulse bot', 'Calm still poses when your system asks for less motion', state.prefs.mascot, (v) => { setPref('mascot', v); });
  section('Privacy');
  const privacy = document.createElement('p'); privacy.className = 'muted';
  privacy.textContent = 'Optional activity details (focus and idle time) are off. They start only if you accept the published notice.';
  const open = Object.assign(document.createElement('button'), { type: 'button', className: 'pc-link', textContent: 'Settings & privacy…' });
  open.addEventListener('click', () => void invoke('open_privacy'));
  wrap.append(privacy, open);
  section('Account');
  if (state.session?.signedIn) {
    const who = Object.assign(document.createElement('p'), { className: 'muted', textContent: `Signed in as ${state.session.personName || 'you'} on ${new URL(state.session.base).host}. Sign this computer out here, in Settings → Devices or Account / Security.` });
    const out = Object.assign(document.createElement('button'), { type: 'button', className: 'pc-btn', textContent: 'Sign out of this computer', disabled: !!state.installing });
    out.addEventListener('click', () => void signOut());
    wrap.append(who, out);
  } else if (state.developer) {
    const label = document.createElement('label'); label.className = 'pc-field'; label.textContent = 'Developer server';
    const base = Object.assign(document.createElement('input'), { type: 'url', value: state.session?.base ?? '', spellcheck: false });
    base.addEventListener('change', () => { state.session = { ...(state.session ?? {}), base: base.value.trim() }; });
    label.append(base); wrap.append(label);
  }
  const version = Object.assign(document.createElement('p'), { className: 'muted', textContent: `Pulse ${state.info.version} · open or hide with ${state.info.shortcut}` });
  let taps = 0; version.addEventListener('click', () => { if (++taps === 7) { state.developer = true; renderSettings(); } });
  wrap.append(version);
  root.replaceChildren(wrap);
}

// ---------------------------------------------------------------------------------------------------- data
async function refresh() {
  if (state.screen === 'connect' && !state.demo) return;
  try {
    state.syncing = true;
    await flush();
    const p = await client().companion();
    state.payload = p; state.offset = clockOffset(p);
    if (state.status?.tone === 'warning') state.status = null;
  } catch (e) {
    const f = failure(e);
    if (f.signedOut) { updates.reset(); state.session = await invoke('companion_session'); state.screen = 'connect'; state.connect = { phase: 'start', message: f.message }; }
    else state.status = { text: f.message, tone: 'warning' };
  }
  state.syncing = false;
  render(); tray(); remind();
  void updates.poll(updateContext());
}
async function flush() {
  if (state.demo) return;
  const { keep, expired } = prune(state.queue, Date.now());
  if (expired.length) state.status = { text: `${expired.length} saved action${expired.length > 1 ? 's were' : ' was'} too old to send. Ask for a correction on My desk.`, tone: 'warning' };
  state.queue = keep;
  while (state.queue.length) {
    const item = state.queue[0], { action, extra } = queuedRequest(item);
    try { await client().act(action, extra); state.queue = settle(state.queue, item.id, 'ok'); }
    catch (e) { const outcome = outcomeOf(failure(e)); state.queue = settle(state.queue, item.id, outcome); if (outcome === 'retry') break; state.status = { text: failure(e).message, tone: 'warning' }; }
  }
  store.set('queue', state.queue);
}
async function act(id) {
  if (state.busy || state.installing || !state.payload) return;
  const before = state.payload, at = now(), extra = id === 'check-in' ? { mode: state.mode ?? before.shift?.mode ?? 'office' } : {};
  state.busy = true; state.status = null;
  state.payload = { ...applyLocal(before, id, at, extra), pending: false };
  render();
  try {
    await client().act(id, extra);
    const p = await client().companion();
    state.payload = p; state.offset = clockOffset(p);
    const party = id === 'check-in' && p.entry && !p.entry.late ? celebration(p) : null;
    state.status = party ? null : { text: id === 'check-in' ? 'Checked in. Have a good day!' : id === 'break-start' ? 'Enjoy your break' : id === 'break-end' ? 'Welcome back' : 'Checked out. See you tomorrow!', tone: 'success' };
    if (party) { state.celebrate = true; setTimeout(() => { state.celebrate = false; render(); }, 4200); }
  } catch (e) {
    const f = failure(e);
    if (f.offline || f.gate) {
      state.payload = before;
      state.queue = enqueue(state.queue, id, at, extra); store.set('queue', state.queue);
      state.status = { text: 'Saved on this computer · Pulse will catch up when it can', tone: 'success' };
    } else { state.payload = before; state.status = { text: f.message, tone: 'warning' }; }
  } finally { state.busy = false; render(); tray(); }
}
function tray() {
  const p = state.queue.length && state.payload ? projected(state.payload, state.queue) : state.payload;
  const b = state.session?.signedIn || state.demo ? badge(p, now()) : { text: '', tone: 'neutral', title: 'Pulse · sign in to check in' };
  const key = JSON.stringify(b);
  if (key !== state.lastTray) { state.lastTray = key; void invoke('set_tray', { text: b.text, tone: b.tone, title: b.title }).catch(() => {}); }
}
function remind() {
  if (!state.payload || state.demo) return;
  const at = now();
  for (const r of dueReminders(state.payload, state.prefs, at, state.shown)) {
    state.shown.add(r.id);
    void invoke('notify', { title: r.title, body: r.body }).catch(() => {});
    if (r.kind === 'check-in' && state.prefs.popAtStart) void invoke('panel_show');
  }
  const pop = shouldPopUp(state.payload, state.prefs, at, state.shown);
  if (pop) { state.shown.add(pop); void invoke('panel_show'); }
  store.set('shown', [...state.shown].slice(-60));
}

// ---------------------------------------------------------------------------------------------------- sign-in
const connectHandlers = {
  async onPair() {
    state.connect = { phase: 'start', busy: true, message: 'Opening Pulse in your browser…' }; render();
    try {
      const started = await invoke('companion_pair_start', { base: state.session?.base ?? 'https://pulse.estateautopilots.com/api/native/v0' });
      state.connect = { phase: 'code', code: started.code, url: started.verifyUrl, message: 'Waiting for your approval…' }; render();
      clearInterval(state.pollTimer);
      const deadline = Date.now() + (started.expiresIn ?? 600) * 1000;
      state.pollTimer = setInterval(async () => {
        if (Date.now() > deadline) { clearInterval(state.pollTimer); state.connect = { phase: 'error', message: 'The code expired. Start again when you’re ready.' }; render(); return; }
        try {
          const r = await invoke('companion_pair_poll');
          if (r.status === 'approved') { clearInterval(state.pollTimer); await signedIn(r.session); }
          else if (r.status !== 'pending') { clearInterval(state.pollTimer); state.connect = { phase: 'error', message: r.status === 'denied' ? 'Not approved. Nothing was signed in.' : 'The code expired. Start again when you’re ready.' }; render(); }
        } catch (e) { const f = failure(e); if (!f.offline) { clearInterval(state.pollTimer); state.connect = { phase: f.gate ? 'gate' : 'error', message: f.message }; render(); } }
      }, Math.max(2, started.interval ?? 3) * 1000);
    } catch (e) { const f = failure(e); state.connect = { phase: f.gate ? 'gate' : 'error', message: f.message }; render(); }
  },
  onOpenUrl() { if (state.connect.code) void invoke('open_pulse', { path: `/connect?code=${state.connect.code}` }); },
  onCancel() { clearInterval(state.pollTimer); void invoke('companion_pair_cancel'); state.connect = { phase: 'start' }; render(); },
  onPasswordStart() { state.connect = { phase: 'password' }; render(); root.querySelector('input')?.focus(); },
  async onPassword({ username, password, code }) {
    state.connect = { ...state.connect, busy: true, message: 'Signing in…' }; render();
    try {
      const r = await invoke('companion_password', { base: state.session?.base ?? 'https://pulse.estateautopilots.com/api/native/v0', username, password, code: code || null });
      if (r.twoStep) { state.connect = { phase: 'password', twoStep: true, message: 'Enter the code from your authenticator app.' }; render(); return; }
      await signedIn(r);
    } catch (e) { const f = failure(e); state.connect = { phase: f.gate ? 'gate' : 'password', twoStep: state.connect.twoStep, message: f.message }; render(); }
  },
  onDemo() { state.demo = demoClient('out'); state.screen = 'day'; void refresh(); },
};
async function signedIn(session) {
  state.session = session; state.demo = null; state.screen = 'day'; state.connect = { phase: 'start' };
  await refresh();
  state.status = { text: `Hello${session.personName ? `, ${session.personName.split(' ')[0]}` : ''}! You’re connected.`, tone: 'success' };
  state.celebrate = true; render();
  setTimeout(() => { state.celebrate = false; render(); }, 3500);
}
async function signOut() {
  updates.reset();
  state.session = await invoke('companion_sign_out');
  state.payload = null; state.queue = []; store.set('queue', []); state.screen = 'connect'; state.connect = { phase: 'start', message: 'Signed out of this computer.' };
  render(); tray();
}

// ---------------------------------------------------------------------------------------------------- start
window.pulsePanel = {
  shown() { root.firstElementChild?.classList.remove('pc-enter'); void root.offsetWidth; root.firstElementChild?.classList.add('pc-enter'); void refresh(); },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') void invoke('panel_hide'); });
async function boot() {
  try { state.info = await invoke('app_info'); } catch { /* defaults */ }
  try { state.autostart = await invoke('autostart_get'); } catch { /* unsupported */ }
  state.session = await invoke('companion_session');
  state.screen = state.session.signedIn ? 'day' : 'connect';
  render();
  // Startup health includes the real WebView loading and session initialization. Works signed out too.
  await invoke('update_healthy').catch(() => {});
  await refresh();
  void updates.poll(updateContext());
  setInterval(() => { void updates.poll(updateContext()); render(); }, 60000);
  setInterval(tick, 1000);
  setInterval(() => { tray(); remind(); }, 30000);
  setInterval(() => void refresh(), 120000);
}
void boot();
