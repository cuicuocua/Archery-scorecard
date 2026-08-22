// The participant scoring flow, rendered — the path a competitor uses from
// their own phone on the public share link, and the one that produced two
// silent failures in a single day:
//
//   * a submit that reported "inviato" after an RPC that never landed, and
//   * a mismatch re-entry that wiped every set as soon as it was confirmed,
//     so the archer could never finish the score they were being asked for.
//
// Both were invisible to the pure-logic suite. Everything below drives the
// real components through SharedTournamentScreen with only the network faked.
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { React, mount, stubRpc, loadScorecardModule } = require('./dom.cjs');

const m = loadScorecardModule();
const fd = m.matchFormatDef('individual');
const arrows = m.arrowsPerUnit(fd);
const MATCH_KEY = m.refKey({ kind: 'round', roundIdx: 0, matchIdx: 0 });
const UPDATED = '2026-08-22T10:00:00.000Z';

function tournament() {
  const t = m.createTournament({
    name: 'Prova', date: '2026-08-22', distanceM: 70, faceCm: 122, formatId: 'individual',
    participants: [
      { id: 'p0', name: 'Archer Uno', seedScore: 600, email: 'uno@example.com' },
      { id: 'p1', name: 'Archer Due', seedScore: 599, email: 'due@example.com' },
    ],
    finalFormat: 'standard',
  });
  t.shareToken = 'probe-token';
  return t;
}

function playedMatch(t, bScore) {
  let x = t.rounds[0][0];
  for (let u = 0; u < fd.units && x.status !== 'completed'; u++) {
    x = m.recordUnit(x, fd, u, 'A', Array(arrows).fill(10));
    x = m.recordUnit(x, fd, u, 'B', Array(arrows).fill(bScore));
  }
  return x;
}

// Opens the share page and identifies as Archer Uno.
async function openAs(t, routes) {
  const calls = stubRpc({
    get_shared_tournament: [{ data: t, updated_at: UPDATED }],
    identify_participant: [{ participant_id: 'p0', data: t, updated_at: UPDATED }],
    ...routes,
  });
  const ui = mount(React.createElement(m.SharedTournamentScreen, { token: 'probe-token' }));
  await ui.settle();
  ui.click('Sei un partecipante?');
  ui.fill(0, 'uno@example.com').fill(1, 'Archer Uno');
  ui.click('Accedi');
  await ui.settle();
  await ui.settle();
  return { ui, calls };
}

// Scores one set: Uno 10-10-10, Due 5-5-5, confirm. The active side
// auto-advances after the third arrow, same as it does for the organizer.
async function scoreSet(ui) {
  for (let i = 0; i < 3; i++) ui.click('10');
  for (let i = 0; i < 3; i++) ui.click('5');
  ui.click('Conferma set');
  await ui.settle();
}

describe('participant submit — the RPC failed and nothing reached Postgres', () => {
  beforeEach(() => { globalThis.localStorage.clear(); });

  it('says the send failed instead of reporting it as sent', async () => {
    // submit_participant_match is unrouted, so it rejects: no signal.
    const { ui } = await openAs(tournament(), {});
    for (let s = 0; s < 3; s++) await scoreSet(ui);
    await ui.settle();

    assert.ok(ui.has('Invio non riuscito'), `expected a failure notice, got: ${ui.text().slice(0, 200)}`);
    assert.ok(!ui.has('Punteggio inviato'), 'a failed send must never report as sent');
    assert.ok(ui.enabled('Riprova'), 'the scored match must be offered back, not dropped');
    ui.unmount();
  });

  it('Riprova re-sends the same scored match once the network is back', async () => {
    const bodies = [];
    const { ui } = await openAs(tournament(), {});
    for (let s = 0; s < 3; s++) await scoreSet(ui);
    await ui.settle();
    assert.ok(ui.has('Invio non riuscito'), 'fixture: the first send must fail');

    // Signal returns.
    stubRpc({
      get_shared_tournament: [{ data: tournament(), updated_at: UPDATED }],
      submit_participant_match: (init) => { bodies.push(String(init && init.body)); return null; },
    });
    ui.click('Riprova');
    await ui.settle();
    await ui.settle();

    assert.equal(bodies.length, 1, 'exactly one submission should have been sent');
    const sent = JSON.parse(bodies[0]);
    assert.equal(sent.p_match_key, MATCH_KEY);
    assert.equal(sent.p_submission.updatedMatch.status, 'completed',
      'the completed match must survive the failure, not be re-derived empty');
    assert.ok(ui.has('Punteggio inviato'), `expected confirmation, got: ${ui.text().slice(0, 200)}`);
    ui.unmount();
  });
});

describe('participant submit — the two archers disagreed', () => {
  beforeEach(() => { globalThis.localStorage.clear(); });

  // Reconciliation discards both submissions and leaves a marker; the page
  // has to explain that rather than show a bare form or claim it was sent.
  function disputed() {
    const t = tournament();
    const out = m.reconcilePendingSubmissions(t, {
      [MATCH_KEY]: {
        p0: { updatedMatch: playedMatch(t, 5), submittedAt: 'x' },
        p1: { updatedMatch: playedMatch(t, 7), submittedAt: 'y' },
      },
    }, '2026-08-22T12:34:56.000Z');
    out.shareToken = 'probe-token';
    return out;
  }

  it('explains why it is asking for the score again', async () => {
    const { ui } = await openAs(disputed(), {});
    assert.ok(ui.has('non coincidevano'), `expected the mismatch notice, got: ${ui.text().slice(0, 200)}`);
    assert.ok(!ui.has('Punteggio inviato'), 'a discarded submission must not still read as sent');
    assert.ok(ui.has('Set 1 di 5'), 'the match should be re-offered from the start, not left half-scored');
    ui.unmount();
  });

  // The regression: confirming a set calls setLiveMatch, which re-renders
  // while the banner is still up. That used to throw the set away, so the
  // match snapped back to "Set 1 di 5" and could never be finished.
  it('keeps each confirmed set while the banner is still showing', async () => {
    const { ui } = await openAs(disputed(), {});
    assert.ok(ui.has('Set 1 di 5'), 'fixture: should start at set 1');

    await scoreSet(ui);
    assert.ok(ui.has('Set 2 di 5'), `set 1 was wiped — still showing: ${ui.text().slice(0, 160)}`);
    assert.ok(ui.has('non coincidevano'), 'the banner should still be up mid-re-entry');

    await scoreSet(ui);
    assert.ok(ui.has('Set 3 di 5'), 'set 2 was wiped');
    ui.unmount();
  });

  it('one archer in and waiting is not treated as a dispute', async () => {
    const t = tournament();
    t.pendingSubmissions = { [MATCH_KEY]: { p0: { updatedMatch: playedMatch(t, 5), submittedAt: 'x' } } };
    const { ui } = await openAs(t, {});
    assert.ok(ui.has('In attesa'), `expected the waiting state, got: ${ui.text().slice(0, 200)}`);
    assert.ok(!ui.has('non coincidevano'), 'nothing was discarded — no mismatch notice');
    ui.unmount();
  });
});
