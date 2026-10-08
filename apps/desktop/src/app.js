import { captureFocusTarget, restoreFocusTarget } from './accessibility.js';

const app = document.querySelector('#app');
const statusAnnouncer = document.querySelector('#status-announcer');
const setupKey = 'pulse-desktop-setup-v1';
const themeKey = 'pulse-desktop-theme';
const optionalKeys = ['commands', 'extraHours', 'breakReminders'];
let pauseRefreshTimer;
const state = {
  page: 'today',
  step: 1,
  status: { paused: false, connected: false, queuedEvents: 0 },
  setup: readSetup(),
};

function readSetup() {
  try { return JSON.parse(localStorage.getItem(setupKey)) ?? { done: false }; }
  catch { return { done: false }; }
}

function icon(name) {
  const paths = {
    today: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V4a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2.9Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
    moon: '<path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.5 8.5 0 1 0 20.9 13Z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    arrow: '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function stepBody() {
  const pages = [
    `<span class="eyebrow">A calmer way to get credit</span><h1>Pulse helps you get credit for your work.</h1><p>Pulse notices work evidence on this computer so you can see your day clearly and get feedback before work goes to a client.</p><p class="body-note">[Company] runs Pulse and is responsible for your data. <a href="./staff-notice.md" target="_blank" rel="noreferrer">Read the full staff notice ${icon('arrow')}</a></p>`,
    `<span class="eyebrow">What Pulse notices</span><h1>Only work signals that help explain your day.</h1><ul class="notice-list"><li><span class="list-mark">01</span><span><strong>Finished exports</strong><small>Name, length and a fingerprint to help match your work.</small></span></li><li><span class="list-mark">02</span><span><strong>Project changes</strong><small>Counts only, such as cuts, titles and effects. Never your footage or text.</small></span></li><li><span class="list-mark">03</span><span><strong>App time by type</strong><small>Private to you, shown by hour and category.</small></span></li></ul><p class="body-note">Work hours only. Pulse is not connected on this computer yet.</p>`,
    `<span class="eyebrow">What Pulse never does</span><h1>Your private screen stays private.</h1><ul class="plain-list"><li>No screenshots or screen recording</li><li>No camera, microphone or typing contents</li><li>No websites, chats or window titles</li><li>No collection from personal devices or outside work hours</li><li>No mood, emotion or stress detection</li></ul><div class="privacy-callout">${icon('shield')}<span><strong>You see your own details first.</strong><small>Your manager sees weekly work outcomes, never your app minutes, edit counts or command counts.</small></span></div>`,
    `<span class="eyebrow">Optional · off by default</span><h1>Choose what feels useful.</h1><p>Say no to any option. It never changes how your work is counted.</p><div class="toggle-list"><label class="toggle-row"><span><strong>Count my editing commands</strong><small>While Premiere Pro, After Effects or Photoshop is in front, Pulse counts editing commands by type, per hour. It never records letters, keys, words, passwords or messages; it is off in every other app. Only you see the counts. Counts are deleted within 7 days of switching off.</small></span><input type="checkbox" data-consent="commands" ${state.setup.preferences?.commands ? 'checked' : ''} aria-label="Allow editing command counts" /></label><label class="toggle-row"><span><strong>Count my extra hours</strong><small>Pulse may record the same hourly category totals outside working hours on this computer, so extra work is recognised and included in your workload view. Only you and (as a weekly band) your manager see it. Switch off at any time; past extra-hours data is then deleted within 7 days.</small></span><input type="checkbox" data-consent="extraHours" ${state.setup.preferences?.extraHours ? 'checked' : ''} aria-label="Allow extra-hours totals" /></label><label class="toggle-row"><span><strong>Break reminders</strong><small>Your computer can remind you to take a break after long stretches of work. This is calculated on your computer and never sent to anyone.</small></span><input type="checkbox" data-consent="breakReminders" ${state.setup.preferences?.breakReminders ? 'checked' : ''} aria-label="Allow local break reminders" /></label></div>`,
    `<span class="eyebrow">Connect when you’re ready</span><h1>Finish setup on your terms.</h1><p>Enrollment will connect Pulse to your work account and export folders. That connection is not available yet, so Pulse will stay quiet after setup.</p><div class="connect-placeholder"><span class="connect-icon">${icon('shield')}</span><span><strong>Connect your work account</strong><small>Enter an 8-character code and choose export folders after enrollment is enabled.</small></span><span class="pill">Coming soon</span></div><p class="body-note">You can pause any time from the tray icon. Nothing is collected until you finish this screen.</p>`,
  ];
  return pages[state.step - 1];
}

function renderSetup({ focusTarget = null, statusMessage = '' } = {}) {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  app.innerHTML = `<main class="setup-shell"><aside class="setup-side"><a class="brand" href="#" aria-label="Pulse home"><span class="brand-mark">p</span><span>pulse</span></a><div class="setup-side-copy"><span class="eyebrow">Your work, in view</span><h2>Useful context.<br/>Your data, first.</h2><p>Pause whenever you need. Your work is never ranked.</p></div><div class="step-track" aria-label="Setup progress">${[1,2,3,4,5].map((n) => `<span class="${n <= state.step ? 'active' : ''}"></span>`).join('')}</div><small>Step ${state.step} of 5</small></aside><section class="setup-content"><div class="top-actions"><span class="quiet-label">Privacy-first setup</span><button class="icon-button" data-action="theme" aria-label="Switch to ${nextTheme} theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button></div><div class="setup-copy">${stepBody()}</div><div class="setup-actions">${state.step > 1 ? '<button class="button quiet" data-action="back">Back</button>' : '<span></span>'}<button class="button primary" data-action="${state.step === 5 ? 'finish' : 'next'}">${state.step === 5 ? 'Finish setup' : 'Continue'} ${icon('arrow')}</button></div><p class="acknowledgement">Acknowledging this notice is not agreeing to the optional features.</p></section></main>`;
  app.querySelector('h1')?.setAttribute('data-view-heading', '');
  app.querySelector('h1')?.setAttribute('tabindex', '-1');
  bindActions();
  restoreFocusTarget(app, focusTarget);
  if (statusMessage) announceStatus(statusMessage);
}

function renderDashboard({ focusTarget = null, statusMessage = '' } = {}) {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  const paused = state.status.paused;
  const connected = state.status.connected;
  app.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#" aria-label="Pulse home"><span class="brand-mark">p</span><span>pulse</span></a><div class="workspace"><span class="workspace-avatar">P</span><span><strong>My workspace</strong><small>On this computer</small></span><span class="chevron">⌄</span></div><nav aria-label="Main navigation"><button class="nav-item ${state.page === 'today' ? 'selected' : ''}" data-action="today">${icon('today')}<span>Today</span></button><button class="nav-item ${state.page === 'settings' ? 'selected' : ''}" data-action="settings">${icon('settings')}<span>Preferences</span></button></nav><div class="sidebar-footer"><div class="privacy-mini">${icon('shield')}<span><strong>Your details stay yours</strong><small>Private by default</small></span></div><span class="version-label">Pulse desktop · preview</span></div></aside><main class="main-panel"><header class="topbar"><div class="crumb">My workspace <span>/</span> <strong>${state.page === 'today' ? 'Today' : 'Preferences'}</strong></div><div class="topbar-actions"><span class="device-pill"><span class="status-dot ${paused ? 'muted' : ''}"></span>${paused ? 'Paused' : connected ? 'Connected' : 'Not connected'}</span><button class="icon-button" data-action="theme" aria-label="Switch to ${nextTheme} theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button></div></header>${state.page === 'today' ? todayPage() : settingsPage()}</main></div>`;
  app.querySelector('h1')?.setAttribute('data-view-heading', '');
  app.querySelector('h1')?.setAttribute('tabindex', '-1');
  bindActions();
  restoreFocusTarget(app, focusTarget);
  if (statusMessage) announceStatus(statusMessage);
}

function todayPage() {
  const paused = state.status.paused;
  return `<section class="page-content"><div class="page-heading"><div><span class="eyebrow">${new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} <span>·</span> On this computer</span><h1>What Pulse saw today</h1><p>Your work signals, in one private view.</p></div><button class="button ${paused ? 'quiet' : 'outline'} pause-button" data-action="pause">${icon(paused ? 'play' : 'pause')}${paused ? 'Resume agent' : 'Pause agent'}</button></div><div class="status-banner ${paused ? 'paused' : ''}"><span class="status-icon">${icon(paused ? 'pause' : 'shield')}</span><span><strong>${paused ? 'Pulse is paused' : 'Pulse is not connected yet'}</strong><small>${paused ? 'No collection will happen until you resume.' : 'Setup is complete. Connect your work account when enrollment is available; nothing is being collected now.'}</small></span><span class="banner-tag">${paused ? 'On this device' : 'Waiting for connection'}</span></div><div class="section-title"><div><h2>Your timeline</h2><p>Only you can see these details.</p></div><span class="privacy-tag">Private to you</span></div><section class="timeline-card"><div class="timeline-axis"><span>Today</span><span>Work hours</span></div><div class="empty-timeline"><div class="empty-mark"><span></span><span></span><span></span></div><h3>Nothing to show just yet</h3><p>When your account is connected, exports and project changes will appear here. Pulse won’t turn missing data into zero work.</p><button class="text-button" data-action="settings">Review privacy settings ${icon('arrow')}</button></div><div class="timeline-footer"><span><i class="queue-dot"></i> ${state.status.queuedEvents} items waiting to send</span><button class="text-button subdued" data-action="raw" disabled>Show raw</button></div></section><div class="bottom-grid"><article class="support-card"><span class="card-icon">${icon('shield')}</span><div><strong>No screenshots. No typing. No window titles.</strong><p>Your day stays private, and you can pause at any time.</p></div><a href="./staff-notice.md" target="_blank" rel="noreferrer" aria-label="Read privacy notice">${icon('arrow')}</a></article><article class="support-card connected-card"><span class="card-icon blue">${icon('today')}</span><div><strong>Enrollment is not available yet</strong><p>Your setup choices are saved on this computer only.</p></div><span class="pill">Not connected</span></article></div></section>`;
}

function settingsPage() {
  const preferences = state.setup.preferences ?? {};
  return `<section class="page-content settings-content"><div class="page-heading"><div><span class="eyebrow">Your choices</span><h1>Preferences</h1><p>Optional features are off unless you switch them on.</p></div><button class="button ${state.status.paused ? 'quiet' : 'outline'}" data-action="pause">${icon(state.status.paused ? 'play' : 'pause')}${state.status.paused ? 'Resume agent' : 'Pause agent'}</button></div><section class="settings-card"><div class="settings-heading"><span class="card-icon">${icon('shield')}</span><div><h2>Optional signals</h2><p>Your choices stay on this computer while enrollment is unavailable.</p></div></div><label class="toggle-row"><span><strong>Count my editing commands</strong><small>Per-hour command categories in Premiere Pro, After Effects or Photoshop. No key contents. Only you see these counts.</small></span><input type="checkbox" data-consent="commands" ${preferences.commands ? 'checked' : ''} aria-label="Allow editing command counts" /></label><label class="toggle-row"><span><strong>Count my extra hours</strong><small>App-category totals outside working hours, so extra work is recognised.</small></span><input type="checkbox" data-consent="extraHours" ${preferences.extraHours ? 'checked' : ''} aria-label="Allow extra-hours totals" /></label><label class="toggle-row"><span><strong>Break reminders</strong><small>Calculated on this computer and never sent to anyone.</small></span><input type="checkbox" data-consent="breakReminders" ${preferences.breakReminders ? 'checked' : ''} aria-label="Allow local break reminders" /></label></section><section class="settings-card notice-card"><div><span class="eyebrow">Notice version</span><h2>2026-11-staff-v2</h2><p>Read the full notice that explains what Pulse notices, who can see it, and how long it is kept.</p></div><a class="button outline" href="./staff-notice.md" target="_blank" rel="noreferrer">Read notice ${icon('arrow')}</a></section><p class="local-note">Your optional-feature choices are stored locally. Enrollment and event uploads are not available in this build.</p></section>`;
}

function bindActions() {
  app.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    switch (button.dataset.action) {
      case 'theme': toggleTheme(); return;
      case 'next': if (state.step < 5) state.step += 1; renderSetup({ focusTarget: { kind: 'heading' } }); return;
      case 'back': if (state.step > 1) state.step -= 1; renderSetup({ focusTarget: { kind: 'heading' } }); return;
      case 'finish': finishSetup(); return;
      case 'today': state.page = 'today'; renderDashboard({ focusTarget: { kind: 'heading' } }); return;
      case 'settings': state.page = 'settings'; renderDashboard({ focusTarget: { kind: 'heading' } }); return;
      case 'pause': await togglePause(); renderDashboard({ focusTarget: { kind: 'data', key: 'action', value: 'pause' }, statusMessage: state.status.paused ? 'Pulse paused.' : 'Pulse resumed.' }); return;
      default: return;
    }
  }));
  app.querySelectorAll('[data-consent]').forEach((input) => input.addEventListener('change', () => savePreference(input.dataset.consent, input.checked)));
}

