const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();
const individual = m.matchFormatDef('individual'); // 3 arrows/unit, first to 6 SP, 5 units

function baseFinal() {
  return {
    sides: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    status: 'in_progress', units: [], cumSp: [0, 0, 0], goldSlot: null, runoff: null,
  };
}

describe('sumThreeWayPoints', () => {
  it('sums each side\'s set points across every recorded unit', () => {
    const units = [
      { sps: [2, 0, 0] },
      { sps: [1, 1, 0] },
      null, // an unplayed unit shouldn't blow this up
    ];
    assert.deepEqual(m.sumThreeWayPoints(units), [3, 1, 0]);
  });
});

describe('record3WayUnit', () => {
  it('gives the sole leader 2 points, ties split 1 each', () => {
    let final = baseFinal();
    final = m.record3WayUnit(final, individual, 0, 0, [10, 10, 10]); // A: 30
    final = m.record3WayUnit(final, individual, 0, 1, [9, 9, 9]);   // B: 27
    final = m.record3WayUnit(final, individual, 0, 2, [9, 9, 9]);   // C: 27, tied for 2nd (not relevant to sp)
    assert.deepEqual(final.cumSp, [2, 0, 0]);
  });

  it('splits the point 1-1 when two sides tie for the end lead', () => {
    let final = baseFinal();
    final = m.record3WayUnit(final, individual, 0, 0, [9, 9, 9]);
    final = m.record3WayUnit(final, individual, 0, 1, [9, 9, 9]);
    final = m.record3WayUnit(final, individual, 0, 2, [8, 8, 8]);
    assert.deepEqual(final.cumSp, [1, 1, 0]);
  });

  it('splits 1-1-1 on a genuine 3-way tie for the end lead', () => {
    let final = baseFinal();
    final = m.record3WayUnit(final, individual, 0, 0, [9, 9, 9]);
    final = m.record3WayUnit(final, individual, 0, 1, [9, 9, 9]);
    final = m.record3WayUnit(final, individual, 0, 2, [9, 9, 9]);
    assert.deepEqual(final.cumSp, [1, 1, 1]);
  });

  it('declares gold outright once one side alone reaches setPointsToWin (6)', () => {
    let final = baseFinal();
    for (let i = 0; i < 3; i++) {
      final = m.record3WayUnit(final, individual, i, 0, [10, 10, 10]); // A always wins the end outright
      final = m.record3WayUnit(final, individual, i, 1, [1, 1, 1]);
      final = m.record3WayUnit(final, individual, i, 2, [1, 1, 1]);
    }
    assert.deepEqual(final.cumSp, [6, 0, 0]);
    assert.equal(final.goldSlot, 0);
    assert.equal(final.status, 'runoff', 'gold decided, hands straight off to the silver/bronze runoff');
    assert.ok(final.runoff, 'startThreeWayRunoff should have already run');
  });

  it('goes to shootoff3 among just the tied leaders once every unit is exhausted', () => {
    let final = baseFinal();
    // 5 units, every one a 3-way tie for the lead -> 1-1-1 each unit -> 5-5-5 after 5 units
    for (let i = 0; i < 5; i++) {
      final = m.record3WayUnit(final, individual, i, 0, [9, 9, 9]);
      final = m.record3WayUnit(final, individual, i, 1, [9, 9, 9]);
      final = m.record3WayUnit(final, individual, i, 2, [9, 9, 9]);
    }
    assert.deepEqual(final.cumSp, [5, 5, 5]);
    assert.equal(final.status, 'shootoff3');
    assert.deepEqual(final.shootoffContenders.sort(), [0, 1, 2]);
  });
});

