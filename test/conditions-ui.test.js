// The screen the complaint was about: after finishing a round, the app
// asked about wind and the position of the sun regardless of whether the
// round had been shot in a hall.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { React, mount, loadScorecardModule } = require('./dom.cjs');

const m = loadScorecardModule();

const INDOOR_18 = { distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 };
const TARGA_70 = { distanceM: 70, faceCm: 122, arrowsPerEnd: 6, ends: 12 };

function sessionOf(round, conditions) {
  return {
    id: 's1', status: 'completed',
    stages: [{ round, ends: [] }],
    conditions: { ...m.emptyConditions(), ...(conditions || {}) },
  };
}

// ConditionsEditor is controlled by its parent, so the test holds the state
// the real screens hold and exposes the latest value for assertions.
function mountEditor(initial) {
  const box = { session: initial };
  function Harness() {
    const [session, setSession] = React.useState(initial);
    box.session = session;
    return React.createElement(m.ConditionsEditor, {
      session,
      onUpdate: (fn) => setSession((s) => fn(s)),
    });
  }
  return { ui: mount(React.createElement(Harness)), box };
}

describe('after an indoor round, the app asks indoor questions', () => {
  it('offers lighting and never mentions wind or the sun', () => {
    const { ui } = mountEditor(sessionOf(INDOOR_18, { environment: 'indoor' }));
    assert.ok(ui.has('Illuminazione'), 'an indoor round should be asked about the hall lighting');
    assert.ok(!ui.has('Vento'), 'there is no wind in a hall');
    assert.ok(!ui.has('Posizione del sole'), 'there is no sun in a hall');
    ui.unmount();
  });

  it('drops rain from the free tags but keeps the ones that still apply', () => {
    const { ui } = mountEditor(sessionOf(INDOOR_18, { environment: 'indoor' }));
    assert.ok(!ui.has('Pioggia'), 'it does not rain indoors');
    assert.ok(ui.has('Freddo'), 'unheated halls are cold');
    assert.ok(ui.has('Stanchezza'), 'fatigue is not weather');
    ui.unmount();
  });

  it('still asks the questions that apply everywhere', () => {
    const { ui } = mountEditor(sessionOf(INDOOR_18, { environment: 'indoor' }));
    assert.ok(ui.has('Momento della giornata'));
    assert.ok(ui.has('Ambiente'), 'the environment itself is always changeable');
    ui.unmount();
  });
});

describe('after an outdoor round, nothing changes from before', () => {
  it('offers wind and sun, and does not ask about hall lighting', () => {
    const { ui } = mountEditor(sessionOf(TARGA_70, { environment: 'outdoor' }));
    assert.ok(ui.has('Vento'));
    assert.ok(ui.has('Posizione del sole'));
    assert.ok(ui.has('Pioggia'));
    assert.ok(!ui.has('Illuminazione'), 'a field has no hall lighting to rate');
    ui.unmount();
  });
});

describe('a session with no stored environment is read off its shape', () => {
  it('an 18m round defaults to the indoor questions', () => {
    const { ui } = mountEditor(sessionOf(INDOOR_18, { environment: null }));
    assert.ok(ui.has('Illuminazione'));
    assert.ok(!ui.has('Vento'));
    ui.unmount();
  });

  it('a 70m round defaults to the outdoor ones', () => {
    const { ui } = mountEditor(sessionOf(TARGA_70, { environment: null }));
    assert.ok(ui.has('Vento'));
    assert.ok(!ui.has('Illuminazione'));
    ui.unmount();
  });
});

describe('correcting the environment', () => {
  // 18m shot on the field in summer: the shape says hall, the archer says
  // otherwise, and the archer wins.
  it('switching an indoor-shaped session to outdoor brings back wind and sun', () => {
    const { ui, box } = mountEditor(sessionOf(INDOOR_18, { environment: 'indoor' }));
    assert.ok(!ui.has('Vento'), 'fixture: should start indoors');
    ui.click('All’aperto');
    assert.equal(box.session.conditions.environment, 'outdoor');
    assert.ok(ui.has('Vento'));
    assert.ok(ui.has('Posizione del sole'));
    assert.ok(!ui.has('Illuminazione'));
    ui.unmount();
  });

  // Answers that cannot be true in the new environment are dropped rather
  // than left in the record for the analysis to average over later.
  it('switching to indoor clears the wind, the sun and the rain tag', () => {
    const { ui, box } = mountEditor(sessionOf(TARGA_70, {
      environment: 'outdoor', wind: 'forte', sun: 'controluce', tags: ['pioggia', 'freddo'],
    }));
    ui.click('Al chiuso');
    const c = box.session.conditions;
    assert.equal(c.environment, 'indoor');
    assert.equal(c.wind, null, 'a wind reading cannot survive a move indoors');
    assert.equal(c.sun, null);
    assert.deepEqual(c.tags, ['freddo'], 'rain goes, cold stays');
    ui.unmount();
  });

  it('switching back to outdoor clears the lighting answer', () => {
    const { ui, box } = mountEditor(sessionOf(INDOOR_18, { environment: 'indoor', light: 'fioca' }));
    ui.click('All’aperto');
    assert.equal(box.session.conditions.light, null);
    ui.unmount();
  });
});
