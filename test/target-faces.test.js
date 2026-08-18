// Covers the indoor target-face variants (v1.20), the multi-spot zoom
// (v1.21) and the per-spot aim analysis — all of which shipped without
// automated coverage while the feature was being iterated on.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

const round = (over = {}) => ({
  distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20,
  spotLayout: 'single', ringClass: 'full', ...over,
});

// Arrow x/y are normalized to the radius of the face they were shot at, so
// the two helpers below differ only in what that radius is: a 40cm single
// face has a 20cm radius, while one spot of a 40cm triple sheet is 20cm
// across and so has a 10cm radius. Using the wrong one silently halves
// every distance the assertions talk about.
const SINGLE_R_CM = 20;
const TRIPLE_SPOT_R_CM = 10;
const at = (xCm, yCm, spot) => ({
  score: 9, isX: false, x: xCm / SINGLE_R_CM, y: yCm / SINGLE_R_CM,
  ...(spot == null ? {} : { spot }),
});
const atSpot = (xCm, yCm, spot) => ({
  score: 9, isX: false, x: xCm / TRIPLE_SPOT_R_CM, y: yCm / TRIPLE_SPOT_R_CM, spot,
});

describe('spotOffsets — sheet layouts', () => {
  it('single is one spot at the origin', () => {
    assert.deepEqual(m.spotOffsets('single'), [{ x: 0, y: 0 }]);
  });

  it('vertical3 stacks three spots in a column, evenly spaced, no horizontal drift', () => {
    const o = m.spotOffsets('vertical3');
    assert.equal(o.length, 3);
    assert.ok(o.every(p => p.x === 0), 'a vertical sheet has no horizontal offset');
    assert.equal(o[1].y, 0, 'middle spot is the origin');
    assert.equal(o[0].y, -o[2].y, 'top and bottom are symmetric about it');
  });

  it('triangular3 puts one spot at the apex and two on the base', () => {
    const o = m.spotOffsets('triangular3');
    assert.equal(o.length, 3);
    const apex = o.reduce((a, b) => (b.y < a.y ? b : a));
    assert.equal(apex.x, 0, 'the apex sits on the centre line');
    const base = o.filter(p => p !== apex);
    assert.equal(base[0].y, base[1].y, 'the two base spots are level');
    assert.equal(base[0].x, -base[1].x, 'and symmetric left/right');
  });

  it('spots never overlap — every pair is at least a full face-width apart', () => {
    for (const layout of ['vertical3', 'triangular3']) {
      const o = m.spotOffsets(layout);
      for (let i = 0; i < o.length; i++) {
        for (let j = i + 1; j < o.length; j++) {
          const d = Math.hypot(o[i].x - o[j].x, o[i].y - o[j].y);
          assert.ok(d >= 200, `${layout} spots ${i}/${j} overlap (gap ${d})`);
        }
      }
    }
  });
});

