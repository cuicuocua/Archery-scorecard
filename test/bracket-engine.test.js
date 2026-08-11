// End-to-end drives of the bracket engine: rather than asserting on one
// function's output, each test plays a whole tournament the way a scorer
// would — repeatedly open whatever the bracket says is playable, score it,
// hand the result back — until nothing is playable. That loop is the only
// thing that surfaces a deadlock, which is how a bracket bug actually
// presents: not an exception, just a tournament that can never finish.
//
// The rest of this suite tests functions in isolation; this file exists
// because the engine's failure mode is emergent.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();
const fd = m.matchFormatDef('individual');
const arrows = m.arrowsPerUnit(fd);

function field(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seedScore: 600 - i }));
}

function newTournament(finalFormat, n) {
  return m.createTournament({
    name: 'T', date: '2026-01-01', distanceM: 70, faceCm: 122,
    formatId: 'individual', participants: field(n), finalFormat,
  });
}

// Side A always outscores B, so every match has a decisive winner.
function playMatch(match) {
  let match_ = match;
  for (let u = 0; u < fd.units && match_.status !== 'completed'; u++) {
    match_ = m.recordUnit(match_, fd, u, 'A', Array(arrows).fill(10));
    match_ = m.recordUnit(match_, fd, u, 'B', Array(arrows).fill(5));
  }
  return match_;
}

function playThrough(finalFormat, n) {
  let t = newTournament(finalFormat, n);
  for (let guard = 0; guard < 100; guard++) {
    const [ref] = m.flatMatchRefs(t).filter(r => m.isRefPlayable(t, r));
    if (!ref) break;
    if (ref.kind === 'threeFinal') {
      let f = t.finalStage.final;
      if (f.status === 'runoff') {
        f = m.applyThreeWayRunoffUpdate(f, playMatch(f.runoff));
      } else {
        for (let u = 0; u < fd.units && ['pending', 'in_progress'].includes(f.status); u++) {
          [0, 1, 2].forEach(i => { f = m.record3WayUnit(f, fd, u, i, Array(arrows).fill(10 - i * 2)); });
        }
      }
      t = m.applyMatchResult(t, ref, f);
    } else {
      t = m.applyMatchResult(t, ref, playMatch(m.resolveMatchRef(t, ref).match));
    }
  }
  return t;
}

describe('every final format plays to a podium at every field size', () => {
  for (const finalFormat of ['standard', 'threeway', 'lancaster']) {
    for (let n = 2; n <= 8; n++) {
      it(`${finalFormat}, ${n} competitors`, () => {
        const t = playThrough(finalFormat, n);
        assert.ok(m.tournamentIsComplete(t), 'no playable match left, but the tournament is not complete');
        assert.ok(m.tournamentPodium(t)?.gold, 'complete, but no gold medallist');
      });
    }
  }
});

// A field of 3 leaves an empty bracket slot, which is a bye — and a bye is
// never *played*. Both custom final formats used to seed their final stage
// when a match completed, so the bye never seeded its side and the
// tournament ran out of playable matches with nobody on the podium.
describe('a field of 3 — the bye that is never played', () => {
  for (const finalFormat of ['threeway', 'lancaster']) {
    it(`${finalFormat} awards three distinct places and no fourth`, () => {
      const podium = m.tournamentPodium(playThrough(finalFormat, 3));
      const named = [podium.gold, podium.silver, podium.bronze].filter(Boolean).map(p => p.name);
      assert.equal(named.length, 3);
      assert.equal(new Set(named).size, 3, `duplicate names on the podium: ${named}`);
      assert.equal(podium.fourth, null, 'there is no 4th place in a field of 3');
    });
  }

  it('lancaster leaves no ladder slot that reads as a competitor', () => {
    const t = newTournament('lancaster', 3);
    assert.ok(!t.finalStage.sides[3], 'the wildcard control reads sides[3].name and would throw');
  });
});

