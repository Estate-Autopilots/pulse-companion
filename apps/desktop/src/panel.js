// The desktop quick panel (Windows tray / Mac menu bar). Uses the shared companion core; the Rust side keeps
// the device credential, talks to Pulse, positions the window, shows notifications and drives the tray.
// Settings live in their own window (settings.html); the full Pulse opens in the Pulse window.
import { applyLocal, badge, celebration, clockOffset, deriveView, demoClient, dueReminders, enqueue, outcomeOf, prefsWith, prune, queuedRequest, settle, shouldPopUp, projected } from './companion/index.js';
import { UpdateController, canOfferUpdate } from './companion/updates.js';
import { updateCard } from './companion/update-card.js';
import { mountCommunications } from './companion/communications.js';
import { mountPanel, renderConnect } from './companion/panel.js';
import { mountFeatures } from './companion/features.js';
import { applyTheme, store } from './prefs.js';
import { DEMO_CONVERSATION, demoCall, demoSnapshot } from './demo-comms.js';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const listen = (name, run) => { try { return window.__TAURI__.event?.listen(name, run)?.catch?.(() => {}); } catch { return null; } };
const root = document.getElementById('app');
const state = {
  session: null, payload: null, offset: 0, demo: null, screen: 'day', busy: false, status: null, celebrate: false,
  connect: { phase: 'start' }, prefs: prefsWith(store.get('prefs', {})), mode: store.get('mode', null), queue: store.get('queue', []),
  shown: new Set(store.get('shown', [])), info: { version: '', shortcut: 'Ctrl+Alt+P' }, lastTray: '', pollTimer: null,
};
applyTheme();
const communications = mountCommunications(root, {
  call: (path, body) => state.demo ? demoCall(path, body) : invoke('companion_request', { path, body: body ?? null }).catch((e) => { throw failure(e); }),
  onFixPings: () => void invoke('companion_ping_fix').then((r) => { communications.pingIssue(r?.ok ? null : r?.message ?? null); if (r?.ok) communications.status('Pings are on.', { transient: true }); }).catch((e) => communications.status(failure(e).message)),
  onOpen: (href) => void invoke('open_pulse', { path: href }), onSwitch: () => void signOut(), onResize: fit,
  isVisible: () => state.panelVisible !== false && document.visibilityState === 'visible', store,
  tools: [
    { id: 'app', label: 'Open the Pulse window', icon: 'window', onClick: () => void invoke('open_app', { path: null }) },
    { id: 'settings', label: 'Settings', icon: 'settings', onClick: () => void invoke('open_settings', { section: null }) },
    { id: 'hide', label: 'Hide', icon: 'hide', onClick: () => void invoke('panel_hide') },
  ],
});
// Today: the day card, then late-mark protection, "your day" and the time wallet.
const panelHost = document.createElement('div'), featuresHost = document.createElement('div');
communications.todayHost.append(panelHost, featuresHost);
const features = mountFeatures(featuresHost, {
  call: (path, body) => state.demo ? demoCall(path, body) : invoke('companion_request', { path, body: body ?? null }).catch((e) => { throw failure(e); }),
  onOpen: (href) => void invoke('open_pulse', { path: href }),
});
const panel = mountPanel(panelHost, {
  onAction: (id) => void act(id),
  onMode: (mode) => { state.mode = mode; store.set('mode', mode); render(); },
  onOpen: (href) => void invoke('open_pulse', { path: href }),
  onTool: () => {},
});

const updateContext = () => ({ signedIn: !!state.session?.signedIn, demo: !!state.demo, busy: state.busy || state.installing, pending: state.queue.length > 0 || state.syncing, payload: state.payload });
const updates = new UpdateController({ check: () => invoke('update_check', { channel: store.get('updateChannel', 'test') }), prepare: () => invoke('update_prepare'), clock: () => now(), changed: () => updateUi() });
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
function card(title, text, live = true) {
  const node = Object.assign(document.createElement('section'), { className: 'pc pc-notice' });
  if (live) { node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); }
  node.append(Object.assign(document.createElement('h2'), { className: 'pc-title', textContent: title }), Object.assign(document.createElement('p'), { className: 'pc-sub', textContent: text }));
  return node;
}
function render() {
  if (state.session?.restoring) {
    root.replaceChildren(card('Opening your saved sign-in…', 'Your account stays protected on this computer. This takes a moment.'));
  } else if (state.screen === 'connect') {
    renderConnect(root, { ...state.connect, still: !state.prefs.mascot }, connectHandlers);
    const foot = document.createElement('div');
    foot.className = 'connect-foot';
    foot.append(Object.assign(document.createElement('span'), { textContent: new URL(state.session?.base ?? 'https://pulse.estateautopilots.com').host }));
    const settings = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Settings' });
    settings.addEventListener('click', () => void invoke('open_settings', { section: null }));
    foot.append(settings);
    root.append(foot);
    if (!state.prefs.mascot) root.querySelector('.pc-pip')?.remove();
  } else {
    const p = state.queue.length && state.payload ? projected(state.payload, state.queue) : state.payload;
    communications.attach();
    panel.reset();
    panel.render(deriveView(p, now(), { celebrate: state.celebrate }), {
      busy: state.busy || state.installing, status: state.status?.text ?? (state.demo ? 'Demo · nothing is saved' : state.queue.length ? `${state.queue.length} saved on this computer · will sync` : undefined),
      statusTone: state.status?.tone, mode: state.mode ?? p?.shift?.mode ?? 'office', showPip: state.prefs.mascot, openLabel: 'Open My desk',
    });
  }
  updateUi();
}
function updateUi() {
  root.querySelector('.pc-update')?.remove();
  const update = updates.offer(updateContext());
  if (update) {
    updateCard(root, { update, showPip: state.prefs.mascot, onInstall: () => void installUpdate(), onLater: () => { updates.later(); store.set('updateLater', updates.laterUntil); } });
    const announcement = `${store.get('updateChannel', 'test')}:${update.version}:${updates.laterUntil}`;
    if (store.get('updateAnnounced', '') !== announcement) { store.set('updateAnnounced', announcement); void invoke('panel_show').catch(() => {}); }
  }
  fit();
}
function tick() {
  if (state.screen !== 'day' || !state.payload) return;
  const p = state.queue.length ? projected(state.payload, state.queue) : state.payload;
  panel.tick(deriveView(p, now(), { celebrate: state.celebrate }));
}