describe('groupStatsBySpot — arrows are never pooled across spots', () => {
  it('splits arrows by their spot index', () => {
    const arrows = [atSpot(0, 0, 0), atSpot(2, 0, 0), atSpot(0, 6, 1), atSpot(-4, 0, 2)];
    const per = m.groupStatsBySpot(round({ spotLayout: 'vertical3', ringClass: 'spot6R' }), arrows);
    assert.equal(per.length, 3);
    assert.equal(per[0].stats.count, 2);
    assert.equal(per[1].stats.count, 1);
    assert.equal(per[2].stats.count, 1);
  });

  it('returns a null-stats entry for a spot with no arrows, not a missing entry', () => {
    const per = m.groupStatsBySpot(round({ spotLayout: 'triangular3', ringClass: 'spot6R' }), [atSpot(0, 0, 0)]);
    assert.equal(per.length, 3);
    assert.equal(per[1].stats, null);
    assert.equal(per[2].stats, null);
  });

  it('a single-spot round yields exactly one entry holding every arrow', () => {
    const per = m.groupStatsBySpot(round(), [at(0, 0), at(1, 1), at(2, 2)]);
    assert.equal(per.length, 1);
    assert.equal(per[0].stats.count, 3);
  });

  // The whole point of the per-spot split: pooling hides opposing biases.
  it('per-spot centroids reveal a bias that the pooled centroid cancels out', () => {
    const r = round({ spotLayout: 'vertical3', ringClass: 'spot6R' });
    // spot 0 groups high, spot 2 groups equally low, spot 1 dead centre.
    const arrows = [atSpot(0, -4, 0), atSpot(0, -4, 0), atSpot(0, 0, 1), atSpot(0, 0, 1), atSpot(0, 4, 2), atSpot(0, 4, 2)];
    const pooled = m.computeGroupStats(arrows, r);
    assert.ok(Math.abs(pooled.cyCm) < 0.01, 'pooled reads as perfectly centred');

    const per = m.groupStatsBySpot(r, arrows);
    assert.ok(per[0].stats.cyCm < -1, 'spot 1 is genuinely high');
    assert.ok(per[2].stats.cyCm > 1, 'spot 3 is genuinely low');
  });
});

describe('tenRingRadiusCm', () => {
  it('is a tenth of the face radius on a full 10-ring face', () => {
    assert.equal(m.tenRingRadiusCm(round()), 2); // 40cm face -> 20cm radius -> 2cm
  });

  it('halves for a compound face', () => {
    assert.equal(m.tenRingRadiusCm(round({ ringClass: 'indoor6C' })), 1);
  });

  it('accounts for a triple spot being half-size paper, rescaled', () => {
    // 20cm spot -> 10cm radius; spot6R's 10-ring is rescaled x2 -> 0.2 of it
    assert.equal(m.tenRingRadiusCm(round({ spotLayout: 'vertical3', ringClass: 'spot6R' })), 2);
    assert.equal(m.tenRingRadiusCm(round({ spotLayout: 'vertical3', ringClass: 'spot6C' })), 1);
  });
});

describe('groupOffsetIsReal — an offset has to clear its own noise', () => {
  it('a tight group well off centre is real', () => {
    const stats = m.computeGroupStats([at(6, 0), at(6.2, 0.1), at(5.8, -0.1), at(6, 0.2)], round());
    assert.equal(m.groupOffsetIsReal(stats), true);
  });

  it('a wide group barely off centre is not', () => {
    const arrows = [at(-8, -8), at(8, 8), at(-8, 8), at(8, -8), at(0.4, 0.4)];
    assert.equal(m.groupOffsetIsReal(m.computeGroupStats(arrows, round())), false);
  });

  it('a single arrow is never enough', () => {
    assert.equal(m.groupOffsetIsReal(m.computeGroupStats([at(9, 9)], round())), false);
  });
});

