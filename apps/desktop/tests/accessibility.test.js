import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureFocusTarget, restoreFocusTarget } from '../src/accessibility.js';

function node({ dataset = {}, attributes = {}, id = '', tagName = 'BUTTON' } = {}) {
  return {
    dataset,
    id,
    tagName,
    getAttribute(name) { return attributes[name] ?? null; },
    focus(options) { this.focusOptions = options; },
  };
}

function rootWith(...nodes) {
  return {
    contains(candidate) { return nodes.includes(candidate); },
    querySelectorAll() { return nodes; },
    querySelector(selector) {
      return selector === '[data-view-heading]'
        ? nodes.find((candidate) => candidate.dataset.viewHeading !== undefined) ?? null
        : null;
    },
  };
}

const oldThemeButton = node({ dataset: { action: 'theme' } });
const focusRoot = rootWith(oldThemeButton);
assert.deepEqual(captureFocusTarget(focusRoot, oldThemeButton), { kind: 'data', key: 'action', value: 'theme' });
assert.equal(captureFocusTarget(focusRoot, node()), null, 'controls outside the app are ignored');

const replacementThemeButton = node({ dataset: { action: 'theme' } });
const themeRoot = rootWith(replacementThemeButton);
assert.equal(restoreFocusTarget(themeRoot, { kind: 'data', key: 'action', value: 'theme' }), replacementThemeButton);
assert.deepEqual(replacementThemeButton.focusOptions, { preventScroll: true });

const heading = node({ dataset: { viewHeading: '' }, tagName: 'H1' });
const newView = rootWith(heading);
assert.equal(restoreFocusTarget(newView, { kind: 'data', key: 'removed', value: 'gone' }), heading, 'missing controls fall back to the new heading');
assert.deepEqual(heading.focusOptions, { preventScroll: true });

const html = await readFile(new URL('../src/privacy.html', import.meta.url), 'utf8');
assert.match(html, /id="status" role="status"/);
assert.match(html, /<label>Password<input id="password" type="password"/);
assert.match(html, /<script type="module" src="native.js"/);
console.log('Desktop accessibility checks passed (labelled controls and scoped live region).');
