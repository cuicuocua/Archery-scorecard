const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

const ROUND_DEF = {
  id: 'indoor18',
  stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 }],
};

describe('scoreFromRadiusUnits / minScoringRing — 80cm face is a 6-ring face', () => {
  // Regression coverage for the fix where an 80cm face (Targa 50m/40m/30m)
  // was scoring rings 1-4 that don't exist on the real target.
  it('a full 10-ring face (40/60/122cm) scores every ring down to the edge', () => {
    assert.equal(m.minScoringRing(40), 1);
    assert.equal(m.minScoringRing(60), 1);
    assert.equal(m.minScoringRing(122), 1);
    assert.deepEqual(m.scoreFromRadiusUnits(65, 40), { score: 4, isX: false });
    assert.deepEqual(m.scoreFromRadiusUnits(95, 40), { score: 1, isX: false });
  });

  it('the 80cm face only scores rings 5-10 — a tap in the 1-4 band is a miss', () => {
    assert.equal(m.minScoringRing(80), 5);
    assert.deepEqual(m.scoreFromRadiusUnits(65, 80), { score: 0, isX: false }, 'would be ring 4 on a full face');
    assert.deepEqual(m.scoreFromRadiusUnits(95, 80), { score: 0, isX: false }, 'would be ring 1 on a full face');
    assert.deepEqual(m.scoreFromRadiusUnits(55, 80), { score: 5, isX: false }, 'ring 5 itself still scores normally');
  });

  it('a dead-center tap is always an X regardless of face size', () => {
    assert.deepEqual(m.scoreFromRadiusUnits(3, 40), { score: 10, isX: true });
    assert.deepEqual(m.scoreFromRadiusUnits(3, 80), { score: 10, isX: true });
  });

  it('anything past the face radius is a miss', () => {
    assert.deepEqual(m.scoreFromRadiusUnits(101, 40), { score: 0, isX: false });
  });
});

describe('createSession / sessionAddArrow / sessionUndoLastArrow', () => {
  it('a fresh session is in_progress with empty ends matching the round shape', () => {
    const session = m.createSession(ROUND_DEF, {});
    assert.equal(session.status, 'in_progress');
    assert.equal(session.stages[0].ends.length, 20);
    assert.equal(session.stages[0].ends[0].arrows.length, 0);
  });

  it('adding arrows fills ends in order and completes the session once the round is full', () => {
    const smallRound = { id: 'r', stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 2 }] };
    let session = m.createSession(smallRound, {});
    for (let i = 0; i < 6; i++) {
      session = m.sessionAddArrow(session, { score: 9, isX: false, x: null, y: null });
    }
    assert.equal(session.status, 'completed');
    assert.ok(session.completedAt);
    assert.equal(session.stages[0].ends[0].arrows.length, 3);
    assert.equal(session.stages[0].ends[1].arrows.length, 3);
  });

  it('undo removes the single most recent arrow and reopens the session if it was complete', () => {
    const smallRound = { id: 'r', stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 1 }] };
    let session = m.createSession(smallRound, {});
    for (let i = 0; i < 3; i++) session = m.sessionAddArrow(session, { score: 9, isX: false, x: null, y: null });
    assert.equal(session.status, 'completed');
    session = m.sessionUndoLastArrow(session);
    assert.equal(session.status, 'in_progress');
    assert.equal(session.completedAt, null);
    assert.equal(session.stages[0].ends[0].arrows.length, 2);
  });

  it('a multi-stage session advances to the next stage only once the current one is full', () => {
    const twoStage = {
      id: 'wa', stages: [
        { distanceM: 25, faceCm: 60, arrowsPerEnd: 1, ends: 1 },
        { distanceM: 18, faceCm: 40, arrowsPerEnd: 1, ends: 1 },
      ],
    };
    let session = m.createSession(twoStage, {});
    assert.equal(m.activeStageIndex(session), 0);
    session = m.sessionAddArrow(session, { score: 8, isX: false, x: null, y: null });
    assert.equal(m.activeStageIndex(session), 1);
    assert.equal(session.status, 'in_progress');
    session = m.sessionAddArrow(session, { score: 7, isX: false, x: null, y: null });
    assert.equal(session.status, 'completed');
  });
});

