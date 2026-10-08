import { pipSvg } from './pip.js';
export function updateCard(root, { update, installLabel = 'Install and restart', onInstall, onLater, busy = false, hint = '' }) {
  const card = document.createElement('section'); card.className = 'pc-update'; card.setAttribute('aria-label', 'Pulse update');
  const pip = document.createElement('div'); pip.innerHTML = pipSvg({ mood: 'waking', size: 44, still: true });
  const text = document.createElement('p'); text.textContent = `A new Pulse is ready — what's new: ${update.notes}`;
  card.append(pip, text);
  if (hint) card.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: hint }));
  for (const [label, handler] of [[installLabel, onInstall], ['Later', onLater]]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'pc-btn', textContent: label, disabled: busy });
    b.addEventListener('click', handler); card.append(b);
  }
  root.append(card);
}
