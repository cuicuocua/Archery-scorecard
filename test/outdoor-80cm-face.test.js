// v1.16 declared "the real 80cm competition face only prints scoring rings
// 5-10" and gave Targa 50m/40m/30m ringClass 'outdoor6'. FITARCO Libro 2
// art. 7.2.2 lists TWO 80cm faces, and art. 7.2.3 makes the full ten-ring
// one the default at those distances: "Per le distanze di 50, 40 e 30
// metri, si userà il bersaglio da 80 cm". The six-zone one is "per
// disposizione multipla" and art. 7.2.2.1 says it only "possono essere
// usate" there. So every arrow in the blue/black/white outer bands at 50m
// was being recorded as a miss.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();
const byId = id => m.ROUND_TYPES.find(r => r.id === id);

// Radius in the 0..100 unit frame scoreFromRadiusUnits works in; RING_SPECS
// puts the 4-ring's outer edge at 70 and the 1-ring's at 100.
const scoreAt = (d, ringClass) => m.scoreFromRadiusUnits(d, ringClass).score;

describe('the standard 80cm face scores all ten rings', () => {
  it('scores a 1, 2, 3 and 4 instead of calling them misses', () => {
    assert.equal(scoreAt(95, 'full'), 1);
    assert.equal(scoreAt(85, 'full'), 2);
    assert.equal(scoreAt(75, 'full'), 3);
    assert.equal(scoreAt(65, 'full'), 4);
  });

  it('is what Targa 50m, 40m and 30m now use', () => {
    for (const id of ['targa50', 'targa40', 'targa30']) {
      const st = byId(id).stages[0];
      assert.equal(st.faceCm, 80, `${id} fixture`);
      assert.equal(st.ringClass, undefined,
        `${id} must be the plain 80cm face — art. 7.2.3 makes it the default`);
    }
  });

  // The regression itself: an arrow in the outer band on the default face.
  it('does not silently turn an outer-band arrow at 50m into a zero', () => {
    const round = byId('targa50').stages[0];
    assert.equal(scoreAt(95, m.roundRingClass(round)), 1,
      'a 1 at 50m is a 1, not a miss');
  });
});

describe('the six-zone 80cm face still exists and still cuts', () => {
  it('reports a miss below ring 5, which is what the paper does', () => {
    assert.equal(scoreAt(65, 'outdoor6'), 0, 'no 4 ring is printed on it');
    assert.equal(scoreAt(95, 'outdoor6'), 0);
    assert.equal(scoreAt(55, 'outdoor6'), 5, 'but a 5 is still a 5');
    assert.equal(scoreAt(15, 'outdoor6'), 9);
  });

  it('is reachable as its own set of rounds', () => {
    for (const id of ['targa50Multi', 'targa40Multi', 'targa30Multi']) {
      const st = byId(id).stages[0];
      assert.equal(st.ringClass, 'outdoor6', `${id} keeps the cut face`);
      assert.equal(st.faceCm, 80);
    }
  });

  it('is offered to every bow, since art. 7.2.3 gives it to youth recurve too', () => {
    for (const bow of ['ricurvo', 'compound', 'nudo']) {
      assert.ok(m.roundSuitsBow(byId('targa30Multi'), bow), `${bow} may shoot it`);
    }
  });
});

describe('the two 80cm faces stay separate everywhere it matters', () => {
  // Same distance, same paper size, different scoring floor — pooling their
  // scores would compare rounds that are not the same challenge.
  it('are different round shapes, so they never share a personal-best bucket', () => {
    const plain = byId('targa50').stages[0];
    const cut = byId('targa50Multi').stages[0];
    assert.notEqual(m.roundShapeKey(plain), m.roundShapeKey(cut));
  });

  it('each still matches its own preset by name', () => {
    assert.equal(m.matchedPreset(byId('targa50').stages[0]).id, 'targa50');
    assert.equal(m.matchedPreset(byId('targa50Multi').stages[0]).id, 'targa50Multi');
  });

  // Stages snapshot their round config, so a session recorded before this
  // fix keeps ringClass 'outdoor6' and must keep being read as the cut
  // face — its scores were entered under those rules.
  it('reads an already-recorded six-zone stage as the cut face, not the new default', () => {
    const legacy = m.normalizeSession({
      id: 's', stages: [{
        round: { label: 'Targa 50m', distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12, ringClass: 'outdoor6' },
        ends: [],
      }],
    });
    assert.equal(m.roundRingClass(legacy.stages[0].round), 'outdoor6',
      'history must not be silently reinterpreted');
  });
});