// Correcting a confirmed set can change who won. Everything downstream of
// that match is then holding a result that belongs to someone no longer in it.
describe('correcting a confirmed set cascades through the draw', () => {
  const corrected = () => {
    const t0 = playThrough('standard', 4);
    let sf = t0.rounds[0][0];
    for (let u = 0; u < 3; u++) {                      // flip the semifinal: B now wins
      sf = m.recordUnit(sf, fd, u, 'A', Array(arrows).fill(5));
      sf = m.recordUnit(sf, fd, u, 'B', Array(arrows).fill(10));
    }
    return { t0, sf, t1: m.applyMatchResult(t0, { kind: 'round', roundIdx: 0, matchIdx: 0 }, sf) };
  };

  it('the final is torn down, not left half-won', () => {
    const { t1 } = corrected();
    const final = t1.rounds[1][0];
    assert.equal(final.winnerSlot, null);
    assert.equal(final.units.length, 0);
    assert.equal(final.status, 'pending');
  });

  it('the corrected winner is in the final and the corrected loser in the bronze match', () => {
    const { sf, t1 } = corrected();
    assert.equal(t1.rounds[1][0].slotA?.id, m.winnerOf(sf).id);
    assert.equal(t1.thirdPlaceMatch.slotA?.id, m.loserOf(sf).id);
  });

  // The reason invalidation is gated on the winner actually changing: a
  // scorer re-confirming what they already entered must not wipe the draw.
  it('re-confirming an unchanged result preserves the played final', () => {
    const { t0 } = corrected();
    const t2 = m.applyMatchResult(t0, { kind: 'round', roundIdx: 0, matchIdx: 0 }, t0.rounds[0][0]);
    assert.equal(t2.rounds[1][0].status, 'completed');
    assert.ok(m.tournamentPodium(t2)?.gold);
  });
});

// The 3-way final's silver/bronze runoff starts at the set points the two
// archers already earned against each other. recordUnit rebuilds cumSp from
// the units array, so the carry-over has to survive the first end recorded.
describe('the 3-way final runoff carries its set points', () => {
  it('a seeded runoff still holds its lead after one end', () => {
    let t = newTournament('threeway', 4);
    for (let pass = 0; pass < 2; pass++) {
      for (const r of m.flatMatchRefs(t).filter(r => m.isRefPlayable(t, r) && r.kind !== 'threeFinal')) {
        t = m.applyMatchResult(t, r, playMatch(m.resolveMatchRef(t, r).match));
      }
    }
    const endWinner = [0, 1, 2, 0, 0];   // spread the ends so the two non-winners carry points
    let f = t.finalStage.final;
    for (let u = 0; u < 5 && ['pending', 'in_progress'].includes(f.status); u++) {
      [0, 1, 2].forEach(i => { f = m.record3WayUnit(f, fd, u, i, Array(arrows).fill(i === endWinner[u] ? 10 : 5)); });
    }

    const seededA = f.runoff.cumSpA, seededB = f.runoff.cumSpB;
    assert.ok(seededA > 0, 'fixture failed to seed the runoff with any set points');

    const afterOneEnd = m.recordUnit(
      m.recordUnit(f.runoff, fd, 0, 'A', Array(arrows).fill(10)),
      fd, 0, 'B', Array(arrows).fill(5));
    assert.equal(afterOneEnd.cumSpA, seededA + 2, 'the carry-over vanished when the first end was confirmed');
    assert.equal(afterOneEnd.cumSpB, seededB);
  });
});

// A participant submission is replayed onto the bracket's own match, so the
// only thing taken from it is the arrow scores. Everything else — who won,
// who is even in the match — is re-derived.
describe('a participant submission is replayed, never trusted', () => {
  const setup = () => {
    const t = newTournament('standard', 2);
    const real = t.rounds[0][0];
    return { real, honest: playMatch(real) };
  };

  it('two participants agreeing on the arrows cannot agree on the wrong winner', () => {
    const { real, honest } = setup();
    const forged = { ...honest, winnerSlot: 'B', slotA: { id: 'x', name: 'Impostor' } };
    assert.ok(m.unitsMatch(honest.units, forged.units), 'fixture: the arrows must agree, as they would');

    const rebuilt = m.rebuildMatchFromUnits(real, fd, forged.units);
    assert.equal(rebuilt.winnerSlot, 'A');
    assert.equal(rebuilt.slotA.id, real.slotA.id);
  });

  it('a submission with an out-of-range arrow is rejected outright', () => {
    const { real } = setup();
    assert.equal(m.rebuildMatchFromUnits(real, fd, [{ arrowsA: [10, 10, 99], arrowsB: [9, 9, 9] }]), null);
  });
});
