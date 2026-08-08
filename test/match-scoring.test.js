const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();
const individual = m.matchFormatDef('individual'); // 3 arrows/unit, 5 units, first to 6 SP

function baseMatch() {
  return m.fillMatchSlot(m.fillMatchSlot(m.emptyMatch(), 'slotA', { id: 'a', name: 'Alice' }), 'slotB', { id: 'b', name: 'Bob' });
}

describe('recordUnit', () => {
  it('awards 2-0 set points to the higher total, 1-1 on a tie', () => {
    let match = baseMatch();
    match = m.recordUnit(match, individual, 0, 'A', [10, 10, 10]);
    match = m.recordUnit(match, individual, 0, 'B', [9, 9, 9]);
    assert.equal(match.cumSpA, 2);
    assert.equal(match.cumSpB, 0);
    assert.equal(match.status, 'in_progress');

    match = m.recordUnit(match, individual, 1, 'A', [9, 9, 9]);
    match = m.recordUnit(match, individual, 1, 'B', [9, 9, 9]);
    assert.equal(match.cumSpA, 3);
    assert.equal(match.cumSpB, 1);
  });

  it('completes the match once someone reaches setPointsToWin', () => {
    let match = baseMatch();
    for (let i = 0; i < 3; i++) {
      match = m.recordUnit(match, individual, i, 'A', [10, 10, 10]);
      match = m.recordUnit(match, individual, i, 'B', [1, 1, 1]);
    }
    assert.equal(match.cumSpA, 6);
    assert.equal(match.status, 'completed');
    assert.equal(match.winnerSlot, 'A');
  });

  it('goes to a shoot-off if every unit is exhausted still tied', () => {
    let match = baseMatch();
    for (let i = 0; i < 5; i++) {
      match = m.recordUnit(match, individual, i, 'A', [9, 9, 9]);
      match = m.recordUnit(match, individual, i, 'B', [9, 9, 9]);
    }
    assert.equal(match.cumSpA, 5);
    assert.equal(match.cumSpB, 5);
    assert.equal(match.status, 'shootoff');
  });

  it('recomputes cumulative points from the full unit list, not incrementally — correcting an earlier unit re-derives everything', () => {
    let match = baseMatch();
    match = m.recordUnit(match, individual, 0, 'A', [10, 10, 10]);
    match = m.recordUnit(match, individual, 0, 'B', [1, 1, 1]); // 2-0
    match = m.recordUnit(match, individual, 1, 'A', [10, 10, 10]);
    match = m.recordUnit(match, individual, 1, 'B', [1, 1, 1]); // 2-0 again, cumSpA=4
    assert.equal(match.cumSpA, 4);
    // Now go back and correct unit 0 to a loss for A instead
    match = m.recordUnit(match, individual, 0, 'A', [1, 1, 1]);
    match = m.recordUnit(match, individual, 0, 'B', [10, 10, 10]);
    assert.equal(match.cumSpA, 2, 'only unit 1s 2 points should remain for A');
    assert.equal(match.cumSpB, 2);
  });
});

describe('recordShootOff / forfeitMatch', () => {
  it('recordShootOff completes the match for the declared winner', () => {
    const match = m.recordShootOff(baseMatch(), 'B', [9], [10]);
    assert.equal(match.status, 'completed');
    assert.equal(match.winnerSlot, 'B');
    assert.equal(match.shootOff.winner, 'B');
  });

  it('forfeitMatch completes the match without touching any recorded arrows', () => {
    let match = m.recordUnit(baseMatch(), individual, 0, 'A', [10, 10, 10]);
    match = m.recordUnit(match, individual, 0, 'B', [9, 9, 9]);
    const forfeited = m.forfeitMatch(match, 'B');
    assert.equal(forfeited.status, 'completed');
    assert.equal(forfeited.winnerSlot, 'B');
    assert.equal(forfeited.forfeit, true);
    assert.deepEqual(forfeited.units, match.units, 'arrows already scored stay on the record');
  });
});

describe('matchHasResult / currentUnitIndex', () => {
  it('matchHasResult is true for in-progress, shootoff, and completed; false for pending/waiting/bye', () => {
    assert.equal(m.matchHasResult(null), false);
    assert.equal(m.matchHasResult(m.emptyMatch()), false);
    assert.equal(m.matchHasResult({ status: 'pending' }), false);
    assert.equal(m.matchHasResult({ status: 'bye' }), false);
    assert.equal(m.matchHasResult({ status: 'in_progress' }), true);
    assert.equal(m.matchHasResult({ status: 'shootoff' }), true);
    assert.equal(m.matchHasResult({ status: 'completed' }), true);
  });

  it('currentUnitIndex finds the first unit missing either side\'s total', () => {
    let match = baseMatch();
    assert.equal(m.currentUnitIndex(match), 0);
    match = m.recordUnit(match, individual, 0, 'A', [10, 10, 10]);
    assert.equal(m.currentUnitIndex(match), 0, 'unit 0 still missing B');
    match = m.recordUnit(match, individual, 0, 'B', [9, 9, 9]);
    assert.equal(m.currentUnitIndex(match), 1);
  });
});
