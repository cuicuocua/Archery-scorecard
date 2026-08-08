const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

function makeParticipants(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, seedScore: (n - i) * 10, seed: i + 1 }));
}

describe('standardSeedOrder', () => {
  it('produces the classic bracket seeding for size 8', () => {
    assert.deepEqual(m.standardSeedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  });
  it('produces the classic bracket seeding for size 4', () => {
    assert.deepEqual(m.standardSeedOrder(4), [1, 4, 2, 3]);
  });
  it('handles the trivial sizes', () => {
    assert.deepEqual(m.standardSeedOrder(1), [1]);
    assert.deepEqual(m.standardSeedOrder(2), [1, 2]);
  });
});

describe('buildBracket — standard format', () => {
  it('rounds up to the next power of 2 and resolves byes immediately', () => {
    const { size, rounds } = m.buildBracket(makeParticipants(5), 'standard');
    assert.equal(size, 8);
    assert.equal(rounds[0].length, 4);
    const byes = rounds[0].filter(match => match.status === 'bye');
    assert.equal(byes.length, 3, '8-slot bracket with 5 real entrants should have 3 byes in round 0');
    // Top seed (seed 1) must get a bye and the win should already be
    // propagated into round 1 without anyone needing to "play" it.
    const topSeedMatch = rounds[0].find(mt => mt.slotA && mt.slotA.seed === 1);
    assert.equal(topSeedMatch.status, 'bye');
    assert.equal(topSeedMatch.winnerSlot, 'A');
    assert.ok(rounds[1].some(nextMatch => nextMatch.slotA?.seed === 1 || nextMatch.slotB?.seed === 1),
      'the bye winner should already be sitting in round 1');
  });

  it('an exact power-of-2 field has no byes at all', () => {
    const { rounds } = m.buildBracket(makeParticipants(8), 'standard');
    assert.ok(rounds[0].every(match => match.status === 'pending'));
  });

  it('keeps the #1 and #2 seeds in opposite halves so they can only meet in the final', () => {
    const { rounds } = m.buildBracket(makeParticipants(8), 'standard');
    const seed1MatchIdx = rounds[0].findIndex(mt => mt.slotA?.seed === 1 || mt.slotB?.seed === 1);
    const seed2MatchIdx = rounds[0].findIndex(mt => mt.slotA?.seed === 2 || mt.slotB?.seed === 2);
    const half = rounds[0].length / 2;
    assert.notEqual(Math.floor(seed1MatchIdx / half), Math.floor(seed2MatchIdx / half));
  });

  it('builds a bronze match for a standard-format field of 4+', () => {
    const { thirdPlaceMatch, finalStage } = m.buildBracket(makeParticipants(8), 'standard');
    assert.ok(thirdPlaceMatch);
    assert.equal(finalStage, null);
  });

  it('skips the bronze match for a 2-person field (no real semifinal)', () => {
    const { thirdPlaceMatch } = m.buildBracket(makeParticipants(2), 'standard');
    assert.equal(thirdPlaceMatch, null);
  });
});

describe('buildBracket — threeway format', () => {
  it('drops only the final round, keeping the semifinal as real matches', () => {
    const { rounds, finalStage } = m.buildBracket(makeParticipants(8), 'threeway');
    assert.equal(rounds.length, 2, 'quarterfinal + semifinal, final round dropped into finalStage');
    assert.equal(finalStage.format, 'threeway');
    assert.deepEqual(finalStage.final.sides, [null, null, null]);
    assert.equal(finalStage.prelim.status, 'waiting');
  });
});

describe('buildBracket — lancaster format', () => {
  it('drops semifinal + final rounds for an 8-person field', () => {
    const { rounds, finalStage } = m.buildBracket(makeParticipants(8), 'lancaster');
    assert.equal(rounds.length, 1, 'only the quarterfinal round is real bracket play');
    assert.deepEqual(finalStage.sides, [null, null, null, null], 'not seeded yet — waiting on quarterfinal winners');
  });

  it('seeds the ladder immediately for an exact field of 4 (no rounds to play first)', () => {
    const { rounds, finalStage } = m.buildBracket(makeParticipants(4), 'lancaster');
    assert.equal(rounds.length, 0);
    assert.equal(finalStage.sides[0].seed, 1);
    assert.equal(finalStage.sides[3].seed, 4);
    // match1 = 4th vs 3rd, match2/match3 pre-filled with 2nd/1st waiting on the chain
    assert.equal(finalStage.match1.slotA.seed, 4);
    assert.equal(finalStage.match1.slotB.seed, 3);
    assert.equal(finalStage.match2.slotA.seed, 2);
    assert.equal(finalStage.match2.slotB, null);
    assert.equal(finalStage.match3.slotA.seed, 1);
  });
});

describe('propagateWinner', () => {
  it('feeds the winner into the correct next-round slot', () => {
    const { rounds } = m.buildBracket(makeParticipants(4), 'standard');
    const winner = rounds[0][0].slotA;
    m.propagateWinner(rounds, 0, 0, 'A');
    assert.equal(rounds[1][0].slotA, winner);
    assert.equal(rounds[1][0].status, 'waiting', 'still missing the other semifinal result');
  });

  it('marks the next match pending once both slots are filled', () => {
    const { rounds } = m.buildBracket(makeParticipants(4), 'standard');
    m.propagateWinner(rounds, 0, 0, 'A');
    m.propagateWinner(rounds, 0, 1, 'B');
    assert.equal(rounds[1][0].status, 'pending');
  });

  it('is a no-op past the final round', () => {
    const { rounds } = m.buildBracket(makeParticipants(2), 'standard');
    assert.doesNotThrow(() => m.propagateWinner(rounds, 0, 0, 'A'));
  });
});

describe('fillMatchSlot / resolveByeIfLonely', () => {
  it('fillMatchSlot marks pending once both sides are present, never auto-resolves a bye', () => {
    let match = m.emptyMatch();
    match = m.fillMatchSlot(match, 'slotA', { id: 'x', name: 'X' });
    assert.equal(match.status, 'waiting');
    match = m.fillMatchSlot(match, 'slotB', { id: 'y', name: 'Y' });
    assert.equal(match.status, 'pending');
  });

  it('resolveByeIfLonely only resolves a genuinely lonely slot', () => {
    let match = m.fillMatchSlot(m.emptyMatch(), 'slotA', { id: 'x', name: 'X' });
    match = m.resolveByeIfLonely(match);
    assert.equal(match.status, 'bye');
    assert.equal(match.winnerSlot, 'A');
  });

  it('resolveByeIfLonely leaves a fully-empty match untouched', () => {
    const match = m.resolveByeIfLonely(m.emptyMatch());
    assert.equal(match.status, 'waiting');
  });
});
