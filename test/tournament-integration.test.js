const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();
const individual = m.matchFormatDef('individual');

function participant(n, name, seedScore) { return { id: `p${n}`, name, seedScore }; }

// Plays out a 2-way match decisively: `winner` side gets 10s, the other
// gets 1s, three units, so it's over (6 SP) without needing a shoot-off.
function playDecisively(match, winner) {
  const loser = winner === 'A' ? 'B' : 'A';
  for (let i = 0; i < 3; i++) {
    match = m.recordUnit(match, individual, i, winner, [10, 10, 10]);
    match = m.recordUnit(match, individual, i, loser, [1, 1, 1]);
  }
  return match;
}

describe('a full 4-player standard-format tournament, played end to end', () => {
  it('propagates winners/losers correctly and lands on the right podium', () => {
    const tournament = m.createTournament({
      name: 'Test Cup', date: '2026-01-01', distanceM: 18, faceCm: 40, formatId: 'individual',
      participants: [participant(1, 'Alice', 700), participant(2, 'Bob', 600), participant(3, 'Carol', 500), participant(4, 'Dave', 400)],
      finalFormat: 'standard',
    });

    assert.equal(tournament.rounds.length, 2, 'semifinal + final');
    assert.equal(tournament.rounds[0].length, 2);
    assert.equal(m.tournamentHasStarted(tournament), false);
    assert.equal(m.tournamentPodium(tournament), null);

    // Semifinal 1: seed 1 (Alice) vs seed 4 (Dave) — Alice wins
    let t = m.applyMatchResult(tournament, { kind: 'round', roundIdx: 0, matchIdx: 0 },
      playDecisively(tournament.rounds[0][0], 'A'));
    // Semifinal 2: seed 2 (Bob) vs seed 3 (Carol) — Carol wins
    t = m.applyMatchResult(t, { kind: 'round', roundIdx: 0, matchIdx: 1 },
      playDecisively(t.rounds[0][1], 'B'));

    assert.equal(m.tournamentHasStarted(t), true);
    assert.equal(m.tournamentIsComplete(t), false);

    // Final should now have Alice vs Carol; bronze match should have Dave vs Bob
    const finalMatch = t.rounds[1][0];
    assert.deepEqual([finalMatch.slotA.name, finalMatch.slotB.name].sort(), ['Alice', 'Carol']);
    assert.deepEqual([t.thirdPlaceMatch.slotA.name, t.thirdPlaceMatch.slotB.name].sort(), ['Bob', 'Dave']);

    // Mid-tournament: the final and the bronze match should be the only
    // playable refs left, and nextPlayableRef should find the final first.
    const next = m.nextPlayableRef(t, { kind: 'round', roundIdx: 0, matchIdx: 1 });
    assert.deepEqual(next, { kind: 'round', roundIdx: 1, matchIdx: 0 });

    // Play the bronze match: Dave beats Bob
    const bronzeWinnerIsSlotA = t.thirdPlaceMatch.slotA.name === 'Dave';
    t = m.applyMatchResult(t, { kind: 'thirdPlace' }, playDecisively(t.thirdPlaceMatch, bronzeWinnerIsSlotA ? 'A' : 'B'));

    // Play the final: Alice beats Carol
    const goldWinnerIsSlotA = t.rounds[1][0].slotA.name === 'Alice';
    t = m.applyMatchResult(t, { kind: 'round', roundIdx: 1, matchIdx: 0 },
      playDecisively(t.rounds[1][0], goldWinnerIsSlotA ? 'A' : 'B'));

    assert.equal(m.tournamentIsComplete(t), true);
    const podium = m.tournamentPodium(t);
    assert.equal(podium.gold.name, 'Alice');
    assert.equal(podium.silver.name, 'Carol');
    assert.equal(podium.bronze.name, 'Dave');
    assert.equal(podium.fourth.name, 'Bob');

    // Nothing left to play anywhere in the bracket.
    assert.equal(m.nextPlayableRef(t, null), null);
    assert.ok(m.flatMatchRefs(t).every(ref => !m.isRefPlayable(t, ref)));
  });

  it('a forfeited semifinal still propagates and feeds the bronze match with the actual loser', () => {
    const tournament = m.createTournament({
      name: 'WO Cup', date: '2026-01-01', distanceM: 18, faceCm: 40, formatId: 'individual',
      participants: [participant(1, 'Alice', 700), participant(2, 'Bob', 600), participant(3, 'Carol', 500), participant(4, 'Dave', 400)],
      finalFormat: 'standard',
    });
    const forfeited = m.forfeitMatch(tournament.rounds[0][0], 'A'); // Dave withdraws, Alice advances
    const t = m.applyMatchResult(tournament, { kind: 'round', roundIdx: 0, matchIdx: 0 }, forfeited);
    assert.equal(t.rounds[1][0].slotA?.name === 'Alice' || t.rounds[1][0].slotB?.name === 'Alice', true);
    assert.equal(t.thirdPlaceMatch.slotA?.name === 'Dave' || t.thirdPlaceMatch.slotB?.name === 'Dave', true);
  });
});

