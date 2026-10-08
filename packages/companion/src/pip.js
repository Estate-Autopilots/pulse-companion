// Pip, the Pulse bot: a small friendly companion drawn from a few SVG shapes (about 3 KB with its CSS).
// One geometry for every surface: web, desktop and Chrome render the SVG string; the phone app draws the same
// shapes with react-native-svg. Moods are pure CSS on the web side, so reduced-motion turns them into still poses.

export const PIP_MOODS = ['idle', 'waking', 'in', 'break', 'done', 'celebrate', 'sleepy'];

export const PIP_LABELS = {
  idle: 'Pip, the Pulse bot, waiting for you',
  waking: 'Pip, the Pulse bot, waking up for the workday',
  in: 'Pip, the Pulse bot, happily working alongside you',
  break: 'Pip, the Pulse bot, enjoying a cup of tea on your break',
  done: 'Pip, the Pulse bot, waving goodbye for the day',
  celebrate: 'Pip, the Pulse bot, celebrating with confetti',
  sleepy: 'Pip, the Pulse bot, sleeping',
};

/** Antenna light per mood: the "pulse" in Pulse. */
export const PIP_BULB = { idle: '#c9c2ff', waking: '#ffd38a', in: '#3ddc97', break: '#ffc35c', done: '#b9adff', celebrate: '#ffd34d', sleepy: '#77749a' };

export const PIP_COLORS = {
  light: { bodyA: '#8a76f5', bodyB: '#5b45d6', arm: '#4a35c0', face: '#1d1842', eye: '#8ff0d2', mouth: '#8ff0d2', cheek: '#ff8fb1', shadow: 'rgba(24,20,60,.16)', cup: '#ffffff', cupLine: '#4a35c0', steam: '#9b98b8', z: '#7a68e6' },
  dark: { bodyA: '#9d8cff', bodyB: '#6a55e6', arm: '#5a46d4', face: '#100d26', eye: '#8ff0d2', mouth: '#8ff0d2', cheek: '#ff8fb1', shadow: 'rgba(0,0,0,.45)', cup: '#eeeef6', cupLine: '#a99cff', steam: '#8d8aa8', z: '#b8adff' },
};

/** Which face Pip makes in each mood. */
export function pipFace(mood) {
  const m = PIP_MOODS.includes(mood) ? mood : 'idle';
  return {
    eyes: m === 'done' ? 'happy' : m === 'break' || m === 'sleepy' ? 'closed' : m === 'celebrate' ? 'star' : 'open',
    mouth: m === 'waking' || m === 'celebrate' ? 'o' : m === 'sleepy' ? 'flat' : 'smile',
    cheeks: m !== 'sleepy', cup: m === 'break', zzz: m === 'sleepy', confetti: m === 'celebrate', wave: m === 'done', bulb: PIP_BULB[m],
  };
}

