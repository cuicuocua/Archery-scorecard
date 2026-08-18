const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

const ROUND_DEF = {
  id: 'indoor18',
  stages: [{ distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 }],
};

describe('scoreFromRadiusUnits / ringGeometry — ring classes', () => {
  it('a full 10-ring face scores every ring down to the edge', () => {
    assert.equal(m.ringGeometry('full').minRing, 1);
    assert.deepEqual(m.scoreFromRadiusUnits(65, 'full'), { score: 4, isX: false });
    assert.deepEqual(m.scoreFromRadiusUnits(95, 'full'), { score: 1, isX: false });
  });

  // Regression coverage for the outdoor 80cm-face fix (Targa 50m/40m/30m):
  // a margin-cut face, same physical size, rings 1-4 just left unprinted.
  it('outdoor6 (80cm face) only scores rings 5-10 — a tap in the 1-4 band is a miss', () => {
    assert.equal(m.ringGeometry('outdoor6').minRing, 5);
    assert.deepEqual(m.scoreFromRadiusUnits(65, 'outdoor6'), { score: 0, isX: false }, 'would be ring 4 on a full face');
    assert.deepEqual(m.scoreFromRadiusUnits(95, 'outdoor6'), { score: 0, isX: false }, 'would be ring 1 on a full face');
    assert.deepEqual(m.scoreFromRadiusUnits(55, 'outdoor6'), { score: 5, isX: false }, 'ring 5 itself still scores normally');
  });

  // indoor6C (indoor single-spot compound): margin-cut like outdoor6, but
  // cuts at ring 6 (not 5) and has compound's halved 10-ring.
  it('indoor6C only scores rings 6-10, with a smaller 10-ring than recurve', () => {
    const geo = m.ringGeometry('indoor6C');
    assert.equal(geo.minRing, 6);
    assert.deepEqual(m.scoreFromRadiusUnits(55, 'indoor6C'), { score: 0, isX: false }, 'ring 5 no longer scores at all');
    assert.deepEqual(m.scoreFromRadiusUnits(45, 'indoor6C'), { score: 6, isX: false });
    assert.equal(geo.xOuter, 2.5, 'half the recurve X-ring radius');
  });

  // spot6R/spot6C (WA/Vegas triple spots): an isolated smaller spot, not a
  // margin-cut face — ring 6 fills the spot edge to edge (rescaled), no
  // blank margin beyond it at all.
  it('spot6R fills the whole isolated spot with rings 6-10, rescaled to the spot\'s own radius', () => {
    const geo = m.ringGeometry('spot6R');
    assert.equal(geo.minRing, 6);
    assert.deepEqual(m.scoreFromRadiusUnits(100, 'spot6R'), { score: 6, isX: false }, 'ring 6 now reaches the spot edge');
    assert.deepEqual(m.scoreFromRadiusUnits(101, 'spot6R'), { score: 0, isX: false }, 'past the spot edge is a miss');
    assert.equal(geo.xOuter, 10);
  });

  it('spot6C is spot6R with a halved 10-ring, same 6-9 boundaries', () => {
    const rGeo = m.ringGeometry('spot6R'), cGeo = m.ringGeometry('spot6C');
    const ringsExceptTen = s => s.specs.filter(spec => spec.score !== 10).map(spec => spec.outer);
    assert.deepEqual(ringsExceptTen(cGeo), ringsExceptTen(rGeo), 'rings 6-9 are identical between recurve and compound');
    const tenR = rGeo.specs.find(s => s.score === 10).outer, tenC = cGeo.specs.find(s => s.score === 10).outer;
    assert.equal(tenC, tenR / 2);
    assert.equal(cGeo.xOuter, rGeo.xOuter / 2);
  });

  it('a dead-center tap is always an X regardless of ring class', () => {
    assert.deepEqual(m.scoreFromRadiusUnits(1, 'full'), { score: 10, isX: true });
    assert.deepEqual(m.scoreFromRadiusUnits(1, 'outdoor6'), { score: 10, isX: true });
  });

  it('anything past the overall face radius is a miss', () => {
    assert.deepEqual(m.scoreFromRadiusUnits(101, 'full'), { score: 0, isX: false });
  });
});

describe('spotFaceCm / spotCount / roundSpotLayout / roundRingClass', () => {
  it('single-spot rounds keep the full class faceCm; multi-spot rounds halve it', () => {
    assert.equal(m.spotFaceCm(40, 'single'), 40);
    assert.equal(m.spotFaceCm(40, 'vertical3'), 20);
    assert.equal(m.spotFaceCm(60, 'triangular3'), 30);
  });

  it('spotCount is 1 for single, 3 for either multi-spot layout', () => {
    assert.equal(m.spotCount('single'), 1);
    assert.equal(m.spotCount('vertical3'), 3);
    assert.equal(m.spotCount('triangular3'), 3);
  });

  it('roundSpotLayout/roundRingClass default safely for old data with neither field', () => {
    assert.equal(m.roundSpotLayout({ distanceM: 18, faceCm: 40 }), 'single');
    assert.equal(m.roundRingClass({ distanceM: 18, faceCm: 40 }), 'full');
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
