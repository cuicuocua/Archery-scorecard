const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

function seed(n, score) { return { id: `p${n}`, name: `P${n}`, seed: n, seedScore: score }; }

describe('seedLancasterSides', () => {
  it('re-ranks by seed score, highest first, regardless of input order', () => {
    const shuffled = [seed(3, 500), seed(1, 700), seed(4, 400), seed(2, 600)];
    const ranked = m.seedLancasterSides(shuffled);
    assert.deepEqual(ranked.map(p => p.seed), [1, 2, 3, 4]);
  });

  it('sorts nulls (unfilled slots) to the end', () => {
    const ranked = m.seedLancasterSides([seed(2, 600), null, seed(1, 700)]);
    assert.deepEqual(ranked.map(p => p && p.seed), [1, 2, null]);
  });
});

describe('seedLancasterLadder', () => {
  it('wires match1 = 4th vs 3rd, and pre-fills match2/match3 with 2nd/1st waiting on the chain', () => {
    const finalStage = { sides: [seed(1, 700), seed(2, 600), seed(3, 500), seed(4, 400)] };
    m.seedLancasterLadder(finalStage);
    assert.equal(finalStage.match1.slotA.seed, 4);
    assert.equal(finalStage.match1.slotB.seed, 3);
    assert.equal(finalStage.match1.status, 'pending');
    assert.equal(finalStage.match2.slotA.seed, 2);
    assert.equal(finalStage.match2.slotB, null);
    assert.equal(finalStage.match3.slotA.seed, 1);
    assert.equal(finalStage.match3.slotB, null);
  });
});

describe('Lancaster wildcard play-in', () => {
  function tournamentWithFinalStage() {
    const sides = [seed(1, 700), seed(2, 600), seed(3, 500), seed(4, 400)];
    const finalStage = { sides, standings: {} };
    m.seedLancasterLadder(finalStage);
    const wildcard = { id: 'w1', name: 'Wildcard', seed: 5, seedScore: 350 };
    return {
      participants: [...sides, wildcard],
      finalStage,
    };
  }

  it('eligibleLancasterWildcards excludes only the current 4 sides, sorted by seed', () => {
    const t = tournamentWithFinalStage();
    const eligible = m.eligibleLancasterWildcards(t);
    assert.deepEqual(eligible.map(p => p.id), ['w1']);
  });

  it('setLancasterWildcard challenges the 4th seed and clears match1.slotA to be fed by the play-in', () => {
    const t = tournamentWithFinalStage();
    const wildcard = t.participants.find(p => p.id === 'w1');
    const nextFinalStage = m.setLancasterWildcard(t.finalStage, wildcard);
    assert.equal(nextFinalStage.playIn.slotA.id, 'w1');
    assert.equal(nextFinalStage.playIn.slotB.seed, 4);
    assert.equal(nextFinalStage.match1.slotA, null);
    assert.equal(nextFinalStage.match1.status, 'waiting');
    // untouched
    assert.equal(nextFinalStage.match1.slotB.seed, 3);
    assert.equal(nextFinalStage.match2.slotA.seed, 2);
  });

  it('clearLancasterWildcard restores the plain 4th-vs-3rd ladder', () => {
    const t = tournamentWithFinalStage();
    const wildcard = t.participants.find(p => p.id === 'w1');
    const withWildcard = m.setLancasterWildcard(t.finalStage, wildcard);
    const restored = m.clearLancasterWildcard(withWildcard);
    assert.equal(restored.playIn, null);
    assert.equal(restored.match1.slotA.seed, 4);
    assert.equal(restored.match1.status, 'pending');
  });
});
