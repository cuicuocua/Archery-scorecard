// Driving the real wizard, because the ordering of its steps and the
// filtering of its list only exist in the component.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { React, mount, loadScorecardModule } = require('./dom.cjs');

const m = loadScorecardModule();

// Returns the mounted wizard plus whatever it eventually creates, so a test
// can walk all the way to "Inizia volée" and inspect the session.
function mountWizard() {
  const box = { created: null };
  const ui = mount(React.createElement(m.NewSessionScreen, {
    onCreate: (s) => { box.created = s; },
    onCancel: () => { box.cancelled = true; },
  }));
  return { ui, box };
}

// A round button's text is its label with the summary line glued straight
// on, and several labels are prefixes of others ("Vegas 3 punti" of "Vegas
// 3 punti (compound)"). The summary always opens with the distance, so a
// digit right after the label is the boundary that tells them apart.
const roundButton = (ui, label) => ui.buttons().find(
  b => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d`).test(b));
const hasRound = (ui, label) => !!roundButton(ui, label);
function clickRound(ui, label) {
  const full = roundButton(ui, label);
  if (!full) throw new Error(`no round ${JSON.stringify(label)}; have: ${JSON.stringify(ui.buttons())}`);
  return ui.click(full); // exact text now, so no prefix can steal the click
}

// type -> bow, the two steps every test has to get past.
function startWith(bowLabel) {
  const { ui, box } = mountWizard();
  ui.click('Allenamento');
  assert.ok(ui.has('Con che arco?'), 'the bow should be asked before the round');
  ui.click(bowLabel);
  assert.ok(ui.has('Che prova?'), `picking ${bowLabel} should land on the round list`);
  return { ui, box };
}

describe('the wizard asks for the bow before the round', () => {
  it('goes type -> bow -> round -> details', () => {
    const { ui } = mountWizard();
    assert.ok(ui.has('Che tipo di sessione?'));
    ui.click('Allenamento');
    assert.ok(ui.has('Con che arco?'), 'bow comes second now, not third');
    ui.click('Ricurvo');
    assert.ok(ui.has('Che prova?'));
    ui.click('Targa 70m');
    assert.ok(ui.has('Ultimi dettagli'), 'a fixed round goes straight on to the details');
    ui.unmount();
  });

  it('walks back out of the round list to the bow, not to the session type', () => {
    const { ui } = startWith('Compound');
    ui.click('Indietro');
    assert.ok(ui.has('Con che arco?'));
    ui.unmount();
  });
});

describe('the round list answers the bow it was given', () => {
  it('a compound archer is offered the compound faces first', () => {
    const { ui } = startWith('Compound');
    assert.ok(hasRound(ui, 'Indoor 18m — singolo (compound)'));
    assert.ok(hasRound(ui, 'Indoor 18m — tripla triangolare (compound)'));
    ui.unmount();
  });

  // Vegas is shot on the same paper by both bows and scored differently,
  // so each has its own entry and each archer should see only theirs.
  it('gets the compound Vegas, not the recurve one', () => {
    const { ui } = startWith('Compound');
    assert.ok(hasRound(ui, 'Vegas 3 punti (compound)'), 'compound shoots Vegas too');
    assert.ok(!hasRound(ui, 'Vegas 3 punti'), 'but not on the full-10 face');
    ui.unmount();
  });

  it('and is not shown the recurve ones in the main list', () => {
    const { ui } = startWith('Compound');
    assert.ok(!hasRound(ui, 'Indoor 18m'), 'the full-10 40cm face belongs to recurve');
    assert.ok(!hasRound(ui, 'Indoor 18m — tripla verticale'), 'the recurve triple likewise');
    ui.unmount();
  });

  it('a recurve archer gets the mirror image', () => {
    const { ui } = startWith('Ricurvo');
    assert.ok(hasRound(ui, 'Vegas 3 punti'));
    assert.ok(hasRound(ui, 'Indoor 18m'));
    assert.ok(!ui.has('(compound)'), 'no compound face belongs in a recurve list');
    ui.unmount();
  });

  it('barebow is offered the recurve faces, not a list of its own', () => {
    const { ui } = startWith('Nudo');
    assert.ok(hasRound(ui, 'Vegas 3 punti'));
    assert.ok(!ui.has('(compound)'));
    ui.unmount();
  });

  it('leaves the outdoor rounds alone for every bow', () => {
    for (const bow of ['Ricurvo', 'Compound', 'Nudo']) {
      const { ui } = startWith(bow);
      for (const label of ['Targa 90m', 'Targa 70m', 'Targa 50m', 'Personalizzata']) {
        assert.ok(ui.has(label), `${bow} should still be offered ${label}`);
      }
      ui.unmount();
    }
  });

  it('filters nothing when the archer declines to say which bow', () => {
    const { ui } = mountWizard();
    ui.click('Allenamento');
    ui.click('Non specificato');
    assert.ok(ui.has('Che prova?'));
    assert.ok(hasRound(ui, 'Indoor 18m — singolo (compound)'));
    assert.ok(hasRound(ui, 'Vegas 3 punti'), 'both families are on offer');
    assert.ok(hasRound(ui, 'Vegas 3 punti (compound)'));
    assert.ok(!ui.has('Altre prove'), 'nothing is demoted, so there is nothing to disclose');
    ui.unmount();
  });
});

describe('the other bow’s faces stay reachable', () => {
  it('opens a submenu holding exactly what was demoted', () => {
    const { ui } = startWith('Compound');
    assert.ok(ui.has('Altre prove'), 'the escape hatch has to be visible');
    assert.ok(!hasRound(ui, 'Vegas 3 punti'), 'closed to begin with');
    ui.click('Altre prove');
    assert.ok(hasRound(ui, 'Vegas 3 punti'), 'opening it reveals the recurve faces');
    assert.ok(hasRound(ui, 'Indoor 18m'));
    ui.unmount();
  });

  it('lets an archer actually start on the other bow’s face', () => {
    const { ui, box } = startWith('Compound');
    ui.click('Altre prove');
    clickRound(ui, 'Vegas 3 punti');
    assert.ok(ui.has('Ultimi dettagli'), 'an off-spec face is a real choice, not a dead end');
    ui.click('Inizia volée');
    assert.equal(box.created.bowType, 'compound', 'the bow is what the archer said it was');
    assert.equal(box.created.stages[0].round.distanceM, 18);
    assert.equal(box.created.stages[0].round.ends, 10, 'Vegas is the 30-arrow round');
    assert.equal(box.created.stages[0].round.ringClass, 'spot6R',
      'the recurve Vegas keeps its own scoring even when a compound archer picks it');
    ui.unmount();
  });

  // Going back to correct the bow must not hide a round that is already
  // ticked, or the tick becomes invisible and the screen looks empty.
  it('auto-opens the submenu when the round already chosen is on the wrong side', () => {
    const { ui } = startWith('Ricurvo');
    clickRound(ui, 'Vegas 3 punti');
    ui.click('Indietro');      // back to the round list
    ui.click('Indietro');      // back to the bow
    ui.click('Compound');
    assert.ok(hasRound(ui, 'Vegas 3 punti'),
      'the still-selected round must stay on screen after the bow changes under it');
    ui.unmount();
  });
});