describe('describeGroupShape', () => {
  const tightCentred = [at(0, 0), at(0.3, 0.2), at(-0.2, 0.1), at(0.1, -0.3)];
  const tightOff = [at(6, 0), at(6.2, 0.2), at(5.9, -0.1), at(6.1, 0.1)];
  const wideCentred = [at(-6, -6), at(6, 6), at(-6, 6), at(6, -6), at(0, 0)];

  it('names the four regimes', () => {
    assert.equal(m.describeGroupShape(m.computeGroupStats(tightCentred, round()), round()).headline, 'Compatto e centrato');
    assert.equal(m.describeGroupShape(m.computeGroupStats(tightOff, round()), round()).headline, 'Compatto ma spostato');
    assert.equal(m.describeGroupShape(m.computeGroupStats(wideCentred, round()), round()).headline, 'Centrato, ma disperso');
  });

  it('"tight" is measured against that face\'s own 10-ring, so compound is judged harder', () => {
    const stats = m.computeGroupStats([at(1.5, 0), at(-1.5, 0), at(0, 1.5), at(0, -1.5)], round());
    assert.equal(m.describeGroupShape(stats, round()).tight, true, 'inside a recurve 2cm 10-ring');
    assert.equal(m.describeGroupShape(stats, round({ ringClass: 'indoor6C' })).tight, false, 'but not a compound 1cm one');
  });

  it('names a scatter axis only when one clearly dominates', () => {
    const vertical = [at(0, -5), at(0, 5), at(0.2, -3), at(-0.2, 3)];
    const round9 = [at(-4, 0), at(4, 0), at(0, -4), at(0, 4)];
    assert.equal(m.describeGroupShape(m.computeGroupStats(vertical, round()), round()).axis, 'verticale');
    assert.equal(m.describeGroupShape(m.computeGroupStats(round9, round()), round()).axis, null);
  });

  // Regression: a group tight enough to read as one hole was being labelled
  // with whichever axis won by a rounding error.
  it('names no axis for a group too tight for direction to mean anything', () => {
    const oneHole = [at(3, 0.001), at(3, -0.001), at(3.0005, 0), at(2.9995, 0)];
    assert.equal(m.describeGroupShape(m.computeGroupStats(oneHole, round()), round()).axis, null);
  });
});

describe('spotsDifferSignificantly / widestSpotGap', () => {
  const r = round({ spotLayout: 'vertical3', ringClass: 'spot6R' });

  it('two tight groups far apart differ', () => {
    const a = m.computeGroupStats([atSpot(0, -4, 0), atSpot(0.1, -4.1, 0), atSpot(-0.1, -3.9, 0)], r);
    const b = m.computeGroupStats([atSpot(0, 4, 0), atSpot(0.1, 4.1, 0), atSpot(-0.1, 3.9, 0)], r);
    assert.equal(m.spotsDifferSignificantly(a, b), true);
  });

  it('two wide groups slightly apart do not', () => {
    const a = m.computeGroupStats([atSpot(-7, -7, 0), atSpot(7, 7, 0), atSpot(-7, 7, 0), atSpot(7, -7, 0)], r);
    const b = m.computeGroupStats([atSpot(-7, -6.5, 0), atSpot(7, 7.5, 0), atSpot(-7, 7.5, 0), atSpot(7, -6.5, 0)], r);
    assert.equal(m.spotsDifferSignificantly(a, b), false);
  });

  it('widestSpotGap finds the largest significant pair, or null when spots agree', () => {
    const spread = m.groupStatsBySpot(r, [
      atSpot(0, -5, 0), atSpot(0.1, -5, 0), atSpot(-0.1, -5, 0),
      atSpot(0, 0, 1), atSpot(0.1, 0, 1), atSpot(-0.1, 0, 1),
      atSpot(0, 5, 2), atSpot(0.1, 5, 2), atSpot(-0.1, 5, 2),
    ]);
    const gap = m.widestSpotGap(spread);
    assert.ok(gap, 'spots this far apart must be reported');
    assert.deepEqual([gap.a, gap.b].sort(), [0, 2], 'the widest pair is top vs bottom');
    assert.ok(Math.abs(gap.gapCm - 10) < 0.5);

    const aligned = m.groupStatsBySpot(r, [
      atSpot(0, 0, 0), atSpot(0.1, 0.1, 0), atSpot(-0.1, -0.1, 0),
      atSpot(0, 0, 1), atSpot(0.1, 0.1, 1), atSpot(-0.1, -0.1, 1),
      atSpot(0, 0, 2), atSpot(0.1, 0.1, 2), atSpot(-0.1, -0.1, 2),
    ]);
    assert.equal(m.widestSpotGap(aligned), null);
  });
});

