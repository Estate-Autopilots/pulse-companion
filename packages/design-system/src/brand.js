// Pulse brand masters (UX-NOTIFY, 10 Oct 2026). Every logo, favicon and app icon is drawn from these strings: the
// /brand page shows them, and the icon scripts (web, desktop, Android, iPhone, Chrome) rasterise them. Pure SVG
// built from constants only, so the markup is safe to inline.

export const BRAND = {
  iris: '#5b45d6', irisLight: '#7c5cff', irisDeep: '#4f37d0', lilac: '#b9adff', ink: '#17123a', paper: '#ffffff',
  canvas: '#f6f6fa', night: '#121219', live: '#3ddc97',
};

/** The chosen mark, "Pulse point": an open P whose bowl holds the live point (32 × 32 grid, 3.4 stroke). */
export const MARK = {
  stroke: 'M10 25.6V12.6a6 6 0 1 1 6 6h-1.4',
  point: { cx: 16, cy: 12.6, r: 2 },
  width: 3.4,
};

/** "Pulse" in Inter at weight 640, tracked −2 %, as outlines (units: 2048 per em; cap height 1490). */
export const WORDMARK = { d: 'M119 0V-1490H695Q861 -1490 982 -1431Q1102 -1373 1168 -1265Q1233 -1157 1233 -1009Q1233 -861 1166 -753Q1100 -645 978 -586Q856 -527 691 -527H273V-765H679Q765 -765 827 -795Q889 -825 923 -879Q956 -934 956 -1009Q956 -1084 923 -1138Q889 -1192 827 -1222Q765 -1251 679 -1251H401V0Z M1727 22Q1616 22 1532 -26Q1447 -75 1400 -168Q1353 -261 1353 -396V-1056H1622V-441Q1622 -329 1676 -271Q1730 -213 1828 -213Q1892 -213 1942 -239Q1992 -265 2020 -321Q2049 -376 2049 -463V-1056H2318V0H2053V-271H2103Q2052 -131 1960 -55Q1867 22 1727 22Z M2764 -1490V0H2495V-1490Z M3365 25Q3233 25 3129 -16Q3025 -57 2962 -136Q2900 -215 2891 -329H3156Q3165 -255 3217 -214Q3269 -173 3360 -173Q3448 -173 3498 -207Q3548 -241 3548 -294Q3548 -339 3511 -367Q3473 -395 3407 -408L3225 -445Q3073 -476 2994 -553Q2915 -630 2915 -751Q2915 -849 2968 -923Q3021 -997 3119 -1038Q3217 -1079 3349 -1079Q3481 -1079 3580 -1035Q3679 -992 3736 -913Q3792 -834 3795 -725H3544Q3543 -792 3491 -837Q3439 -882 3356 -882Q3276 -882 3230 -847Q3183 -811 3183 -760Q3183 -715 3219 -687Q3255 -659 3319 -645L3513 -606Q3671 -574 3746 -503Q3821 -432 3821 -316Q3821 -212 3763 -135Q3704 -59 3602 -17Q3499 25 3365 25Z M4419 24Q4260 24 4143 -47Q4026 -118 3962 -242Q3898 -367 3898 -527Q3898 -688 3963 -813Q4029 -938 4144 -1009Q4259 -1080 4408 -1080Q4524 -1080 4617 -1040Q4711 -1000 4779 -927Q4847 -854 4883 -753Q4920 -653 4920 -532V-459H4000V-638H4787L4666 -593Q4666 -678 4635 -740Q4604 -803 4548 -836Q4491 -870 4413 -870Q4336 -870 4279 -836Q4223 -803 4192 -740Q4161 -678 4161 -593V-475Q4161 -388 4192 -322Q4223 -257 4282 -220Q4342 -184 4426 -184Q4487 -184 4534 -202Q4581 -220 4613 -252Q4645 -285 4658 -329H4908Q4888 -225 4820 -145Q4751 -66 4648 -21Q4544 24 4419 24Z', box: [119, -1490, 4801, 1515] };

/** The three directions explored for the owner, in the order the /brand page shows them; `chosen` marks the pick. */
export const DIRECTIONS = [
  { id: 'heartline', name: 'Heartline', glyph: (c) => `<path d="M6 17.5h4.6l2.6-6.6 4.2 11.4 3-7.6 1.4 2.8H26" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    idea: 'The monitor trace refined: one even line, the beat off-centre.',
    verdict: 'Familiar and calm, but every health and fitness app owns this line, and below 24 px the spike turns into a squiggle.' },
  { id: 'point', name: 'Pulse point', chosen: true, glyph: (c) => markGlyph(c),
    idea: 'An open P whose bowl holds the live point: the letter of Pulse and the moment something happens.',
    verdict: 'Chosen. It is the only direction that says Pulse and pulse at once; three shapes hold at 16 px; the point is the same dot that sits beside Pip and on every presence avatar, so logo, bot and status read as one family; and the point can breathe in motion without the letter moving.' },
  { id: 'ping', name: 'Ping', glyph: (c) => `<circle cx="16" cy="16" r="3.6" fill="${c}"/><path d="M16 7.2A8.8 8.8 0 1 1 7.2 16" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    idea: 'A point and the ripple it sends out: a signal, a notification, someone arriving.',
    verdict: 'Clean and abstract, but at small sizes it reads as a loading spinner or a power button, and it says nothing about Pulse by name.' },
];

