// Pip, the Pulse bot (UX-NOTIFY, 10 Oct 2026): one soft pebble, two eyes and the live point that floats beside it
// (the same dot as the one in the Pulse logo). A few shapes, so it animates smoothly and reads at 20 px.
// One geometry for every surface: web, desktop and Chrome render the SVG string; the phone app's widget uses the
// still, inline-coloured version. Moods are pure CSS on the web side, so reduced motion turns them into still poses.

// The seven states the island and the panels use, then the day's moods the check-in surfaces already ask for.
export const PIP_MOODS = ['idle', 'listening', 'thinking', 'new-message', 'happy', 'concerned', 'sleeping', 'waking', 'in', 'break', 'done', 'celebrate', 'sleepy'];

export const PIP_LABELS = {
  idle: 'Pip, the Pulse bot, waiting for you',
  listening: 'Pip, the Pulse bot, listening',
  thinking: 'Pip, the Pulse bot, thinking',
  'new-message': 'Pip, the Pulse bot, with something new for you',
  happy: 'Pip, the Pulse bot, happy it is done',
  concerned: 'Pip, the Pulse bot, concerned: something needs a look',
  sleeping: 'Pip, the Pulse bot, asleep for the night',
  waking: 'Pip, the Pulse bot, waking up for the workday',
  in: 'Pip, the Pulse bot, happily working alongside you',
  break: 'Pip, the Pulse bot, enjoying a cup of tea on your break',
  done: 'Pip, the Pulse bot, waving goodbye for the day',
  celebrate: 'Pip, the Pulse bot, celebrating with confetti',
  sleepy: 'Pip, the Pulse bot, sleeping',
};

/** The live point's colour per mood: the "pulse" in Pulse. */
export const PIP_BULB = { idle: '#c9c2ff', listening: '#8ff0d2', thinking: '#c9c2ff', 'new-message': '#ff7a59', happy: '#3ddc97', concerned: '#ffb547', sleeping: '#77749a',
  waking: '#ffd38a', in: '#3ddc97', break: '#ffc35c', done: '#b9adff', celebrate: '#ffd34d', sleepy: '#77749a' };

export const PIP_COLORS = {
  light: { bodyA: '#8f7dff', bodyB: '#5b45d6', eye: '#ffffff', mouth: '#ffffff', cheek: '#ffb0c8', shine: '#ffffff', shadow: 'rgba(24,20,60,.14)', cup: '#ffffff', cupLine: '#4a35c0', steam: '#9b98b8', z: '#7a68e6', brow: '#ffffff' },
  dark: { bodyA: '#a596ff', bodyB: '#6a55e6', eye: '#ffffff', mouth: '#ffffff', cheek: '#ffb0c8', shine: '#ffffff', shadow: 'rgba(0,0,0,.45)', cup: '#eeeef6', cupLine: '#a99cff', steam: '#8d8aa8', z: '#b8adff', brow: '#ffffff' },
};

/** Which face Pip makes in each mood. */
export function pipFace(mood) {
  const m = PIP_MOODS.includes(mood) ? mood : 'idle';
  const happy = m === 'happy' || m === 'done';
  return {
    eyes: happy ? 'happy' : m === 'break' || m === 'sleepy' || m === 'sleeping' ? 'closed' : m === 'celebrate' ? 'star' : 'open',
    mouth: m === 'waking' || m === 'celebrate' || m === 'new-message' ? 'o' : m === 'sleepy' || m === 'sleeping' ? 'none' : m === 'concerned' ? 'wobble' : happy ? 'grin' : m === 'thinking' ? 'flat' : 'smile',
    cheeks: m !== 'sleepy' && m !== 'sleeping' && m !== 'concerned' && m !== 'thinking', brows: m === 'concerned',
    cup: m === 'break', zzz: m === 'sleepy' || m === 'sleeping', confetti: m === 'celebrate', wave: m === 'done',
    dots: m === 'thinking', rings: m === 'listening' || m === 'new-message', bulb: PIP_BULB[m],
  };
}