describe('assessSightAdjustment — graded, not a bare offset', () => {
  // Two full rings of 8 evenly-spaced arrows: both halves of the session
  // have the same centroid, so the group is stable by construction.
  function ring(radiusCm, offsetCm, turns = 2) {
    const out = [];
    for (let t = 0; t < turns; t++) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        out.push(at(offsetCm + radiusCm * Math.cos(a), radiusCm * Math.sin(a)));
      }
    }
    return out;
  }

  it('withholds any verdict until there are enough arrows', () => {
    const a = m.assessSightAdjustment([at(6, 0), at(6, 0), at(6, 0)], round());
    assert.equal(a.verdict, 'insufficient');
    assert.equal(a.needed, 6);
  });

  it('says nothing to correct when the offset is inside its error bars', () => {
    assert.equal(m.assessSightAdjustment(ring(5, 0), round()).verdict, 'centred');
  });

  it('flags a group that moved mid-session rather than averaging the drift', () => {
    const drifted = [...Array(8)].map(() => at(0, 0)).concat([...Array(8)].map(() => at(8, 0)));
    const a = m.assessSightAdjustment(drifted, round());
    assert.equal(a.verdict, 'unstable');
    assert.ok(Math.abs(a.driftCm - 8) < 0.01);
  });

  it('defers to consistency when the offset is smaller than the spread', () => {
    // offset 0.7R clears 2 standard errors but stays inside the group radius
    const a = m.assessSightAdjustment(ring(4, 2.8), round());
    assert.equal(a.verdict, 'spread');
  });

  it('only calls for a correction when the offset is real, stable and beats the spread', () => {
    const tight = [];
    for (let i = 0; i < 12; i++) tight.push(at(6 + (i % 2 ? 0.1 : -0.1), i % 3 ? 0.1 : -0.1));
    const a = m.assessSightAdjustment(tight, round());
    assert.equal(a.verdict, 'adjust');
    assert.ok(Math.abs(a.offsetCm - 6) < 0.3);
  });

  it('returns null when no arrow carries a position (keypad-only session)', () => {
    assert.equal(m.assessSightAdjustment([{ score: 9, isX: false, x: null, y: null }], round()), null);
  });
});

describe('zoom sizing', () => {
  it('a plain recurve face still opens at 1× on the ladder it always had', () => {
    assert.deepEqual(m.zoomLevelsFor(round()), [1, 2, 4]);
    assert.equal(m.defaultZoomFor(round()), 1);
  });

  it('the 80cm outdoor face is unchanged too', () => {
    const r = round({ faceCm: 80, ringClass: 'outdoor6' });
    assert.deepEqual(m.zoomLevelsFor(r), [1, 2, 4]);
    assert.equal(m.defaultZoomFor(r), 1);
  });

  it('compound faces get an extra 8× step, recurve ones do not', () => {
    assert.equal(m.isCompoundRingClass('indoor6C'), true);
    assert.equal(m.isCompoundRingClass('spot6C'), true);
    assert.equal(m.isCompoundRingClass('spot6R'), false);
    assert.deepEqual(m.zoomLevelsFor(round({ ringClass: 'indoor6C' })), [1, 2, 4, 8]);
    assert.deepEqual(m.zoomLevelsFor(round({ spotLayout: 'vertical3', ringClass: 'spot6C' })), [1, 2, 4, 8]);
    assert.deepEqual(m.zoomLevelsFor(round({ spotLayout: 'vertical3', ringClass: 'spot6R' })), [1, 2, 4]);
  });

  it('compound opens zoomed in, because its 10-ring is half the diameter', () => {
    assert.equal(m.defaultZoomFor(round({ ringClass: 'indoor6C' })), 2);
    assert.equal(m.defaultZoomFor(round({ spotLayout: 'vertical3', ringClass: 'spot6C' })), 4);
    assert.equal(m.defaultZoomFor(round({ spotLayout: 'triangular3', ringClass: 'spot6C' })), 2);
  });

  it('a vertical triple opens more zoomed than a triangular one — it renders smaller', () => {
    const vert = round({ spotLayout: 'vertical3', ringClass: 'spot6R' });
    const tri = round({ spotLayout: 'triangular3', ringClass: 'spot6R' });
    assert.equal(m.defaultZoomFor(vert), 2);
    assert.equal(m.defaultZoomFor(tri), 1);
    assert.ok(m.tenRingViewFraction(vert, 1) < m.tenRingViewFraction(tri, 1));
  });

  it('every default lands at or above the recurve-at-1× tap reference', () => {
    const ref = m.tapReferenceFraction();
    for (const r of [
      round(),
      round({ faceCm: 80, ringClass: 'outdoor6' }),
      round({ ringClass: 'indoor6C' }),
      round({ spotLayout: 'vertical3', ringClass: 'spot6R' }),
      round({ spotLayout: 'triangular3', ringClass: 'spot6R' }),
      round({ spotLayout: 'vertical3', ringClass: 'spot6C' }),
      round({ spotLayout: 'triangular3', ringClass: 'spot6C' }),
    ]) {
      const z = m.defaultZoomFor(r);
      assert.ok(m.tenRingViewFraction(r, z) >= ref,
        `${r.spotLayout}/${r.ringClass} at ${z}x is below the tap reference`);
      assert.ok(m.zoomLevelsFor(r).includes(z), 'the default must be an offered level');
    }
  });

  it('zooming in always makes the 10-ring bigger', () => {
    const r = round({ spotLayout: 'vertical3', ringClass: 'spot6C' });
    const fractions = m.zoomLevelsFor(r).map(z => m.tenRingViewFraction(r, z));
    for (let i = 1; i < fractions.length; i++) assert.ok(fractions[i] > fractions[i - 1]);
  });
});