describe('a Lancaster-format tournament with a wildcard play-in', () => {
  it('re-ranks the semifinalists, wires the ladder, and the wildcard displaces the original 4th seed', () => {
    const tournament = m.createTournament({
      name: 'Lancaster Cup', date: '2026-01-01', distanceM: 18, faceCm: 40, formatId: 'individual',
      participants: [
        participant(1, 'Alice', 800), participant(2, 'Bob', 700), participant(3, 'Carol', 600), participant(4, 'Dave', 500),
        participant(5, 'Eve', 400), participant(6, 'Frank', 300), participant(7, 'Grace', 200), participant(8, 'Heidi', 100),
      ],
      finalFormat: 'lancaster',
    });
    assert.equal(tournament.rounds.length, 1, 'only the quarterfinal is real bracket play');

    let t = tournament;
    // Play all 4 quarterfinals with the higher seed always winning (so the
    // final ranking matches seed order exactly, easy to assert on).
    for (let i = 0; i < 4; i++) {
      const match = t.rounds[0][i];
      const aIsHigherSeed = t.participants.findIndex(p => p.id === match.slotA.id) < t.participants.findIndex(p => p.id === match.slotB.id);
      t = m.applyMatchResult(t, { kind: 'round', roundIdx: 0, matchIdx: i }, playDecisively(match, aIsHigherSeed ? 'A' : 'B'));
    }

    assert.deepEqual(t.finalStage.sides.map(s => s.name), ['Alice', 'Bob', 'Carol', 'Dave']);
    assert.equal(t.finalStage.match1.slotA.name, 'Dave');
    assert.equal(t.finalStage.match1.slotB.name, 'Carol');

    // Organizer brings back Heidi (already eliminated in the quarterfinal) as a wildcard for Dave's spot.
    const heidi = t.participants.find(p => p.name === 'Heidi');
    assert.ok(m.eligibleLancasterWildcards(t).some(p => p.id === heidi.id));
    const finalStageWithWildcard = m.setLancasterWildcard(t.finalStage, heidi);
    t = { ...t, finalStage: finalStageWithWildcard };
    assert.equal(t.finalStage.playIn.slotA.name, 'Heidi');
    assert.equal(t.finalStage.playIn.slotB.name, 'Dave');
    assert.equal(t.finalStage.match1.slotA, null);

    // Heidi upsets Dave in the play-in — Heidi takes the match1 slot the
    // play-in was feeding; Dave (the play-in's loser) gets no standings
    // entry at all, since this app doesn't track 5th-and-below and Dave's
    // earlier bracket-round loss already placed him.
    t = m.applyMatchResult(t, { kind: 'lancasterPlayIn' }, playDecisively(t.finalStage.playIn, 'A'));
    assert.equal(t.finalStage.match1.slotA.name, 'Heidi');
    assert.equal(t.finalStage.standings.fourth, undefined);

    // Now match1 (Heidi vs Carol) decides who's actually 4th.
    t = m.applyMatchResult(t, { kind: 'lancaster1' }, playDecisively(t.finalStage.match1, 'B'));
    assert.equal(t.finalStage.standings.fourth.name, 'Heidi');
    assert.equal(t.finalStage.match2.slotB.name, 'Carol');
  });
});