// Geometry (viewBox 0 0 120 120).
export const PIP_PATHS = {
  body: 'M60 22C88 22 102 38 102 62C102 88 86 100 60 100S18 88 18 62C18 38 32 22 60 22Z',
  shine: 'M33 47c1-9 8-15 16-16',
  eyesHappy: ['M42 57q5.5-8 11 0', 'M67 57q5.5-8 11 0'],
  eyesClosed: ['M42 54q5.5 5 11 0', 'M67 54q5.5 5 11 0'],
  brows: ['M41 43l11-3', 'M79 43l-11-3'],
  star: 'M0-7l2 4.4 4.7.6-3.4 3.2.9 4.7L0 3.6l-4.2 2.3.9-4.7-3.4-3.2L-2-2.6z',
  smile: 'M54 67q6 5 12 0',
  grin: 'M52 65q8 9 16 0',
  flat: 'M55 68h10',
  wobble: 'M53 69q3.5-3 7 0t7 0',
  cup: 'M92 77h15v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-7-7z',
  cupHandle: 'M107 80h2a3 3 0 0 1 0 6h-2',
  steam: ['M97 73q-2.5-4 0-7.5t0-7.5', 'M103 73q-2.5-4 0-7.5t0-7.5'],
  z: 'M0 0h6l-6 7h6',
  confetti: [[18, 22, '#ffd34d'], [100, 8, '#3ddc97'], [8, 60, '#ff8fb1'], [110, 50, '#8ff0d2'], [24, 104, '#a99cff'], [98, 104, '#ffc35c'], [56, 4, '#ff8fb1'], [6, 34, '#8ff0d2']],
};
const POINT = { cx: 98, cy: 22, r: 5.5 };

let counter = 0;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The SVG markup for Pip. Static, built only from constants and the escaped label, so it is safe for innerHTML.
 * size: CSS pixels; still: no motion (the person turned animations down, or a screenshot).
 */
export function pipSvg({ mood = 'idle', size = 72, label, still = false, uid } = {}) {
  const m = PIP_MOODS.includes(mood) ? mood : 'idle';
  const id = uid ?? `pip${++counter}`;
  const f = pipFace(m);
  const P = PIP_PATHS;
  const eyes = f.eyes === 'open'
    ? '<g class="pip-eyes pip-blink"><rect x="42.5" y="46.5" width="10" height="15" rx="5"/><rect x="67.5" y="46.5" width="10" height="15" rx="5"/></g>'
    : f.eyes === 'star'
      ? `<g class="pip-eyes pip-stars"><path transform="translate(47.5 54)" d="${P.star}"/><path transform="translate(72.5 54)" d="${P.star}"/></g>`
      : `<g class="pip-eyes pip-lines"><path d="${(f.eyes === 'happy' ? P.eyesHappy : P.eyesClosed)[0]}"/><path d="${(f.eyes === 'happy' ? P.eyesHappy : P.eyesClosed)[1]}"/></g>`;
  const mouth = f.mouth === 'o' ? '<ellipse class="pip-mouth-o" cx="60" cy="69" rx="3.4" ry="3.8"/>' : f.mouth === 'none' ? '' : `<path class="pip-mouth" d="${P[f.mouth]}"/>`;
  const brows = f.brows ? `<g class="pip-brows"><path d="${P.brows[0]}"/><path d="${P.brows[1]}"/></g>` : '';
  const cheeks = f.cheeks ? '<circle class="pip-cheek" cx="36" cy="65" r="4"/><circle class="pip-cheek" cx="84" cy="65" r="4"/>' : '';
  const cup = f.cup ? `<g class="pip-cup"><path class="pip-steam" d="${P.steam[0]}"/><path class="pip-steam pip-late" d="${P.steam[1]}"/><path class="pip-mug" d="${P.cup}"/><path class="pip-handle" d="${P.cupHandle}"/></g>` : '';
  const hand = f.wave ? '<ellipse class="pip-hand pip-wave" cx="103" cy="68" rx="7" ry="8.5"/>' : '';
  // Each z sits in its own placed group, so the drift animation never replaces the placement.
  const zzz = f.zzz ? `<g class="pip-zzz"><g transform="translate(86 22)"><path d="${P.z}"/></g><g transform="translate(96 12) scale(.8)"><path class="pip-late" d="${P.z}"/></g><g transform="translate(104 3) scale(.6)"><path class="pip-later" d="${P.z}"/></g></g>` : '';
  const confetti = f.confetti ? `<g class="pip-confetti">${P.confetti.map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="5" height="5" rx="${i % 2 ? 2.5 : 1}" fill="${c}"/>`).join('')}</g>` : '';
  const dots = f.dots ? '<g class="pip-dots"><circle cx="84" cy="16" r="3.4"/><circle cx="95" cy="12" r="3.4"/><circle cx="106" cy="8" r="3.4"/></g>' : '';
  const rings = f.rings ? `<g class="pip-rings" fill="none" stroke="${f.bulb}"><circle cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}"/><circle class="pip-late" cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}"/></g>` : '';
  const point = f.dots || f.zzz ? '' : `<circle class="pip-glow" cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}" fill="${f.bulb}"/><circle class="pip-bulb" cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}" fill="${f.bulb}"/>`;
  return `<svg class="pip${still ? ' pip-still' : ''}" data-mood="${m}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(label ?? PIP_LABELS[m])}" focusable="false" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1"><stop class="pip-stop-a" offset="0"/><stop class="pip-stop-b" offset="1"/></linearGradient></defs>`
    + '<ellipse class="pip-shadow" cx="60" cy="110" rx="26" ry="4.5"/>'
    + `<g class="pip-bob">${hand}<path class="pip-head" d="${P.body}" fill="url(#${id}-b)"/><path class="pip-shine" d="${P.shine}"/>`
    + eyes + brows + mouth + cheeks + cup + '</g>' + rings + point + dots + zzz + confetti + '</svg>';
}