function savePreference(key, value) {
  state.setup.preferences = { ...(state.setup.preferences ?? {}), [key]: value };
  if (state.setup.done) {
    localStorage.setItem(setupKey, JSON.stringify(state.setup));
    void syncCollectionPolicy();
  }
}

async function syncCollectionPolicy() {
  if (!window.__TAURI__?.core?.invoke) return;
  try {
    await window.__TAURI__.core.invoke('set_collection_policy', {
      noticeAcknowledged: Boolean(state.setup.done),
      afterHoursConsented: Boolean(state.setup.preferences?.extraHours),
    });
  } catch { /* collection remains disabled if native policy cannot be updated */ }
}

async function finishSetup() {
  const preferences = Object.fromEntries(optionalKeys.map((key) => [key, Boolean(state.setup.preferences?.[key])]));
  state.setup = { ...state.setup, done: true, noticeVersion: '2026-11-staff-v2', acknowledgedAt: new Date().toISOString(), preferences };
  localStorage.setItem(setupKey, JSON.stringify(state.setup));
  await syncCollectionPolicy();
  state.page = 'today';
  renderDashboard({ focusTarget: { kind: 'heading' } });
}

async function togglePause() {
  const next = state.status.paused ? 'resume' : 'until-resumed';
  if (window.__TAURI__?.core?.invoke) {
    try {
      state.status = await window.__TAURI__.core.invoke('set_pause', { period: next });
      schedulePauseRefresh();
      return;
    }
    catch { /* keep the local view responsive if the shell is restarting */ }
  }
  state.status = { ...state.status, paused: next !== 'resume' };
}

