// The keypad is a component, and the bug it had was invisible to the
// pure-logic suite: it rendered every key from 10 down to 1 whatever face
// the round was shot on, so an archer on a 40cm triple could tap a 3 that
// the paper cannot award. Tapping the face had always refused those.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { React, mount, loadScorecardModule } = require('./dom.cjs');

const m = loadScorecardModule();

const TRIPLE_18 = { distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20, spotLayout: 'vertical3', ringClass: 'spot6R' };
const FULL_18 = { distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 };
const CUT_80 = { distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12, ringClass: 'outdoor6' };
const FULL_80 = { distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12 };

function keys(round) {
  const pressed = [];
  const ui = mount(React.createElement(m.Keypad, {
    round, onScore: (score, isX) => pressed.push({ score, isX }),
  }));
  return { ui, pressed, labels: ui.buttons() };
}

describe('the keypad shows the keys the face can award', () => {
  it('drops 1 to 5 on a triple, whose lowest printed ring is the six', () => {
    const { ui, labels } = keys(TRIPLE_18);
    assert.deepEqual(labels, ['X', '10', '9', '8', '7', '6', 'M']);
    ui.unmount();
  });

  it('keeps all ten on the plain 40cm face', () => {
    const { ui, labels } = keys(FULL_18);
    assert.deepEqual(labels, ['X', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1', 'M']);
    ui.unmount();
  });

  it('stops at 5 on the six-zone 80cm face', () => {
    const { ui, labels } = keys(CUT_80);
    assert.deepEqual(labels, ['X', '10', '9', '8', '7', '6', '5', 'M']);
    ui.unmount();
  });

  // The v1.28 fix, seen from the other end: the standard 80cm face has to
  // offer the low rings, because it prints them.
  it('offers 1 to 4 on the standard 80cm face', () => {
    const { ui, labels } = keys(FULL_80);
    assert.ok(labels.includes('4') && labels.includes('1'), `got ${labels.join(',')}`);
    ui.unmount();
  });

  it('always keeps X and the miss', () => {
    for (const round of [TRIPLE_18, FULL_18, CUT_80, FULL_80]) {
      const { ui, labels } = keys(round);
      assert.ok(labels.includes('X'), 'every face has an inner ten');
      assert.ok(labels.includes('M'), 'a miss is always possible');
      ui.unmount();
    }
  });

  it('still reports the score and the X flag when a key is pressed', () => {
    const { ui, pressed } = keys(TRIPLE_18);
    ui.click('X');
    ui.click('6');
    ui.click('M');
    assert.deepEqual(pressed, [
      { score: 10, isX: true }, { score: 6, isX: false }, { score: 0, isX: false },
    ]);
    ui.unmount();
  });

  // Tournament match scoring stores no ring class, so it must keep the
  // full keypad rather than silently losing keys.
  it('falls back to the full layout when given no round', () => {
    const { ui, labels } = keys(undefined);
    assert.equal(labels.length, 12);
    assert.ok(labels.includes('1'));
    ui.unmount();
  });
});
