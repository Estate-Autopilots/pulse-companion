// The Pulse window's own screens, shown before the Pulse web app takes over: connect this computer, opening a
// saved sign-in, offline, or a problem signing the window in. Once signed in, Rust loads Pulse itself.
import { renderConnect } from './companion/panel.js';
import { pipSvg } from './companion/pip.js';
import { applyTheme, store } from './prefs.js';

const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const root = document.getElementById('app');
const failure = (e) => { try { return JSON.parse(String(e?.message ?? e)); } catch { return { message: String(e?.message ?? e ?? 'Something went wrong') }; } };
let connect = { phase: 'start' }, pollTimer = null, retryTimer = null, current = '';
applyTheme();

function screen({ mood, title, text, actions = [], live = 'polite' }) {
  const card = Object.assign(document.createElement('section'), { className: 'pc app-card' });
  card.setAttribute('role', 'status'); card.setAttribute('aria-live', live);
  const pip = document.createElement('div'); pip.className = 'pc-pip app-pip'; pip.innerHTML = pipSvg({ mood, size: 120, uid: 'app' });
  const h = Object.assign(document.createElement('h1'), { className: 'pc-title app-title', textContent: title });
  const p = Object.assign(document.createElement('p'), { className: 'pc-sub app-text', textContent: text });
  const row = document.createElement('div'); row.className = 'pc-actions pc-stack';
  for (const [label, run, primary] of actions) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: `pc-btn${primary ? ' pc-primary' : ''}`, textContent: label });
    b.addEventListener('click', run); row.append(b);
  }
  card.append(pip, h, p);
  if (actions.length) card.append(row);
  root.replaceChildren(card);
  root.querySelector('.pc-primary')?.focus({ preventScroll: true });
}

function show(state, message) {
  current = state;
  clearInterval(retryTimer);
  if (state === 'restoring') screen({ mood: 'waking', title: 'Opening your saved sign-in…', text: 'Your account stays protected on this computer. This takes a moment.' });
  else if (state === 'offline') {
    screen({ mood: 'sleepy', title: 'You’re offline', text: 'Pulse opens as soon as this computer is back online. Check-ins you make in the quick panel are saved and sent later.', actions: [['Try again', () => go(), true]] });
    retryTimer = setInterval(() => go(), 15000);
  } else if (state === 'error') screen({ mood: 'idle', title: 'Pulse could not open here', text: message ?? 'Something went wrong while signing this window in.', actions: [['Try again', () => go(), true], ['Open in the browser', () => void invoke('open_in_browser', { path: '/me' })]], live: 'assertive' });
  else if (state === 'signed-out') signedOut(message);
  else screen({ mood: 'waking', title: 'Opening Pulse…', text: 'Just a moment.' });
}

function signedOut(message) {
  renderConnect(root, { ...connect, message: connect.message ?? message, still: false }, {
    onPair: pair,
    onCancel() { clearInterval(pollTimer); void invoke('companion_pair_cancel'); connect = { phase: 'start' }; signedOut(); },
    onOpenUrl() { if (connect.code) void invoke('open_in_browser', { path: `/connect?code=${connect.code}` }); },
  });
  const card = root.firstElementChild;
  card?.classList.add('app-card', 'app-connect');
  const title = card?.querySelector('.pc-title');
  if (title && connect.phase === 'start') title.textContent = 'Welcome to Pulse';
  const sub = card?.querySelector('.pc-sub');
  if (sub && connect.phase === 'start') sub.textContent = 'Your whole Pulse, in its own window: today, inbox, chats, leave and more. Sign in once with your Pulse account — you approve it in your browser, no password typed here.';
}

async function pair() {
  connect = { phase: 'start', busy: true, message: 'Opening Pulse in your browser…' }; signedOut();
  try {
    const started = await invoke('companion_pair_start', { expectedPerson: store.get('expectedPerson', null), base: 'https://pulse.estateautopilots.com/api/native/v0' });
    connect = { phase: 'code', code: started.code, message: 'Waiting for your approval…' }; signedOut();
    clearInterval(pollTimer);
    const deadline = Date.now() + (started.expiresIn ?? 600) * 1000;
    pollTimer = setInterval(async () => {
      if (Date.now() > deadline) { clearInterval(pollTimer); connect = { phase: 'error', message: 'The code expired. Start again when you’re ready.' }; signedOut(); return; }
      try {
        const r = await invoke('companion_pair_poll');
        if (r.status === 'approved') { clearInterval(pollTimer); connect = { phase: 'start' }; go(); }
        else if (r.status !== 'pending') { clearInterval(pollTimer); connect = { phase: 'error', message: r.status === 'denied' ? 'Not approved. Nothing was signed in.' : 'The code expired. Start again when you’re ready.' }; signedOut(); }
      } catch (e) { const f = failure(e); if (!f.offline) { clearInterval(pollTimer); connect = { phase: f.gate ? 'gate' : 'error', message: f.message }; signedOut(); } }
    }, Math.max(2, started.interval ?? 3) * 1000);
  } catch (e) { const f = failure(e); connect = { phase: f.gate ? 'gate' : 'error', message: f.message }; signedOut(); }
}

function go() { show('loading'); void invoke('app_window_go', { path: null }).catch(() => show('error')); }

async function boot() {
  const hash = location.hash.slice(1);
  const info = await invoke('app_info').catch(() => ({}));
  if (info.launch?.theme) document.documentElement.dataset.theme = info.launch.theme;
  try { window.__TAURI__.event?.listen('pulse:app-state', ({ payload }) => { if (payload.state !== current || payload.message) show(payload.state, payload.message); })?.catch?.(() => {}); } catch { /* events unavailable */ }
  try { window.__TAURI__.event?.listen('pulse:prefs', () => applyTheme())?.catch?.(() => {}); } catch { /* events unavailable */ }
  try { window.__TAURI__.event?.listen('pulse:signed-in', () => { if (current === 'signed-out') go(); })?.catch?.(() => {}); } catch { /* events unavailable */ }
  addEventListener('online', () => { if (current === 'offline') go(); });
  if (hash) { show(hash); return; }
  const s = await invoke('app_window_state').catch(() => ({ signedIn: false }));
  show(s.restoring ? 'restoring' : s.signedIn ? 'loading' : 'signed-out');
}
void boot();
