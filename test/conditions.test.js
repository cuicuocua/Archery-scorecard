// Which conditions are worth asking about depends on where the round was
// shot. Wind and sun don't exist in a hall; hall lighting doesn't exist on
// a field. Every indoor session used to be followed by four questions with
// no possible answer.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

const INDOOR_18 = { distanceM: 18, faceCm: 40, arrowsPerEnd: 3, ends: 20 };
const INDOOR_25 = { distanceM: 25, faceCm: 60, arrowsPerEnd: 3, ends: 20 };
const TARGA_70 = { distanceM: 70, faceCm: 122, arrowsPerEnd: 6, ends: 12 };
const TARGA_50 = { distanceM: 50, faceCm: 80, arrowsPerEnd: 6, ends: 12 };

const sessionOf = (rounds, conditions) => ({
  stages: rounds.map(round => ({ round, ends: [] })),
  conditions: conditions || null,
});

describe('roundIsIndoor — read off the shape, since sessions never store the round id', () => {
  it('recognises the two WA indoor shapes', () => {
    assert.equal(m.roundIsIndoor(INDOOR_18), true);
    assert.equal(m.roundIsIndoor(INDOOR_25), true);
  });

  it('does not mistake a short outdoor round for an indoor one', () => {
    assert.equal(m.roundIsIndoor(TARGA_50), false, '50m/80cm is outdoor — longer AND a bigger face');
    assert.equal(m.roundIsIndoor(TARGA_70), false);
    assert.equal(m.roundIsIndoor({ distanceM: 25, faceCm: 122 }), false, 'close but on a full outdoor face');
  });
});

describe('sessionEnvironment', () => {
  it('defaults an indoor-shaped session to indoor, and an outdoor one to outdoor', () => {
    assert.equal(m.sessionEnvironment(sessionOf([INDOOR_18])), 'indoor');
    assert.equal(m.sessionEnvironment(sessionOf([TARGA_70])), 'outdoor');
  });

  // The archer's own answer always wins: 18m shot on the field in summer is
  // outdoor however much its shape looks like a hall round.
  it('an explicit answer overrides the shape, both ways', () => {
    assert.equal(m.sessionEnvironment(sessionOf([INDOOR_18], { environment: 'outdoor' })), 'outdoor');
    assert.equal(m.sessionEnvironment(sessionOf([TARGA_70], { environment: 'indoor' })), 'indoor');
  });

  it('a multi-distance session is indoor only if every stage is', () => {
    assert.equal(m.sessionEnvironment(sessionOf([INDOOR_25, INDOOR_18])), 'indoor', 'WA Combined');
    assert.equal(m.sessionEnvironment(sessionOf([INDOOR_18, TARGA_70])), 'outdoor');
  });

  it('falls back to outdoor rather than throwing on a session with no stages', () => {
    assert.equal(m.sessionEnvironment({}), 'outdoor');
    assert.equal(m.sessionEnvironment(null), 'outdoor');
  });
});

describe('entryEnvironment — a stage is judged on its own shape', () => {
  it('reads the stage, not the session it came from', () => {
    assert.equal(m.entryEnvironment({ round: INDOOR_18, conditions: null }), 'indoor');
    assert.equal(m.entryEnvironment({ round: TARGA_70, conditions: null }), 'outdoor');
  });

  it('still respects a stored answer', () => {
    assert.equal(m.entryEnvironment({ round: INDOOR_18, conditions: { environment: 'outdoor' } }), 'outdoor');
  });
});

describe('conditionDimensionsFor — only what the environment can answer', () => {
  const ids = env => m.conditionDimensionsFor(env).map(d => d.id);

  it('indoors offers light and drops wind and sun', () => {
    assert.deepEqual(ids('indoor'), ['light', 'timeOfDay', 'tags']);
  });

  it('outdoors offers wind and sun and drops light', () => {
    assert.deepEqual(ids('outdoor'), ['wind', 'sun', 'timeOfDay', 'tags']);
  });

  it('time of day and the free tags belong to both', () => {
    for (const env of ['indoor', 'outdoor']) {
      assert.ok(ids(env).includes('timeOfDay'), `${env} should keep timeOfDay`);
      assert.ok(ids(env).includes('tags'), `${env} should keep tags`);
    }
  });

  it('rain is an outdoor tag only', () => {
    const indoorTags = m.CONDITION_TAGS.filter(t => !t.env || t.env === 'indoor').map(t => t.id);
    assert.ok(!indoorTags.includes('pioggia'), 'it does not rain in a hall');
    assert.ok(indoorTags.includes('freddo'), 'unheated halls are very much a thing');
  });
});

describe('createSession defaults the environment from the round that was picked', () => {
  const round = (id, category, stages) => ({ id, category, stages });

  it('an Indoor preset starts indoor', () => {
    const s = m.createSession(round('indoor18', 'Indoor 18m', [INDOOR_18]), {});
    assert.equal(s.conditions.environment, 'indoor');
  });

  it('an outdoor preset starts outdoor', () => {
    const s = m.createSession(round('targa70', 'Targa 122cm', [TARGA_70]), {});
    assert.equal(s.conditions.environment, 'outdoor');
  });

  // "Personalizzata" has no category worth trusting, so it falls back to
  // the shape it was given.
  it('a custom round falls back to its shape', () => {
    const indoorish = m.createSession(round('custom', 'Personalizzata', [INDOOR_18]), {});
    const outdoorish = m.createSession(round('custom', 'Personalizzata', [TARGA_70]), {});
    assert.equal(indoorish.conditions.environment, 'indoor');
    assert.equal(outdoorish.conditions.environment, 'outdoor');
  });

  it('a fresh session carries a light slot alongside the outdoor ones', () => {
    const c = m.emptyConditions();
    assert.deepEqual(Object.keys(c).sort(),
      ['environment', 'light', 'sun', 'tags', 'timeOfDay', 'wind'].sort());
  });
});

describe('scoreByCondition buckets the new dimension like any other', () => {
  const shot = (light, score) => ({
    status: 'completed', round: INDOOR_18,
    conditions: { ...m.emptyConditions(), environment: 'indoor', light },
    ends: [{ index: 0, arrows: [{ score, isX: false, x: null, y: null }] }],
  });
  // Rows come back keyed by the option's LABEL, and a bucket is only
  // reported once it has MIN_SESSIONS_PER_CONDITION sessions behind it —
  // the gate that stopped single sessions being drawn as if they were a
  // measurement. Three each, so both survive it.
  const rows = m.scoreByCondition(
    [shot('buona', 10), shot('buona', 10), shot('buona', 10),
     shot('fioca', 4), shot('fioca', 4), shot('fioca', 4)], 'light');
  const byLabel = Object.fromEntries(rows.map(r => [r.key, r]));

  it('separates the light levels and averages each', () => {
    assert.deepEqual(Object.keys(byLabel).sort(), ['Buona', 'Fioca']);
    assert.equal(byLabel.Buona.count, 3);
    assert.equal(byLabel.Buona.avg, 10);
    assert.equal(byLabel.Fioca.avg, 4);
  });

  it('a light level with too few sessions behind it is not reported at all', () => {
    const thin = m.scoreByCondition([shot('riflessi', 7)], 'light');
    assert.deepEqual(thin, [], 'one session is not an estimate of anything');
  });
});
