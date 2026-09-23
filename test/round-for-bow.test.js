// The round picker used to offer every face to every bow, so a compound
// archer scrolled past "tripla verticale" and "tripla verticale (compound)"
// and had to already know which one was theirs. The bow is now asked first
// and the list answers it.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScorecardModule } = require('./load.cjs');

const m = loadScorecardModule();

const byId = id => m.ROUND_TYPES.find(r => r.id === id);
const idsFor = bow => m.roundsForBow(bow).suited.flatMap(g => g.rounds.map(r => r.id));
const othersFor = bow => m.roundsForBow(bow).others.flatMap(g => g.rounds.map(r => r.id));

describe('roundSuitsBow', () => {
  it('keeps the compound faces for compound and away from everyone else', () => {
    assert.equal(m.roundSuitsBow(byId('indoor18SingoloC'), 'compound'), true);
    assert.equal(m.roundSuitsBow(byId('indoor18SingoloC'), 'ricurvo'), false);
    assert.equal(m.roundSuitsBow(byId('indoor18TripleVerticaleC'), 'nudo'), false);
  });

  it('gives barebow the recurve faces, since it shoots the same paper', () => {
    assert.equal(m.roundSuitsBow(byId('indoor18'), 'nudo'), true);
    assert.equal(m.roundSuitsBow(byId('indoor18TripleVerticaleR'), 'nudo'), true);
  });

  it('offers an untagged round to every bow', () => {
    for (const bow of ['ricurvo', 'compound', 'nudo']) {
      assert.equal(m.roundSuitsBow(byId('targa70'), bow), true, `${bow} may shoot 70m`);
      assert.equal(m.roundSuitsBow(byId('custom'), bow), true, `${bow} may shoot a custom round`);
    }
  });

  // Filtering on a question the archer declined to answer would hide rounds
  // for no reason at all.
  it('suits everything when no bow was given', () => {
    for (const r of m.ROUND_TYPES) {
      assert.equal(m.roundSuitsBow(r, null), true, `${r.id} should survive an unspecified bow`);
    }
  });
});

describe('roundsForBow splits the catalogue without losing any of it', () => {
  it('never drops a round: suited + others is always the whole list', () => {
    for (const bow of ['ricurvo', 'compound', 'nudo', null]) {
      const { suited, others } = m.roundsForBow(bow);
      const all = [...suited, ...others].flatMap(g => g.rounds.map(r => r.id));
      assert.equal(all.length, m.ROUND_TYPES.length, `${bow}: no round may vanish`);
      assert.deepEqual([...all].sort(), m.ROUND_TYPES.map(r => r.id).sort());
    }
  });

  it('a compound archer leads with the compound faces, not the recurve ones', () => {
    const suited = idsFor('compound');
    assert.ok(suited.includes('indoor18SingoloC'));
    assert.ok(suited.includes('indoor18TripleTriangolareC'));
    assert.ok(!suited.includes('indoor18'), 'the plain 40cm face is the recurve one');
    assert.ok(othersFor('compound').includes('indoor18'), 'still reachable, just demoted');
  });

  // Vegas is shot by both bows on the same paper: the compound divisions
  // score the inner 10, which is a different face as far as this app is
  // concerned, so each bow gets its own entry.
  it('gives each bow its own Vegas', () => {
    assert.ok(idsFor('compound').includes('vegas3spotC'));
    assert.ok(!idsFor('compound').includes('vegas3spot'));
    for (const bow of ['ricurvo', 'nudo']) {
      assert.ok(idsFor(bow).includes('vegas3spot'), `${bow} shoots the full-10 Vegas`);
      assert.ok(!idsFor(bow).includes('vegas3spotC'));
    }
  });

  it('scores the two Vegas entries differently, which is the whole point', () => {
    const r = byId('vegas3spot').stages[0];
    const c = byId('vegas3spotC').stages[0];
    assert.equal(r.ringClass, 'spot6R');
    assert.equal(c.ringClass, 'spot6C');
    assert.ok(m.isCompoundRingClass(c.ringClass), 'the compound one must use the inner 10');
    assert.ok(!m.isCompoundRingClass(r.ringClass));
    // Same paper, same round length — only the ten-ring differs.
    for (const k of ['distanceM', 'faceCm', 'arrowsPerEnd', 'ends', 'spotLayout']) {
      assert.equal(c[k], r[k], `${k} should match the recurve Vegas`);
    }
  });

  it('a recurve archer leads with the recurve faces', () => {
    const suited = idsFor('ricurvo');
    assert.ok(suited.includes('indoor18'));
    assert.ok(suited.includes('indoor25'));
    assert.ok(!suited.includes('indoor18SingoloC'));
    assert.ok(othersFor('ricurvo').includes('indoor18TripleVerticaleC'));
  });

  it('leaves nothing demoted when the bow is unspecified', () => {
    assert.deepEqual(othersFor(null), []);
    assert.equal(idsFor(null).length, m.ROUND_TYPES.length);
  });

  // The outdoor faces are identical whatever is pointed at them; what
  // differs is which distance a category competes at, and training at any
  // distance is not an error worth hiding a round over.
  it('demotes nothing outdoors for any bow', () => {
    for (const bow of ['ricurvo', 'compound', 'nudo']) {
      const demoted = othersFor(bow).map(id => byId(id));
      assert.ok(demoted.every(r => r.category.startsWith('Indoor')),
        `${bow}: only indoor faces should ever be demoted, got ${othersFor(bow)}`);
    }
  });

  it('always leaves the custom round in reach, whatever the bow', () => {
    for (const bow of ['ricurvo', 'compound', 'nudo', null]) {
      assert.ok(idsFor(bow).includes('custom'), `${bow} must be able to invent a round`);
    }
  });
});

describe('groupRounds', () => {
  it('groups by category in declaration order and keeps every round', () => {
    const groups = m.groupRounds(m.ROUND_TYPES);
    assert.deepEqual(groups, m.ROUND_GROUPS);
    assert.equal(groups.flatMap(g => g.rounds).length, m.ROUND_TYPES.length);
  });

  it('does not invent a heading for a category with nothing left in it', () => {
    const only = m.ROUND_TYPES.filter(r => r.id === 'targa70');
    assert.deepEqual(m.groupRounds(only).map(g => g.category), ['Targa 122cm']);
  });

  it('survives an empty list rather than throwing', () => {
    assert.deepEqual(m.groupRounds([]), []);
  });
});

describe('the bow is asked before the round', () => {
  it('orders the wizard type -> bow -> round -> details', () => {
    assert.deepEqual(m.NEW_SESSION_STEPS, ['type', 'bow', 'round', 'details']);
  });

  it('tags every bow the app offers, so none falls through the filter', () => {
    const tagged = new Set(m.ROUND_TYPES.flatMap(r => r.bows || []));
    for (const b of m.BOW_TYPES) {
      assert.ok(tagged.has(b.id), `${b.id} is offered as a bow but no round is tagged for it`);
    }
  });
});
