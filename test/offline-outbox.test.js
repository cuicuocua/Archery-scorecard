const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

describe('offline outbox (readPending/writePending/setPending/clearPending)', () => {
  beforeEach(() => {
    global.localStorage.clear();
  });

  it('round-trips a pending write and reads it back keyed by kind:id', () => {
    m.setPending('session', 's1', 'upsert', { id: 's1', foo: 'bar' });
    const pending = m.readPending();
    assert.deepEqual(pending['session:s1'], { kind: 'session', id: 's1', op: 'upsert', data: { id: 's1', foo: 'bar' } });
  });

  it('clearPending removes just that one entry', () => {
    m.setPending('session', 's1', 'upsert', { id: 's1' });
    m.setPending('tournament', 't1', 'upsert', { id: 't1' });
    m.clearPending('session', 's1');
    const pending = m.readPending();
    assert.equal(pending['session:s1'], undefined);
    assert.ok(pending['tournament:t1']);
  });

  it('a later setPending for the same kind:id overwrites the earlier one', () => {
    m.setPending('session', 's1', 'upsert', { id: 's1', v: 1 });
    m.setPending('session', 's1', 'upsert', { id: 's1', v: 2 });
    const pending = m.readPending();
    assert.equal(pending['session:s1'].data.v, 2);
  });

  it('readPending never throws on corrupt storage, just returns empty', () => {
    global.localStorage.setItem('archery-scorecard-pending-v1', 'not json{{{');
    assert.deepEqual(m.readPending(), {});
  });
});

describe('applyPending — overlays outbox writes onto freshly-loaded remote data', () => {
  beforeEach(() => {
    global.localStorage.clear();
  });

  const normalize = (data) => data; // sessions/tournaments normalize is identity for this test's plain fixtures

  it('overlays a pending upsert for an item the server also returned (outbox wins)', () => {
    m.setPending('session', 's1', 'upsert', { id: 's1', total: 999 });
    const loaded = [{ id: 's1', total: 10 }, { id: 's2', total: 20 }];
    const result = m.applyPending(loaded, 'session', normalize);
    assert.deepEqual(result.find(x => x.id === 's1'), { id: 's1', total: 999 });
    assert.deepEqual(result.find(x => x.id === 's2'), { id: 's2', total: 20 });
  });

  it('adds a pending upsert for an item the server never got at all (device still offline at boot)', () => {
    m.setPending('session', 's3', 'upsert', { id: 's3', total: 5 });
    const loaded = [{ id: 's1', total: 10 }];
    const result = m.applyPending(loaded, 'session', normalize);
    assert.equal(result.length, 2);
    assert.ok(result.find(x => x.id === 's3'));
  });

  it('a pending delete removes the item even though the server still has it', () => {
    m.setPending('session', 's1', 'delete', null);
    const loaded = [{ id: 's1' }, { id: 's2' }];
    const result = m.applyPending(loaded, 'session', normalize);
    assert.deepEqual(result.map(x => x.id), ['s2']);
  });

  it('is a no-op passthrough when the outbox is empty', () => {
    const loaded = [{ id: 's1' }];
    assert.deepEqual(m.applyPending(loaded, 'session', normalize), loaded);
  });

  it('only overlays entries of the matching kind — a pending tournament write never touches session data', () => {
    m.setPending('tournament', 't1', 'upsert', { id: 't1', total: 1 });
    const loaded = [{ id: 's1', total: 10 }];
    const result = m.applyPending(loaded, 'session', normalize);
    assert.deepEqual(result, loaded);
  });
});
