// The participant-submission path: the only way someone who is not the
// organizer can move the bracket, and — until these tests — the only
// substantial logic in the app with no coverage at all.
//
// Two silent-failure bugs lived here. Both are asserted against below:
// a submission that is thrown away used to leave no trace, so the archer's
// phone kept saying "inviato" for a score that was never recorded.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();
const MISMATCH = m.SUBMISSION_MISMATCH_KEY;
const fd = m.matchFormatDef('individual');
const arrows = m.arrowsPerUnit(fd);

function twoPlayerTournament() {
  return m.createTournament({
    name: 'T', date: '2026-01-01', distanceM: 70, faceCm: 122, formatId: 'individual',
    participants: [
      { id: 'p0', name: 'P0', seedScore: 600 },
      { id: 'p1', name: 'P1', seedScore: 599 },
    ],
    finalFormat: 'standard',
  });
}

// A completed match where A wins every set.
function playedMatch(match, bScore = 5) {
  let out = match;
  for (let u = 0; u < fd.units && out.status !== 'completed'; u++) {
    out = m.recordUnit(out, fd, u, 'A', Array(arrows).fill(10));
    out = m.recordUnit(out, fd, u, 'B', Array(arrows).fill(bScore));
  }
  return out;
}

const MATCH_KEY = m.refKey({ kind: 'round', roundIdx: 0, matchIdx: 0 });
const submission = match => ({ updatedMatch: match, submittedAt: '2026-01-01T10:00:00.000Z' });

describe('reconcilePendingSubmissions — both archers agree', () => {
  it('applies the match and clears the blob', () => {
    const t = twoPlayerTournament();
    const played = playedMatch(t.rounds[0][0]);
    const out = m.reconcilePendingSubmissions(t, {
      [MATCH_KEY]: { p0: submission(played), p1: submission(played) },
    });

    assert.equal(out.rounds[0][0].status, 'completed');
    assert.deepEqual(out.pendingSubmissions, {}, 'a resolved submission leaves nothing behind');
  });

  it('waits when only one archer has submitted', () => {
    const t = twoPlayerTournament();
    const played = playedMatch(t.rounds[0][0]);
    const out = m.reconcilePendingSubmissions(t, { [MATCH_KEY]: { p0: submission(played) } });

    assert.notEqual(out.rounds[0][0].status, 'completed');
    assert.ok(out.pendingSubmissions[MATCH_KEY].p0, 'the lone submission is kept, not discarded');
    assert.equal(out.pendingSubmissions[MATCH_KEY][MISMATCH], undefined);
  });
});

describe('reconcilePendingSubmissions — the archers disagree', () => {
  it('records a marker instead of discarding both in silence', () => {
    const t = twoPlayerTournament();
    const mine = playedMatch(t.rounds[0][0], 5);
    const theirs = playedMatch(t.rounds[0][0], 7);   // same winner, different arrows
    const out = m.reconcilePendingSubmissions(t, {
      [MATCH_KEY]: { p0: submission(mine), p1: submission(theirs) },
    }, '2026-01-01T12:00:00.000Z');

    assert.notEqual(out.rounds[0][0].status, 'completed', 'a disputed match must not be applied');
    assert.equal(out.pendingSubmissions[MATCH_KEY][MISMATCH], '2026-01-01T12:00:00.000Z');
    assert.equal(out.pendingSubmissions[MATCH_KEY].p0, undefined, 'both submissions are dropped');
    assert.equal(out.pendingSubmissions[MATCH_KEY].p1, undefined);
  });

  it('marks a submission that agrees but will not replay', () => {
    const t = twoPlayerTournament();
    const bogus = { ...playedMatch(t.rounds[0][0]), units: [{ arrowsA: [10, 10, 99], arrowsB: [9, 9, 9] }] };
    const out = m.reconcilePendingSubmissions(t, {
      [MATCH_KEY]: { p0: submission(bogus), p1: submission(bogus) },
    }, '2026-01-01T12:00:00.000Z');

    assert.notEqual(out.rounds[0][0].status, 'completed');
    assert.equal(out.pendingSubmissions[MATCH_KEY][MISMATCH], '2026-01-01T12:00:00.000Z');
  });

  // The marker shares the object with participant ids, because the SQL
  // function merges new submissions in by id. It must never be counted as
  // an archer, or one re-submission would look like two and reconcile
  // against itself.
  it('is not mistaken for a participant on the next attempt', () => {
    const t = twoPlayerTournament();
    const played = playedMatch(t.rounds[0][0]);
    const out = m.reconcilePendingSubmissions(t, {
      [MATCH_KEY]: { [MISMATCH]: '2026-01-01T12:00:00.000Z', p0: submission(played) },
    });

    assert.notEqual(out.rounds[0][0].status, 'completed', 'one archer plus a marker is not two archers');
    assert.ok(out.pendingSubmissions[MATCH_KEY].p0);
  });

  it('applies once both archers re-submit and agree, clearing the marker', () => {
    const t = twoPlayerTournament();
    const played = playedMatch(t.rounds[0][0]);
    const out = m.reconcilePendingSubmissions(t, {
      [MATCH_KEY]: { [MISMATCH]: '2026-01-01T12:00:00.000Z', p0: submission(played), p1: submission(played) },
    });

    assert.equal(out.rounds[0][0].status, 'completed');
    assert.deepEqual(out.pendingSubmissions, {});
  });
});

describe('reconcilePendingSubmissions — submissions for a match that has moved on', () => {
  it('drops them without a marker', () => {
    const t = twoPlayerTournament();
    const played = playedMatch(t.rounds[0][0]);
    const decided = m.applyMatchResult(t, { kind: 'round', roundIdx: 0, matchIdx: 0 }, played);

    const out = m.reconcilePendingSubmissions(decided, {
      [MATCH_KEY]: { p0: submission(played), p1: submission(played) },
    });
    assert.equal(out.pendingSubmissions[MATCH_KEY], undefined,
      'the organizer already scored it — nothing to tell the archers');
  });
});
