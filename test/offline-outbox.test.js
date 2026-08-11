const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

// The outbox is keyed per account: every entry point takes the signed-in
// user's id, so two archers sharing a device never replay each other's
// queued writes. Fixtures below use two distinct ids wherever that matters.
const U = 'user-a';
const OTHER = 'user-b';

describe('offline outbox (readPending/writePending/setPending/clearPending)', () => {
  beforeEach(() => {
    global.localStorage.clear();
  });

  it('round-trips a pending write and reads it back keyed by kind:id', () => {
    m.setPending(U, 'session', 's1', 'upsert', { id: 's1', foo: 'bar' });
    const pending = m.readPending(U);
    assert.deepEqual(pending['session:s1'], { kind: 'session', id: 's1', op: 'upsert', data: { id: 's1', foo: 'bar' } });
  });

  it('clearPending removes just that one entry', () => {
    m.setPending(U, 'session', 's1', 'upsert', { id: 's1' });
    m.setPending(U, 'tournament', 't1', 'upsert', { id: 't1' });
    m.clearPending(U, 'session', 's1');
    const pending = m.readPending(U);
    assert.equal(pending['session:s1'], undefined);
    assert.ok(pending['tournament:t1']);
  });

  it('a later setPending for the same kind:id overwrites the earlier one', () => {
    m.setPending(U, 'session', 's1', 'upsert', { id: 's1', v: 1 });
    m.setPending(U, 'session', 's1', 'upsert', { id: 's1', v: 2 });
    assert.equal(m.readPending(U)['session:s1'].data.v, 2);
  });

  it('readPending never throws on corrupt storage, just returns empty', () => {
    global.localStorage.setItem('archery-scorecard-pending-v1:' + U, 'not json{{{');
    assert.deepEqual(m.readPending(U), {});
  });

  // The reason the key is scoped at all: on a shared device, one archer's
  // queued writes used to be replayed under whoever signed in next, landing
  // in the wrong account.
  it("one account's queued writes are invisible to another on the same device", () => {
    m.setPending(U, 'session', 's1', 'upsert', { id: 's1', total: 999 });
    assert.deepEqual(m.readPending(OTHER), {});
    assert.ok(m.readPending(U)['session:s1']);
  });

  it('adoptLegacyPending moves the old un-scoped queue to the first account that signs in, once', () => {
    global.localStorage.setItem('archery-scorecard-pending-v1', JSON.stringify({
      'session:old': { kind: 'session', id: 'old', op: 'upsert', data: { id: 'old' } },
    }));

    m.adoptLegacyPending(U);
    assert.ok(m.readPending(U)['session:old'], 'first account inherits the legacy queue');

    m.adoptLegacyPending(OTHER);
    assert.deepEqual(m.readPending(OTHER), {}, 'the next account gets nothing — the legacy key is consumed');
  });
});

describe('applyPending — overlays outbox writes onto freshly-loaded remote data', () => {
  beforeEach(() => {
    global.localStorage.clear();
  });

  // applyPending resolves normalize from the kind rather than taking it as an
  // argument, so overlaid items come back normalized — a session gains its
  // `stages` wrapper. Assertions below check the fields under test rather
  // than the whole object.
  it('overlays a pending upsert for an item the server also returned (outbox wins)', () => {
    m.setPending(U, 'session', 's1', 'upsert', { id: 's1', total: 999 });
    const loaded = [{ id: 's1', total: 10 }, { id: 's2', total: 20 }];
    const result = m.applyPending(U, loaded, 'session');
    assert.equal(result.find(x => x.id === 's1').total, 999);
    assert.deepEqual(result.find(x => x.id === 's2'), { id: 's2', total: 20 });
  });

  it('adds a pending upsert for an item the server never got at all (device still offline at boot)', () => {
    m.setPending(U, 'session', 's3', 'upsert', { id: 's3', total: 5 });
    const loaded = [{ id: 's1', total: 10 }];
    const result = m.applyPending(U, loaded, 'session');
    assert.equal(result.length, 2);
    assert.ok(result.find(x => x.id === 's3'));
  });

  it('a pending delete removes the item even though the server still has it', () => {
    m.setPending(U, 'session', 's1', 'delete', null);
    const loaded = [{ id: 's1' }, { id: 's2' }];
    const result = m.applyPending(U, loaded, 'session');
    assert.deepEqual(result.map(x => x.id), ['s2']);
  });

  it('is a no-op passthrough when the outbox is empty', () => {
    const loaded = [{ id: 's1' }];
    assert.deepEqual(m.applyPending(U, loaded, 'session'), loaded);
  });

  it('only overlays entries of the matching kind — a pending tournament write never touches session data', () => {
    m.setPending(U, 'tournament', 't1', 'upsert', { id: 't1', total: 1 });
    const loaded = [{ id: 's1', total: 10 }];
    assert.deepEqual(m.applyPending(U, loaded, 'session'), loaded);
  });

  it("never overlays another account's queued writes", () => {
    m.setPending(OTHER, 'session', 's9', 'upsert', { id: 's9', total: 1 });
    const loaded = [{ id: 's1', total: 10 }];
    assert.deepEqual(m.applyPending(U, loaded, 'session'), loaded);
  });
});
