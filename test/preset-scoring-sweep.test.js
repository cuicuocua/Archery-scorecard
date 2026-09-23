// A sweep, not a unit test. The 80cm scoring bug (v1.28) survived a suite
// with 280 passing tests because every test of scoreFromRadiusUnits fed it
// a hand-written ring class, and every test of ROUND_TYPES checked the
// data. Nobody ever bound the two: no test asked "what does THIS preset
// actually score". These do, for every preset, so a round whose face and
// whose scoring disagree cannot ship again.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

// Every stage of every preset, flattened, with enough context to name it in
// a failure message.
const STAGES = m.ROUND_TYPES.flatMap(r =>
  r.stages.map((st, i) => ({
    id: r.id,
    label: r.label,
    where: r.stages.length > 1 ? `${r.id} stage ${i + 1}` : r.id,
    round: st,
    ringClass: m.roundRingClass(st),
    geom: m.ringGeometry(m.roundRingClass(st)),
  })));

// The scores a face can actually produce, by walking the radius from the
// centre out past the edge of the paper.
function reachableScores(ringClass) {
  const out = new Set();
  for (let d = 0; d <= m.FACE_R + 5; d += 0.25) out.add(m.scoreFromRadiusUnits(d, ringClass).score);
  return out;
}

describe('every preset scores the face it says it has', () => {
  for (const s of STAGES) {
    it(`${s.where}: dead centre is an X`, () => {
      const hit = m.scoreFromRadiusUnits(0, s.ringClass);
      assert.equal(hit.score, 10, `${s.label} should score 10 in the middle`);
      assert.equal(hit.isX, true);
    });

    it(`${s.where}: the outermost printed ring scores ${s.geom.minRing}, not a miss`, () => {
      const outermost = s.geom.specs
        .filter(x => x.score >= s.geom.minRing)
        .reduce((a, b) => (a.outer > b.outer ? a : b));
      // Just inside that ring's outer edge — the last radius that still counts.
      assert.equal(m.scoreFromRadiusUnits(outermost.outer - 0.5, s.ringClass).score, s.geom.minRing,
        `${s.label}: an arrow on the outermost scoring ring must score ${s.geom.minRing}`);
    });

    it(`${s.where}: past the paper is a miss`, () => {
      assert.equal(m.scoreFromRadiusUnits(m.FACE_R + 1, s.ringClass).score, 0);
    });

    // The bug that started this: a face silently unable to produce scores
    // that its rings plainly show.
    it(`${s.where}: produces every score from 10 down to ${s.geom.minRing}`, () => {
      const reachable = reachableScores(s.ringClass);
      for (let score = 10; score >= s.geom.minRing; score--) {
        assert.ok(reachable.has(score),
          `${s.label} cannot score ${score}, but its lowest printed ring is ${s.geom.minRing}`);
      }
    });

    it(`${s.where}: produces nothing below ${s.geom.minRing} except a miss`, () => {
      for (const score of reachableScores(s.ringClass)) {
        assert.ok(score === 0 || score >= s.geom.minRing,
          `${s.label} scored ${score}, below its lowest printed ring ${s.geom.minRing}`);
      }
    });
  }
});

describe('the keypad offers exactly what the face can produce', () => {
  // FITARCO Libro 2 art. 7.2.2.1, on the indoor triples: "la bassa zona di
  // punteggio è pertanto il sei (Azzurro)". On a face whose lowest printed
  // ring is 6, a 5 is not a bad arrow — it is an arrow that cannot exist,
  // and a keypad that accepts one records a score no judge could award.
  for (const s of STAGES) {
    it(`${s.where}: no key scores below ${s.geom.minRing}`, () => {
      const offered = m.keypadKeysFor(s.round).filter(k => k.score > 0).map(k => k.score);
      const tooLow = [...new Set(offered)].filter(score => score < s.geom.minRing).sort((a, b) => b - a);
      assert.deepEqual(tooLow, [],
        `${s.label} offers ${tooLow.join(', ')} but its lowest printed ring is ${s.geom.minRing}`);
    });

    it(`${s.where}: every score the face can produce has a key`, () => {
      const offered = new Set(m.keypadKeysFor(s.round).map(k => k.score));
      for (const score of reachableScores(s.ringClass)) {
        assert.ok(offered.has(score),
          `${s.label} can score ${score} by tapping the face but has no keypad key for it`);
      }
    });

    it(`${s.where}: keeps X and M whatever the face`, () => {
      const keys = m.keypadKeysFor(s.round);
      assert.ok(keys.some(k => k.isX), 'every face has an inner ten');
      assert.ok(keys.some(k => k.score === 0), 'a miss is always possible');
    });
  }
});

describe('every preset is coherent as a round, not just as a face', () => {
  for (const s of STAGES) {
    it(`${s.where}: its ten-ring has a real size on its paper`, () => {
      const r = m.tenRingRadiusCm(s.round);
      const spotR = m.spotFaceCm(s.round.faceCm, m.roundSpotLayout(s.round)) / 2;
      assert.ok(r > 0, `${s.label}: ten-ring radius must be positive`);
      assert.ok(r < spotR, `${s.label}: ten-ring (${r}cm) cannot be as big as the face (${spotR}cm)`);
    });

    it(`${s.where}: a tight group in the middle is modelled near ten`, () => {
      const e = m.expectedScorePerArrow(s.round, 0, 0, 0.05, 0.05);
      assert.ok(e > 9.5, `${s.label}: modelled ${e} for a group on the spot`);
    });
  }

  for (const r of m.ROUND_TYPES.filter(x => !x.editable && x.stages.length === 1)) {
    it(`${r.id}: is recognised as itself by matchedPreset`, () => {
      const found = m.matchedPreset(r.stages[0]);
      assert.ok(found, `${r.label} matches no preset at all`);
      assert.equal(found.id, r.id, `${r.label} is being named "${found.label}"`);
    });
  }
});

describe('the presets do not collide with each other', () => {
  it('no two non-editable presets share a shape AND a length', () => {
    const seen = new Map();
    for (const r of m.ROUND_TYPES.filter(x => !x.editable)) {
      for (const st of r.stages) {
        const key = `${m.roundShapeKey(st)}|${st.arrowsPerEnd * st.ends}`;
        // Multi-stage rounds legitimately repeat a shape; only whole
        // single-stage presets must be distinguishable from one another.
        if (r.stages.length > 1) continue;
        assert.ok(!seen.has(key), `${r.id} is indistinguishable from ${seen.get(key)}`);
        seen.set(key, r.id);
      }
    }
  });

  it('gives every preset a label that survives the round trip to a shape', () => {
    for (const r of m.ROUND_TYPES.filter(x => !x.editable && x.stages.length === 1)) {
      const label = m.roundShapeLabel(r.stages[0]);
      assert.ok(label && label.length, `${r.id} has no shape label`);
    }
  });
});
