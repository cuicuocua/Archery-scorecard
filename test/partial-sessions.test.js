// Closing a scoring session before it's finished, and how the arrows that
// were shot count afterwards.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

// 3 arrows/end x 6 ends = 18 arrows, so the 12-arrow stats floor sits
// inside the round and can be crossed in both directions.
const ROUND_DEF = { id: 'r', stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 6 }] };
const TWO_STAGE = {
  id: 'wa', stages: [
    { distanceM: 70, faceCm: 122, arrowsPerEnd: 3, ends: 5 },
    { distanceM: 60, faceCm: 122, arrowsPerEnd: 3, ends: 5 },
  ],
};

function shoot(session, n, score = 9) {
  let s = session;
  for (let i = 0; i < n; i++) s = m.sessionAddArrow(s, { score, isX: false, x: null, y: null });
  return s;
}

describe('closeSessionEarly / reopenSession', () => {
  it('marks the session partial and stamps when it ended', () => {
    const closed = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 6));
    assert.equal(closed.status, 'partial');
    assert.ok(closed.completedAt, 'a partial still needs an end date to sort and chart by');
  });

  it('keeps every arrow already shot', () => {
    const open = shoot(m.createSession(ROUND_DEF, {}), 7);
    const closed = m.closeSessionEarly(open);
    assert.equal(m.sessionArrowsShot(closed), 7);
    assert.equal(m.sessionTotalScore(closed), m.sessionTotalScore(open));
  });

  it('refuses to downgrade a session that actually finished', () => {
    const done = shoot(m.createSession(ROUND_DEF, {}), 18);
    assert.equal(done.status, 'completed');
    assert.equal(m.closeSessionEarly(done).status, 'completed');
  });

  it('reopening restores it exactly, and is a no-op on anything else', () => {
    const closed = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 6));
    const reopened = m.reopenSession(closed);
    assert.equal(reopened.status, 'in_progress');
    assert.equal(reopened.completedAt, null);
    assert.equal(m.sessionArrowsShot(reopened), 6, 'arrows survive the round trip');

    const done = shoot(m.createSession(ROUND_DEF, {}), 18);
    assert.equal(m.reopenSession(done).status, 'completed');
  });

  it('a reopened session can be shot to completion as normal', () => {
    let s = m.reopenSession(m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 6)));
    s = shoot(s, 12);
    assert.equal(s.status, 'completed');
    assert.equal(m.sessionArrowsShot(s), 18);
  });
});

describe('what a partial counts for', () => {
  const entriesOf = (s) => m.stageEntries([s]);

  it('counts toward arrow-weighted stats once past the floor', () => {
    const under = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 11));
    const over = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 12));
    assert.equal(m.sessionCountsForStats(under), false, '11 arrows is not an average');
    assert.equal(m.sessionCountsForStats(over), true);
    assert.equal(m.entryCountsForStats(entriesOf(under)[0]), false);
    assert.equal(m.entryCountsForStats(entriesOf(over)[0]), true);
  });

  it('never holds a record, however many arrows it has', () => {
    const partial = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 15, 10));
    assert.equal(m.entryCountsForStats(entriesOf(partial)[0]), true, 'it does count for averages');
    assert.equal(m.entryIsRankable(entriesOf(partial)[0]), false, 'but it is not a record');
  });

  it('a session still being shot counts for nothing — unchanged behaviour', () => {
    const open = shoot(m.createSession(ROUND_DEF, {}), 15);
    assert.equal(open.status, 'in_progress');
    assert.equal(m.sessionCountsForStats(open), false);
    assert.equal(m.entryIsRankable(entriesOf(open)[0]), false);
  });

  it('a completed session counts for everything', () => {
    const done = shoot(m.createSession(ROUND_DEF, {}), 18);
    assert.equal(m.sessionCountsForStats(done), true);
    assert.equal(m.entryIsRankable(entriesOf(done)[0]), true);
  });

  // Abandoning a multi-distance round part-way doesn't un-shoot the
  // distances already finished.
  it('a finished stage inside a partial session is still a rankable round', () => {
    const partial = m.closeSessionEarly(shoot(m.createSession(TWO_STAGE, {}), 15 + 6));
    const [first, second] = entriesOf(partial);
    assert.equal(m.stageIsFull(first), true);
    assert.equal(m.entryIsRankable(first), true, 'the 70m stage was shot end to end');
    assert.equal(m.stageIsFull(second), false);
    assert.equal(m.entryIsRankable(second), false, 'the 60m stage was not');
  });
});

describe('personal bests ignore partial rounds', () => {
  const scope = { round: ROUND_DEF.stages[0], bowType: null, sessionType: 'allenamento' };

  it('a strong partial never becomes the PB', () => {
    const partial = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 15, 10));
    const full = shoot(m.createSession(ROUND_DEF, {}), 18, 8);
    const entries = m.stageEntries([partial, full]);
    const pb = m.findPersonalBest(entries, scope, null);
    assert.ok(pb, 'the finished round is the PB');
    assert.equal(pb.sessionId, full.id);
  });

  it('with only partials there is no PB at all', () => {
    const entries = m.stageEntries([m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 15, 10))]);
    assert.equal(m.findPersonalBest(entries, scope, null), null);
  });
});

describe('bestByShape', () => {
  it('averages over partials but takes the record only from finished rounds', () => {
    const partial = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 12, 10)); // 10.00/arrow
    const full = shoot(m.createSession(ROUND_DEF, {}), 18, 7);                          // 7.00/arrow
    const [row] = m.bestByShape(m.stageEntries([partial, full]).filter(m.entryCountsForStats));
    assert.equal(row.best, 7, 'the record comes from the finished round, not the hot partial');
    // arrow-weighted: (12*10 + 18*7) / 30
    assert.ok(Math.abs(row.avg - (12 * 10 + 18 * 7) / 30) < 1e-9, 'the partial still moves the average');
  });

  it('reports no record rather than crashing when a shape has only partials', () => {
    const partial = m.closeSessionEarly(shoot(m.createSession(ROUND_DEF, {}), 12, 9));
    const [row] = m.bestByShape(m.stageEntries([partial]).filter(m.entryCountsForStats));
    assert.equal(row.best, null);
    assert.equal(row.avg, 9);
  });
});
