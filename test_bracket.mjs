// Bracket/match engine check — `node test_bracket.mjs`.
//
// The engine (seeding, byes, set play, winner propagation, the three podium
// formats) is the only part of this app where a bug silently produces a
// plausible-looking wrong result instead of an error. This drives it
// headlessly for every final format at every field size and asserts each
// tournament can actually be played to a podium.
//
// It bundles ArcheryScorecard.jsx through esbuild first because the file is
// JSX; every npm dependency stays external, so nothing here renders.

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

// Emitted under node_modules/ (already gitignored) rather than a system temp
// dir, so node can still resolve the externalised react/recharts/supabase
// imports by walking up to this repo's own node_modules.
const out = 'node_modules/.cache/scorecard-engine.mjs';
mkdirSync('node_modules/.cache', { recursive: true });
execSync(`npx esbuild ArcheryScorecard.jsx --bundle --format=esm --packages=external --outfile=${out}`,
  { stdio: ['ignore', 'ignore', 'inherit'] });

const { __engine: E } = await import('./'+out);
const fd = E.matchFormatDef('individual');
const arrows = E.arrowsPerUnit(fd);

// Plays a 2-way match to completion with side A always outscoring B.
function playMatch(match) {
  let m = match;
  for (let u = 0; u < fd.units && m.status !== 'completed'; u++) {
    m = E.recordUnit(m, fd, u, 'A', Array(arrows).fill(10));
    m = E.recordUnit(m, fd, u, 'B', Array(arrows).fill(5));
  }
  return m;
}

// Repeatedly opens whatever the bracket says is playable until nothing is —
// exactly the loop a scorer performs, and the only way a deadlock shows up.
function playThrough(finalFormat, n) {
  const participants = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seedScore: 600 - i }));
  let t = E.createTournament({ name: 'T', date: '2026-01-01', distanceM: 70, faceCm: 122, formatId: 'individual', participants, finalFormat });

  for (let guard = 0; guard < 100; guard++) {
    const [ref] = E.flatMatchRefs(t).filter(r => E.isRefPlayable(t, r));
    if (!ref) break;
    if (ref.kind === 'threeFinal') {
      let f = t.finalStage.final;
      if (f.status === 'runoff') {
        f = E.applyThreeWayRunoffUpdate(f, playMatch(f.runoff));
      } else {
        for (let u = 0; u < fd.units && ['pending', 'in_progress'].includes(f.status); u++) {
          [0, 1, 2].forEach(i => { f = E.record3WayUnit(f, fd, u, i, Array(arrows).fill(10 - i * 2)); });
        }
      }
      t = E.applyMatchResult(t, ref, f);
    } else {
      t = E.applyMatchResult(t, ref, playMatch(E.resolveMatchRef(t, ref).match));
    }
  }
  return t;
}

let failures = 0;
for (const finalFormat of ['standard', 'threeway', 'lancaster']) {
  for (let n = 2; n <= 8; n++) {
    const t = playThrough(finalFormat, n);
    const podium = E.tournamentPodium(t);
    const ok = E.tournamentIsComplete(t) && podium && podium.gold;
    if (!ok) { failures++; console.error(`FAIL  ${finalFormat} n=${n} — no podium; bracket has no playable match left`); }
    else console.log(`ok    ${finalFormat} n=${n} — ${podium.gold.name}`);
  }
}

function check(name, ok, detail) {
  if (ok) console.log(`ok    ${name}`);
  else { failures++; console.error(`FAIL  ${name} — ${detail}`); }
}

// A field of 3 has no 4th place to award: the empty bracket slot is a bye,
// and a bye has no loser. Both custom final formats used to deadlock here.
for (const finalFormat of ['threeway', 'lancaster']) {
  const podium = E.tournamentPodium(playThrough(finalFormat, 3));
  const named = [podium.gold, podium.silver, podium.bronze].filter(Boolean).map(p => p.name);
  check(`${finalFormat} n=3 podium — 3 places, no 4th`,
    named.length === 3 && new Set(named).size === 3 && !podium.fourth,
    `got ${JSON.stringify(named)} + fourth=${podium.fourth?.name ?? null}`);
}