/** The chosen glyph in one colour (no tile): for mono, tray template and notification icons. */
export function markGlyph(color = BRAND.iris) {
  return `<path d="${MARK.stroke}" fill="none" stroke="${color}" stroke-width="${MARK.width}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${MARK.point.cx}" cy="${MARK.point.cy}" r="${MARK.point.r}" fill="${color}"/>`;
}

const tileFill = (id) => `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.irisLight}"/><stop offset="1" stop-color="${BRAND.irisDeep}"/></linearGradient></defs>`;

/**
 * The mark as an SVG document.
 * tile: on the iris squircle (colour, the default) or the bare glyph; color: glyph colour without a tile;
 * radius: tile corner (32 grid; 0 for full-bleed iPhone and maskable icons); scale: glyph size inside the tile;
 * direction: one of DIRECTIONS (the /brand page), the chosen one otherwise.
 */
export function markSvg({ size = 32, tile = true, color, radius = 9, scale = 1, direction = 'point', id = 'pulse-tile', title } = {}) {
  const dir = DIRECTIONS.find((d) => d.id === direction) ?? DIRECTIONS[1];
  const ink = color ?? (tile ? BRAND.paper : BRAND.iris);
  const glyph = scale === 1 ? dir.glyph(ink) : `<g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${dir.glyph(ink)}</g>`;
  const label = title ? `<title>${title.replace(/[<&]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}"${title ? ' role="img"' : ' aria-hidden="true"'}>${label}`
    + (tile ? `${tileFill(id)}<rect width="32" height="32" rx="${radius}" fill="url(#${id})"/>` : '') + glyph + '</svg>';
}

/** The wordmark alone, in one colour. height: CSS pixels of the cap height. */
export function wordmarkSvg({ height = 20, color = BRAND.ink } = {}) {
  const [x, y, w, h] = WORDMARK.box;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" height="${height * h / 1490}" width="${(height * w / 1490).toFixed(1)}" role="img"><title>Pulse</title><path d="${WORDMARK.d}" fill="${color}"/></svg>`;
}

/** Mark and wordmark side by side. theme: the background it sits on (the wordmark is ink or white). */
export function lockupSvg({ height = 32, theme = 'light', mono, id = 'pulse-lockup' } = {}) {
  const [x, y, w] = WORDMARK.box;
  const s = 20 / 1490, width = 42 + w * s;
  const word = mono ?? (theme === 'dark' ? BRAND.paper : BRAND.ink);
  const mark = mono ? markGlyph(mono) : `${tileFill(id)}<rect width="32" height="32" rx="9" fill="url(#${id})"/>${markGlyph(BRAND.paper)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} 32" height="${height}" width="${(height * width / 32).toFixed(1)}" role="img"><title>Pulse</title>${mark}`
    + `<path transform="translate(${(42 - x * s).toFixed(2)} ${(6 - y * s).toFixed(2)}) scale(${s.toFixed(6)})" d="${WORDMARK.d}" fill="${word}"/></svg>`;
}

/**
 * App icons, from one rule: the iris tile with the white mark at 62 % (Apple and Android keep the glyph inside
 * their safe zones). platform: 'ios' and 'maskable' are full-bleed squares (the system rounds them), 'mac' sits
 * inside the Big Sur grid with a soft shadow, anything else is the rounded tile edge to edge.
 */
export function appIconSvg({ size = 1024, platform = 'tile' } = {}) {
  const bleed = platform === 'ios' || platform === 'maskable';
  const glyph = `<g transform="translate(16 16) scale(${platform === 'maskable' ? 0.62 : 0.66}) translate(-16 -16.2)">${markGlyph(BRAND.paper)}</g>`;
  if (platform === 'mac') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${tileFill('app-tile')}<defs><filter id="app-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy=".35" stdDeviation=".45" flood-color="#1b1240" flood-opacity=".28"/></filter></defs><rect x="3.1" y="3.1" width="25.8" height="25.8" rx="5.8" fill="url(#app-tile)" filter="url(#app-shadow)"/><g transform="translate(16 16) scale(.8) translate(-16 -16)">${glyph}</g></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${tileFill('app-tile')}<rect width="32" height="32" rx="${bleed ? 0 : 7.2}" fill="url(#app-tile)"/>${glyph}</svg>`;
}