// Geometry (viewBox 0 0 120 120).
export const PIP_PATHS = {
  stalk: 'M60 26V14',
  eyesHappy: ['M42 57q5.5-8 11 0', 'M67 57q5.5-8 11 0'],
  eyesClosed: ['M42 54q5.5 5 11 0', 'M67 54q5.5 5 11 0'],
  star: 'M0-7l2 4.4 4.7.6-3.4 3.2.9 4.7L0 3.6l-4.2 2.3.9-4.7-3.4-3.2L-2-2.6z',
  smile: 'M53 66q7 6 14 0',
  flat: 'M55 67h10',
  cup: 'M92 77h15v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-7-7z',
  cupHandle: 'M107 80h2a3 3 0 0 1 0 6h-2',
  steam: ['M97 73q-2.5-4 0-7.5t0-7.5', 'M103 73q-2.5-4 0-7.5t0-7.5'],
  z: 'M0 0h6l-6 7h6',
  confetti: [[18, 22, '#ffd34d'], [100, 18, '#3ddc97'], [10, 60, '#ff8fb1'], [110, 56, '#8ff0d2'], [26, 100, '#a99cff'], [96, 100, '#ffc35c'], [60, 2, '#ff8fb1'], [4, 34, '#8ff0d2']],
};

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
    ? '<g class="pip-eyes pip-blink"><rect x="43" y="47" width="9" height="13" rx="4.5"/><rect x="68" y="47" width="9" height="13" rx="4.5"/></g>'
    : f.eyes === 'star'
      ? `<g class="pip-eyes pip-stars"><path transform="translate(47.5 53)" d="${P.star}"/><path transform="translate(72.5 53)" d="${P.star}"/></g>`
      : `<g class="pip-eyes pip-lines"><path d="${(f.eyes === 'happy' ? P.eyesHappy : P.eyesClosed)[0]}"/><path d="${(f.eyes === 'happy' ? P.eyesHappy : P.eyesClosed)[1]}"/></g>`;
  const mouth = f.mouth === 'o' ? '<ellipse class="pip-mouth-o" cx="60" cy="67.5" rx="3.2" ry="3.6"/>' : `<path class="pip-mouth" d="${f.mouth === 'flat' ? P.flat : P.smile}"/>`;
  const cheeks = f.cheeks ? '<circle class="pip-cheek" cx="37.5" cy="64" r="3.6"/><circle class="pip-cheek" cx="82.5" cy="64" r="3.6"/>' : '';
  const cup = f.cup ? `<g class="pip-cup"><path class="pip-steam" d="${P.steam[0]}"/><path class="pip-steam pip-late" d="${P.steam[1]}"/><path class="pip-mug" d="${P.cup}"/><path class="pip-handle" d="${P.cupHandle}"/></g>` : '';
  const zzz = f.zzz ? `<g class="pip-zzz"><path transform="translate(86 30)" d="${P.z}"/><path class="pip-late" transform="translate(95 19) scale(.8)" d="${P.z}"/><path class="pip-later" transform="translate(102 10) scale(.6)" d="${P.z}"/></g>` : '';
  const confetti = f.confetti ? `<g class="pip-confetti">${P.confetti.map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="5" height="5" rx="${i % 2 ? 2.5 : 1}" fill="${c}"/>`).join('')}</g>` : '';
  return `<svg class="pip${still ? ' pip-still' : ''}" data-mood="${m}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(label ?? PIP_LABELS[m])}" focusable="false" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><linearGradient id="${id}-b" x1="0" y1="0" x2="1" y2="1"><stop class="pip-stop-a" offset="0"/><stop class="pip-stop-b" offset="1"/></linearGradient></defs>`
    + '<ellipse class="pip-shadow" cx="60" cy="111" rx="24" ry="4.5"/>'
    + `<g class="pip-bob"><g class="pip-antenna"><path class="pip-stalk" d="${P.stalk}"/><circle class="pip-glow" cx="60" cy="10" r="5" fill="${f.bulb}"/><circle class="pip-bulb" cx="60" cy="10" r="5" fill="${f.bulb}"/></g>`
    + `<ellipse class="pip-arm pip-arm-l" cx="20" cy="68" rx="6" ry="9"/><ellipse class="pip-arm pip-arm-r${f.wave ? ' pip-wave' : ''}" cx="100" cy="68" rx="6" ry="9"/>`
    + `<rect class="pip-head" x="22" y="25" width="76" height="66" rx="28" fill="url(#${id}-b)"/><rect class="pip-face" x="31" y="36" width="58" height="42" rx="18"/>`
    + eyes + mouth + cheeks + cup + '</g>' + zzz + confetti + '</svg>';
}

/**
 * Pip with every colour written into the markup (no stylesheet): for the phone app (react-native-svg's SvgXml)
 * and the Android home-screen widget. Still pose; the host animates the whole image if it wants to.
 */
export function pipStaticSvg({ mood = 'idle', theme = 'light', size = 72, blink = false } = {}) {
  const m = PIP_MOODS.includes(mood) ? mood : 'idle';
  const c = PIP_COLORS[theme === 'dark' ? 'dark' : 'light'];
  const f = pipFace(m);
  const P = PIP_PATHS;
  const line = (d) => `<path d="${d}" fill="none" stroke="${c.eye}" stroke-width="3.4" stroke-linecap="round"/>`;
  const eyes = blink || f.eyes === 'closed' ? P.eyesClosed.map(line).join('')
    : f.eyes === 'happy' ? P.eyesHappy.map(line).join('')
      : f.eyes === 'star' ? `<path transform="translate(47.5 53)" d="${P.star}" fill="${c.eye}"/><path transform="translate(72.5 53)" d="${P.star}" fill="${c.eye}"/>`
        : `<rect x="43" y="47" width="9" height="13" rx="4.5" fill="${c.eye}"/><rect x="68" y="47" width="9" height="13" rx="4.5" fill="${c.eye}"/>`;
  const mouth = f.mouth === 'o' ? `<ellipse cx="60" cy="67.5" rx="3.2" ry="3.6" fill="${c.mouth}"/>` : line(f.mouth === 'flat' ? P.flat : P.smile);
  const cheeks = f.cheeks ? `<circle cx="37.5" cy="64" r="3.6" fill="${c.cheek}" fill-opacity=".55"/><circle cx="82.5" cy="64" r="3.6" fill="${c.cheek}" fill-opacity=".55"/>` : '';
  const cup = f.cup ? `<path d="${P.steam[0]}" fill="none" stroke="${c.steam}" stroke-width="2" stroke-linecap="round" stroke-opacity=".7"/><path d="${P.steam[1]}" fill="none" stroke="${c.steam}" stroke-width="2" stroke-linecap="round" stroke-opacity=".7"/><path d="${P.cup}" fill="${c.cup}" stroke="${c.cupLine}" stroke-width="2"/><path d="${P.cupHandle}" fill="none" stroke="${c.cupLine}" stroke-width="2.2" stroke-linecap="round"/>` : '';
  const zzz = f.zzz ? `<g fill="none" stroke="${c.z}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path transform="translate(86 30)" d="${P.z}"/><path transform="translate(95 19) scale(.8)" d="${P.z}"/><path transform="translate(102 10) scale(.6)" d="${P.z}"/></g>` : '';
  const confetti = f.confetti ? P.confetti.map(([x, y, col], i) => `<rect x="${x}" y="${y}" width="5" height="5" rx="${i % 2 ? 2.5 : 1}" fill="${col}"/>`).join('') : '';
  const arm = f.wave ? `<ellipse cx="100" cy="68" rx="6" ry="9" fill="${c.arm}" transform="rotate(-35 100 60)"/>` : `<ellipse cx="100" cy="68" rx="6" ry="9" fill="${c.arm}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="${size}" height="${size}">`
    + `<defs><linearGradient id="pb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bodyA}"/><stop offset="1" stop-color="${c.bodyB}"/></linearGradient></defs>`
    + `<ellipse cx="60" cy="111" rx="24" ry="4.5" fill="${c.shadow}"/>`
    + `<path d="${P.stalk}" stroke="${c.arm}" stroke-width="3.5" stroke-linecap="round"/><circle cx="60" cy="10" r="5" fill="${f.bulb}"/>`
    + `<ellipse cx="20" cy="68" rx="6" ry="9" fill="${c.arm}"/>${arm}`
    + `<rect x="22" y="25" width="76" height="66" rx="28" fill="url(#pb)"/><rect x="31" y="36" width="58" height="42" rx="18" fill="${c.face}"/>`
    + eyes + mouth + cheeks + cup + zzz + confetti + '</svg>';
}