// Correcting a confirmed set must not leave a downstream match holding a
// result that belongs to someone no longer in it.
{
  const t0 = playThrough('standard', 4);
  let sf = t0.rounds[0][0];
  for (let u = 0; u < 3; u++) {
    sf = E.recordUnit(sf, fd, u, 'A', Array(arrows).fill(5));
    sf = E.recordUnit(sf, fd, u, 'B', Array(arrows).fill(10));
  }
  const t1 = E.applyMatchResult(t0, { kind: 'round', roundIdx: 0, matchIdx: 0 }, sf);
  const final = t1.rounds[1][0];
  check('correction — downstream final reset, not left half-won',
    final.winnerSlot === null && final.units.length === 0 && final.status === 'pending',
    `final is '${final.status}' carrying winnerSlot ${JSON.stringify(final.winnerSlot)} and ${final.units.length} sets`);
  check('correction — corrected winner is now in the final',
    final.slotA?.id === E.winnerOf(sf).id,
    `final.slotA is ${final.slotA?.name}, expected ${E.winnerOf(sf).name}`);
  check('correction — bronze match re-fed with the new semifinal loser',
    t1.thirdPlaceMatch.slotA?.id === E.loserOf(sf).id,
    `bronze slotA is ${t1.thirdPlaceMatch.slotA?.name}, expected ${E.loserOf(sf).name}`);
  // The whole point of gating invalidation on "did the winner change": a
  // scorer re-confirming the same result must not wipe the rest of the draw.
  const t2 = E.applyMatchResult(t0, { kind: 'round', roundIdx: 0, matchIdx: 0 }, t0.rounds[0][0]);
  check('re-confirming an unchanged result preserves the played final',
    t2.rounds[1][0].status === 'completed' && E.tournamentPodium(t2)?.gold,
    `final became '${t2.rounds[1][0].status}'`);
}

// The 3-way final's silver/bronze runoff starts at the set points the two
// archers already earned against each other. recordUnit rebuilds cumSp from
// the units array, so the carry-over has to survive the first end recorded.
{
  const participants = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seedScore: 600 - i }));
  let t = E.createTournament({ name: 'T', date: '2026-01-01', distanceM: 70, faceCm: 122, formatId: 'individual', participants, finalFormat: 'threeway' });
  for (let pass = 0; pass < 2; pass++) {
    for (const r of E.flatMatchRefs(t).filter(r => E.isRefPlayable(t, r) && r.kind !== 'threeFinal')) {
      t = E.applyMatchResult(t, r, playMatch(E.resolveMatchRef(t, r).match));
    }
  }
  // Let each archer take different ends so the two non-winners carry points.
  const endWinner = [0, 1, 2, 0, 0];
  let f = t.finalStage.final;
  for (let u = 0; u < 5 && ['pending', 'in_progress'].includes(f.status); u++) {
    [0, 1, 2].forEach(i => { f = E.record3WayUnit(f, fd, u, i, Array(arrows).fill(i === endWinner[u] ? 10 : 5)); });
  }
  const seededA = f.runoff.cumSpA, seededB = f.runoff.cumSpB;
  const afterOneEnd = E.recordUnit(E.recordUnit(f.runoff, fd, 0, 'A', Array(arrows).fill(10)), fd, 0, 'B', Array(arrows).fill(5));
  check('3-way runoff carries its set points into the first end',
    seededA > 0 && afterOneEnd.cumSpA === seededA + 2 && afterOneEnd.cumSpB === seededB,
    `seeded ${seededA}-${seededB}, after one end ${afterOneEnd.cumSpA}-${afterOneEnd.cumSpB}, expected ${seededA + 2}-${seededB}`);
}

// A 3-competitor Lancaster ladder has an empty 4th slot; anything reading a
// name off it crashes the page.
check('lancaster n=3 leaves no ladder slot that reads as a competitor',
  (() => {
    const participants = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seedScore: 600 - i }));
    const t = E.createTournament({ name: 'T', date: '2026-01-01', distanceM: 70, faceCm: 122, formatId: 'individual', participants, finalFormat: 'lancaster' });
    return t.finalStage.sides[3] === null || t.finalStage.sides[3] === undefined;
  })(),
  'expected sides[3] to be absent so the wildcard control can bail out');

assert.equal(failures, 0, `${failures} engine check(s) failed`);
console.log('\nall engine checks passed');