describe('startThreeWayRunoff — carries over literal 3-way cumSp, not a recomputed score', () => {
  // Regression test: earlier this replayed raw arrows through the 2-way
  // engine for the two non-gold sides, which could produce a completely
  // different number than what they'd actually earned in the 3-way phase
  // — e.g. two sides that were never simultaneously tied for the lead
  // against each other would recompute as 0-0 even if their raw arrow
  // totals would have given one of them a "win" head-to-head.
  it('runoff starts at the exact cumSp the two silver/bronze contenders already had', () => {
    let final = baseFinal();
    // Unit 0: A wins outright (2-0-0). Unit 1: B and C tie for 2nd/3rd
    // lead against each other while A is elsewhere — a case where B and C
    // never contested the lead against each other head-to-head.
    final = m.record3WayUnit(final, individual, 0, 0, [10, 10, 10]);
    final = m.record3WayUnit(final, individual, 0, 1, [1, 1, 1]);
    final = m.record3WayUnit(final, individual, 0, 2, [1, 1, 1]);
    // cumSp so far: [2, 0, 0]
    final = m.record3WayUnit(final, individual, 1, 0, [1, 1, 1]);
    final = m.record3WayUnit(final, individual, 1, 1, [9, 9, 9]);
    final = m.record3WayUnit(final, individual, 1, 2, [9, 9, 9]);
    // unit 1: B and C tie for the lead (1-1), A trails -> cumSp [2, 1, 1]
    assert.deepEqual(final.cumSp, [2, 1, 1]);

    // Force gold decided by pushing A further ahead without touching B/C's relative standing
    for (let i = 2; i < 4; i++) {
      final = m.record3WayUnit(final, individual, i, 0, [10, 10, 10]);
      final = m.record3WayUnit(final, individual, i, 1, [1, 1, 1]);
      final = m.record3WayUnit(final, individual, i, 2, [1, 1, 1]);
    }
    assert.equal(final.status, 'runoff');
    assert.equal(final.goldSlot, 0);
    // B and C both had cumSp of 1 in the 3-way phase — the runoff must
    // start there, not at some recomputed head-to-head number.
    assert.equal(final.runoff.cumSpA, 1);
    assert.equal(final.runoff.cumSpB, 1);
    assert.deepEqual([final.runoff.sideA, final.runoff.sideB].sort(), [1, 2]);
  });
});

describe('record3WayShootOff', () => {
  it('manually declares gold among the shootoff contenders and starts the runoff', () => {
    let final = baseFinal();
    final.status = 'shootoff3';
    final.shootoffContenders = [0, 1, 2];
    final.cumSp = [5, 5, 5];
    const after = m.record3WayShootOff(final, individual, 1, [[10], [9], [8]]);
    assert.equal(after.goldSlot, 1);
    assert.equal(after.status, 'runoff');
    assert.ok(after.runoff);
  });
});

describe('applyThreeWayRunoffUpdate', () => {
  it('records silver/bronze once the runoff match completes', () => {
    let final = baseFinal();
    for (let i = 0; i < 3; i++) {
      final = m.record3WayUnit(final, individual, i, 0, [10, 10, 10]);
      final = m.record3WayUnit(final, individual, i, 1, [1, 1, 1]);
      final = m.record3WayUnit(final, individual, i, 2, [1, 1, 1]);
    }
    assert.equal(final.status, 'runoff');
    const completedRunoff = m.forfeitMatch(final.runoff, 'B'); // sideB (index 2, "C") wins
    const after = m.applyThreeWayRunoffUpdate(final, completedRunoff);
    assert.equal(after.status, 'completed');
    assert.equal(after.silverSlot, final.runoff.sideB);
    assert.equal(after.bronzeSlot, final.runoff.sideA);
  });

  it('leaves the final at "runoff" if the runoff itself is still unfinished', () => {
    let final = baseFinal();
    for (let i = 0; i < 3; i++) {
      final = m.record3WayUnit(final, individual, i, 0, [10, 10, 10]);
      final = m.record3WayUnit(final, individual, i, 1, [1, 1, 1]);
      final = m.record3WayUnit(final, individual, i, 2, [1, 1, 1]);
    }
    assert.equal(final.status, 'runoff');
    const partialRunoff = { ...final.runoff, status: 'in_progress' };
    const after = m.applyThreeWayRunoffUpdate(final, partialRunoff);
    assert.equal(after.status, 'runoff', 'the final itself stays "runoff" until the runoff match completes');
    assert.equal(after.silverSlot, undefined);
  });
});