describe('preset naming for the indoor variants', () => {
  const shape = (over) => round(over);

  it('each face variant resolves to its own preset name', () => {
    assert.match(m.roundShapeLabel(shape({ spotLayout: 'vertical3', ringClass: 'spot6R' })), /tripla verticale$/);
    assert.match(m.roundShapeLabel(shape({ spotLayout: 'triangular3', ringClass: 'spot6R' })), /tripla triangolare$/);
    assert.match(m.roundShapeLabel(shape({ spotLayout: 'vertical3', ringClass: 'spot6C' })), /compound\)$/);
    assert.equal(m.roundShapeLabel(shape()), 'Indoor 18m');
  });

  // Regression: Vegas shares distance/face/layout/ring class with the
  // 20-end triangular triple and differs only in length, which sameRound
  // ignores — so it was being displayed under the other round's name.
  it('Vegas keeps its own name despite matching the triangular triple on shape', () => {
    const vegas = shape({ spotLayout: 'triangular3', ringClass: 'spot6R', arrowsPerEnd: 3, ends: 10 });
    assert.equal(m.roundShapeLabel(vegas), 'Vegas 3 punti');
    const full = shape({ spotLayout: 'triangular3', ringClass: 'spot6R', arrowsPerEnd: 3, ends: 20 });
    assert.equal(m.roundShapeLabel(full), 'Indoor 18m — tripla triangolare');
  });

  it('face variants never share a personal-best bucket with the plain face', () => {
    const plain = shape();
    const triple = shape({ spotLayout: 'vertical3', ringClass: 'spot6R' });
    assert.equal(m.sameRound(plain, triple), false);
    assert.notEqual(m.roundShapeKey(plain), m.roundShapeKey(triple));
  });

  it('recurve and compound triples are different rounds despite identical geometry on paper', () => {
    const r = shape({ spotLayout: 'vertical3', ringClass: 'spot6R' });
    const c = shape({ spotLayout: 'vertical3', ringClass: 'spot6C' });
    assert.equal(m.sameRound(r, c), false);
    assert.notEqual(m.roundShapeKey(r), m.roundShapeKey(c));
  });
});
