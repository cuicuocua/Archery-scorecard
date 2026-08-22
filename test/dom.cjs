// Minimal DOM harness for the React layer.
//
// Everything else in test/ drives pure functions, which is why three real
// bugs shipped from the component layer in a single day: a submit that
// reported success after a failed RPC, a re-entry screen that wiped every
// set the archer confirmed, and a sign-in that blamed the password for a
// dead network. None were reachable without rendering.
//
// The DOM has to exist before react-dom is required — it decides at import
// time whether it is in a browser — so this module installs jsdom's globals
// at require time and only then hands back loadScorecardModule. Require
// THIS, not ./load.cjs, from any test that renders.
const { JSDOM } = require('jsdom');

// No pretendToBeVisual: it starts a repeating requestAnimationFrame timer
// that keeps the process alive, so `node --test` would hang after the last
// assertion. React 18's scheduler doesn't need rAF; the shim below is
// enough for anything that asks for it.
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://example.test/share.html?share=probe-token',
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.localStorage = window.localStorage;
for (const k of [
  'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent',
  'KeyboardEvent', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'DOMRect', 'Image', 'FileReader', 'Blob',
]) {
  if (window[k] !== undefined) globalThis[k] = window[k];
}
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
}
// React 18 refuses to batch updates from act() without this.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { createRoot } = require('react-dom/client');
// React 18.3 exports act() directly; react-dom/test-utils warns on every use.
const act = React.act || require('react-dom/test-utils').act;
const { loadScorecardModule } = require('./load.cjs');

function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(element); });

  const buttons = () => [...container.querySelectorAll('button')];
  const api = {
    container,
    text: () => container.textContent,
    has: (s) => container.textContent.includes(s),
    buttons: () => buttons().map((b) => b.textContent.trim()),
    // Exact-match first so '10' never picks up a button labelled '100'.
    click(label) {
      const b = buttons().find((x) => x.textContent.trim() === label)
             || buttons().find((x) => x.textContent.trim().includes(label));
      if (!b) throw new Error(`no button ${JSON.stringify(label)}; have: ${JSON.stringify(api.buttons())}`);
      if (b.disabled) throw new Error(`button ${JSON.stringify(label)} is disabled`);
      act(() => { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      return api;
    },
    enabled(label) {
      const b = buttons().find((x) => x.textContent.trim() === label);
      return !!b && !b.disabled;
    },
    // React tracks input values on the node, so the native setter has to be
    // used or the change event carries the old value.
    fill(index, value) {
      const input = container.querySelectorAll('input')[index];
      if (!input) throw new Error(`no input at index ${index}`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      return api;
    },
    async settle() { await act(async () => { await Promise.resolve(); }); return api; },
    unmount() { act(() => { root.unmount(); }); container.remove(); },
  };
  return api;
}

// Routes Supabase RPC calls by name. Anything unrouted rejects, which is
// what "no signal" looks like from inside the app.
function stubRpc(routes) {
  const calls = [];
  globalThis.fetch = window.fetch = (input, init) => {
    const url = String(input && input.url ? input.url : input);
    const name = (url.match(/\/rpc\/([a-z_]+)/) || [])[1] || url;
    calls.push(name);
    const route = routes[name];
    if (!route) return Promise.reject(new TypeError('Failed to fetch'));
    const body = typeof route === 'function' ? route(init) : route;
    if (body instanceof Error) return Promise.reject(body);
    const Res = globalThis.Response || window.Response;
    return Promise.resolve(new Res(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
  };
  return calls;
}

// Closing the window releases what it can. Two handles survive it and keep
// the process alive after the last assertion: a Timeout that jsdom holds
// from construction (present before React or the app is even loaded) and
// React's scheduler MessageChannel. Neither belongs to this codebase and
// neither can be reached from here, which is why `npm test` runs with
// --test-force-exit. Without it the suite passes and then hangs forever —
// in CI that is a stuck job, not a failure.
try {
  require('node:test').after(() => { try { window.close(); } catch { /* already gone */ } });
} catch { /* not running under node:test */ }

module.exports = { React, act, mount, stubRpc, loadScorecardModule, window };