function schedulePauseRefresh() {
  window.clearTimeout(pauseRefreshTimer);
  const seconds = state.status.pauseExpiresInSeconds;
  if (!window.__TAURI__?.core?.invoke || !state.status.paused || !Number.isFinite(seconds)) return;
  pauseRefreshTimer = window.setTimeout(async () => {
    try { state.status = await window.__TAURI__.core.invoke('agent_status'); }
    catch { return; }
    const focusTarget = captureFocusTarget(app, document.activeElement);
    state.setup.done ? renderDashboard({ focusTarget }) : renderSetup({ focusTarget });
    schedulePauseRefresh();
  }, (seconds + 1) * 1000);
}

async function refreshStatus() {
  if (!window.__TAURI__?.core?.invoke) return;
  try { state.status = await window.__TAURI__.core.invoke('agent_status'); }
  catch { return; }
  schedulePauseRefresh();
  if (state.setup.done) renderDashboard({ focusTarget: captureFocusTarget(app, document.activeElement) });
}

function toggleTheme() {
  const focusTarget = captureFocusTarget(app, document.activeElement) ?? { kind: 'data', key: 'action', value: 'theme' };
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(themeKey, next);
  const statusMessage = `${next === 'dark' ? 'Dark' : 'Light'} theme.`;
  state.setup.done ? renderDashboard({ focusTarget, statusMessage }) : renderSetup({ focusTarget, statusMessage });
}

function announceStatus(message) {
  if (!statusAnnouncer) return;
  statusAnnouncer.textContent = '';
  window.requestAnimationFrame(() => { statusAnnouncer.textContent = message; });
}

async function init() {
  const savedTheme = localStorage.getItem(themeKey);
  document.documentElement.dataset.theme = savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  if (window.__TAURI__?.core?.invoke) {
    await syncCollectionPolicy();
    try { state.status = await window.__TAURI__.core.invoke('agent_status'); } catch { /* setup can still be read */ }
    schedulePauseRefresh();
    window.setInterval(refreshStatus, 30_000);
  }
  state.setup.done ? renderDashboard() : renderSetup();
}

init();
window.addEventListener('focus', refreshStatus);
