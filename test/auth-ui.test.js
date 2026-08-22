// AuthGate's error branch, rendered.
//
// It used to collapse every sign-in failure into "Email o password errati",
// including a request that never left the device. On a range with no signal
// that told a scorer their password was wrong and sent them looking for the
// wrong fix on competition morning.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { React, mount, stubRpc, loadScorecardModule, window } = require('./dom.cjs');

const m = loadScorecardModule();

// supabase-js posts to /auth/v1/token, not /rpc/*, so route on the path.
function stubAuth(outcome) {
  globalThis.fetch = window.fetch = () => {
    if (outcome === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    const Res = globalThis.Response || window.Response;
    return Promise.resolve(new Res(JSON.stringify({
      error: 'invalid_grant', error_description: 'Invalid login credentials',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  };
}

async function attemptSignIn(outcome) {
  stubAuth(outcome);
  const ui = mount(React.createElement(m.AuthGate));
  await ui.settle();
  ui.fill(0, 'someone@example.com').fill(1, 'whatever');
  ui.click('Accedi');
  await ui.settle();
  await ui.settle();
  const text = ui.text();
  ui.unmount();
  return text;
}

describe('AuthGate — a failed sign-in says which kind of failure it was', () => {
  beforeEach(() => { globalThis.localStorage.clear(); });

  it('a request that never reached Supabase reports the connection, not the password', async () => {
    const text = await attemptSignIn('offline');
    assert.ok(text.includes('Connessione assente'),
      `expected a connectivity message, got: ${JSON.stringify(text.slice(-120))}`);
    assert.ok(!text.includes('Email o password errati'),
      'a dead network must not be reported as wrong credentials');
  });

  it('credentials the server actually rejected still report as wrong credentials', async () => {
    const text = await attemptSignIn('rejected');
    assert.ok(text.includes('Email o password errati'),
      `expected the credentials message, got: ${JSON.stringify(text.slice(-120))}`);
    assert.ok(!text.includes('Connessione assente'),
      'a real 400 must not be reported as a network problem');
  });
});