describe('sameRound / findPersonalBest / paceVsPB', () => {
  // One arrow per end, three ends — the fixtures below record one arrow per
  // end. arrowsPerEnd/ends are load-bearing for findPersonalBest, which only
  // ranks entries of the same total length against each other.
  const roundShape = { distanceM: 18, faceCm: 40, arrowsPerEnd: 1, ends: 3 };

  function completedEntry(id, totals, round = roundShape) {
    return {
      sessionId: id, status: 'completed', round, bowType: null, sessionType: 'allenamento',
      ends: totals.map((score, i) => ({ index: i, arrows: [{ score, isX: false, x: null, y: null }] })),
    };
  }

  it('sameRound matches on distance+face only, ignoring arrow/end count', () => {
    assert.equal(m.sameRound({ distanceM: 18, faceCm: 40 }, { distanceM: 18, faceCm: 40 }), true);
    assert.equal(m.sameRound({ distanceM: 18, faceCm: 40 }, { distanceM: 25, faceCm: 40 }), false);
  });

  it('findPersonalBest picks the highest-scoring completed entry matching round+bow+type', () => {
    const entries = [
      completedEntry('s1', [9, 9, 9]),
      completedEntry('s2', [10, 10, 10]),
      { ...completedEntry('s3', [10, 10, 10]), status: 'in_progress' }, // not completed, excluded
    ];
    const pb = m.findPersonalBest(entries, { round: roundShape, bowType: null, sessionType: 'allenamento' }, null);
    assert.equal(pb.sessionId, 's2');
  });

  // sameRound deliberately ignores length so all your 18m work groups
  // together, but a personal best has to be like-for-like: a longer round
  // scores higher for arithmetic reasons, not for shooting better.
  it('findPersonalBest ignores a longer round at the same distance and face', () => {
    const longRound = { ...roundShape, ends: 6 };
    const entries = [
      completedEntry('short', [9, 9, 9]),
      completedEntry('long', [10, 10, 10, 10, 10, 10], longRound),
    ];
    const pb = m.findPersonalBest(entries, { round: roundShape, bowType: null, sessionType: 'allenamento' }, null);
    assert.equal(pb.sessionId, 'short');
  });

  it('findPersonalBest excludes the session currently being compared against itself', () => {
    const entries = [completedEntry('s1', [10, 10, 10])];
    const pb = m.findPersonalBest(entries, { round: roundShape, bowType: null, sessionType: 'allenamento' }, 's1');
    assert.equal(pb, null);
  });

  it('paceVsPB is the running score difference at the same arrow count', () => {
    const pbEntry = completedEntry('pb', [10, 10, 10]); // cumulative: 10, 20, 30
    const stage = { round: roundShape, ends: [{ index: 0, arrows: [{ score: 8, isX: false }, { score: 8, isX: false }] }] };
    // shot 2 arrows so far, cumulative 16; PB at 2 arrows was 20
    assert.equal(m.paceVsPB(stage, pbEntry), -4);
  });

  it('paceVsPB is null with no PB to compare against', () => {
    const stage = { round: roundShape, ends: [{ index: 0, arrows: [{ score: 8, isX: false }] }] };
    assert.equal(m.paceVsPB(stage, null), null);
  });
});

describe('normalizeSession — backward compatibility for pre-v1.4 flat sessions', () => {
  it('wraps an old flat round+ends session into the stages shape', () => {
    const old = { id: 'old1', round: { distanceM: 18, faceCm: 40 }, ends: [{ index: 0, arrows: [] }] };
    const normalized = m.normalizeSession(old);
    assert.equal(normalized.stages.length, 1);
    assert.equal(normalized.stages[0].round.distanceM, 18);
    assert.equal(normalized.stages[0].ends.length, 1);
  });

  it('leaves an already-current session untouched', () => {
    const current = { id: 'cur1', stages: [{ round: {}, ends: [] }] };
    assert.equal(m.normalizeSession(current), current);
  });
});