// ---------------------------------------------------------------------------------------------------- data
async function refresh() {
  if (state.screen === 'connect' && !state.demo) return;
  try {
    state.syncing = true; updateUi();
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
  if (state.payload) void features.refresh(state.payload.state).then(fit);
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
  } finally { state.busy = false; render(); tray(); if (state.payload) void features.refresh(state.payload.state).then(fit); }
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
      const started = await invoke('companion_pair_start', { expectedPerson: store.get('expectedPerson', null), base: state.session?.base ?? 'https://pulse.estateautopilots.com/api/native/v0' });
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
  onOpenUrl() { if (state.connect.code) void invoke('open_in_browser', { path: `/connect?code=${state.connect.code}` }); },
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
  onDemo() { state.demo = demoClient('out'); state.screen = 'day'; communications.snapshot(demoSnapshot()); void refresh(); },
};
async function signedIn(session) {
  updates.reset();
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
  hidden() { state.panelVisible = false; },
  shown() { state.panelVisible = true; root.firstElementChild?.classList.remove('pc-enter'); void root.offsetWidth; root.firstElementChild?.classList.add('pc-enter'); void refresh(); void communications.refresh(); },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') void invoke('panel_hide'); });
const inboxTick = async () => {
  if (!state.session?.signedIn || state.demo) return;
  try {
    const s = await invoke('companion_ping_state');
    state.panelVisible = s.panelVisible;
    if (s.snapshot) { communications.snapshot(s.snapshot); if (s.snapshot.person?.id) store.set('expectedPerson', s.snapshot.person.id); }
    communications.pingIssue(s.pingIssue ?? null);
  } catch { /* native status unavailable */ }
};
async function boot() {
  try { state.info = await invoke('app_info'); } catch { /* defaults */ }
  const launch = state.info.launch ?? {};
  if (launch.theme) document.documentElement.dataset.theme = launch.theme;
  state.session = await invoke('companion_session');
  state.screen = state.session.signedIn ? 'day' : 'connect';
  if (!state.session.signedIn && state.session.notice) state.connect = { phase: 'start', message: state.session.notice };
  render();
  // A rendered, protected session-loading screen is healthy while saved credentials are restored.
  await invoke('update_healthy').catch(() => {});
  // Timers start before any network call, so one slow or failing request can never stop the clock or pings.
  setInterval(tick, 1000);
  setInterval(() => void inboxTick(), 2500);
  setInterval(() => { tray(); remind(); }, 30000);
  setInterval(() => void refresh(), 120000);
  setInterval(() => { void updates.poll(updateContext()); updateUi(); }, 60000);
  void listen('pulse:open-conversation', ({ payload }) => {
    state.screen = state.session?.signedIn ? 'day' : 'connect'; if (payload.error && !state.session?.signedIn) state.connect = { phase: 'start', message: payload.error };
    render(); if (payload.channelId) communications.open(payload.channelId, payload.href); else if (payload.notificationId) communications.showInbox(); if (payload.error) communications.status(payload.error);
  });
  void listen('pulse:prefs', () => { state.prefs = prefsWith(store.get('prefs', {})); applyTheme(); panel.reset(); render(); });
  void listen('pulse:signed-in', async () => { const s = await invoke('companion_session'); if (s.signedIn && !state.session?.signedIn) await signedIn(s); });
  void listen('pulse:signed-out', async () => { state.session = await invoke('companion_session'); if (!state.session.signedIn) { state.payload = null; state.screen = 'connect'; render(); tray(); } });
  void listen('pulse:presence', () => void refresh());
  void listen('pulse:install-update', () => void installUpdate());
  void listen('pulse:check-updates', () => void updates.poll(updateContext(), true));
  if (state.session.restoring) void finishSessionRestore();
  // --demo (runner screenshots, demos): synthetic day, inbox and chats on a chosen tab.
  if (launch.demo) {
    state.demo = demoClient('in'); state.screen = 'day'; state.panelVisible = true;
    communications.snapshot(demoSnapshot());
    await refresh();
    if (launch.tab === 'inbox') communications.showInbox();
    else if (launch.tab === 'chats') communications.showChats();
    else if (launch.tab === 'conversation') communications.open(DEMO_CONVERSATION);
    return;
  }
  void inboxTick();
  await refresh();
  void updates.poll(updateContext());
}

async function finishSessionRestore() {
  try {
    const session = await invoke('companion_session');
    if (!state.session?.restoring) return;
    if (session.restoring) { setTimeout(() => void finishSessionRestore(), 1000); return; }
    // A demo started meanwhile keeps its screen; the restored (signed-out) session only replaces the session.
    if (state.demo) { state.session = session; return; }
    updates.reset(); updates.laterUntil = store.get('updateLater', 0);
    state.session = session; state.screen = session.signedIn ? 'day' : 'connect';
    if (!session.signedIn && session.notice) state.connect = { phase: 'start', message: session.notice };
    render(); await refresh(); void updates.poll(updateContext());
  } catch { if (state.session?.restoring) setTimeout(() => void finishSessionRestore(), 1000); }
}
void boot();