/**
 * Pip with every colour written into the markup (no stylesheet): for the phone app's widget and the icon scripts.
 * Still pose; the host animates the whole image if it wants to.
 */
export function pipStaticSvg({ mood = 'idle', theme = 'light', size = 72, blink = false } = {}) {
  const m = PIP_MOODS.includes(mood) ? mood : 'idle';
  const c = PIP_COLORS[theme === 'dark' ? 'dark' : 'light'];
  const f = pipFace(m);
  const P = PIP_PATHS;
  const line = (d, col = c.eye) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const eyes = blink || f.eyes === 'closed' ? P.eyesClosed.map((d) => line(d)).join('')
    : f.eyes === 'happy' ? P.eyesHappy.map((d) => line(d)).join('')
      : f.eyes === 'star' ? `<path transform="translate(47.5 54)" d="${P.star}" fill="${c.eye}"/><path transform="translate(72.5 54)" d="${P.star}" fill="${c.eye}"/>`
        : `<rect x="42.5" y="46.5" width="10" height="15" rx="5" fill="${c.eye}"/><rect x="67.5" y="46.5" width="10" height="15" rx="5" fill="${c.eye}"/>`;
  const mouth = f.mouth === 'o' ? `<ellipse cx="60" cy="69" rx="3.4" ry="3.8" fill="${c.mouth}"/>` : f.mouth === 'none' ? '' : line(P[f.mouth], c.mouth);
  const brows = f.brows ? P.brows.map((d) => line(d, c.brow)).join('') : '';
  const cheeks = f.cheeks ? `<circle cx="36" cy="65" r="4" fill="${c.cheek}" fill-opacity=".6"/><circle cx="84" cy="65" r="4" fill="${c.cheek}" fill-opacity=".6"/>` : '';
  const cup = f.cup ? `<path d="${P.steam[0]}" fill="none" stroke="${c.steam}" stroke-width="2" stroke-linecap="round" stroke-opacity=".7"/><path d="${P.steam[1]}" fill="none" stroke="${c.steam}" stroke-width="2" stroke-linecap="round" stroke-opacity=".7"/><path d="${P.cup}" fill="${c.cup}" stroke="${c.cupLine}" stroke-width="2"/><path d="${P.cupHandle}" fill="none" stroke="${c.cupLine}" stroke-width="2.2" stroke-linecap="round"/>` : '';
  const zzz = f.zzz ? `<g fill="none" stroke="${c.z}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path transform="translate(86 22)" d="${P.z}"/><path transform="translate(96 12) scale(.8)" d="${P.z}"/><path transform="translate(104 3) scale(.6)" d="${P.z}"/></g>` : '';
  const confetti = f.confetti ? P.confetti.map(([x, y, col], i) => `<rect x="${x}" y="${y}" width="5" height="5" rx="${i % 2 ? 2.5 : 1}" fill="${col}"/>`).join('') : '';
  const dots = f.dots ? `<g fill="${c.bodyA}"><circle cx="84" cy="16" r="3.4"/><circle cx="95" cy="12" r="3.4" fill-opacity=".75"/><circle cx="106" cy="8" r="3.4" fill-opacity=".5"/></g>` : '';
  const point = f.dots || f.zzz ? '' : `<circle cx="${POINT.cx}" cy="${POINT.cy}" r="${POINT.r}" fill="${f.bulb}"/>`;
  const hand = f.wave ? `<ellipse cx="103" cy="68" rx="7" ry="8.5" fill="${c.bodyB}" transform="rotate(-30 100 76)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}">`
    + `<defs><linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bodyA}"/><stop offset="1" stop-color="${c.bodyB}"/></linearGradient></defs>`
    + `<ellipse cx="60" cy="110" rx="26" ry="4.5" fill="${c.shadow}"/>${hand}`
    + `<path d="${P.body}" fill="url(#pb)"/><path d="${P.shine}" fill="none" stroke="${c.shine}" stroke-opacity=".45" stroke-width="3.6" stroke-linecap="round"/>`
    + eyes + brows + mouth + cheeks + cup + point + dots + zzz + confetti + '</svg>';
}
