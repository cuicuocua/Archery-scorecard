# Tournament final-stage enhancements

Five related, independently-shippable changes to the tournament bracket flow in `ArcheryScorecard.jsx`. Grouped into one spec because they all touch the same bracket-screen/final-stage machinery, but each can be implemented and tested on its own.

1. Lancaster final: bring back an eliminated competitor as a wildcard, via a play-in match.
2. Let the final format (classic / 3-way / Lancaster) be changed after tournament setup, not just at creation.
3. Superuser mode: after a match completes, "Torna al tabellone" jumps straight to the next playable match instead of returning to the bracket.
4. Hide bye matches from the round-by-round list view.
5. Default the bracket screen to the tree view instead of the list view.

---

## Feature 1 — Lancaster wildcard play-in

### Current behavior

Once a Lancaster-format tournament's bracket produces its 4 semifinalists, `seedLancasterSides()` re-ranks them by original qualification `seedScore` and `seedLancasterLadder()` wires a fixed 3-match ladder:

- `match1`: 4th seed vs 3rd seed
- `match2`: winner of match1 vs 2nd seed
- `match3`: winner of match2 vs 1st seed, for gold

`finalStage.standings` records fourth/third/second/first as each match completes (see `applyMatchResult`'s `lancaster1`/`lancaster2`/`lancaster3` branches).

### New behavior

Before `match1` has a result, the organizer can optionally pick one previously-eliminated competitor to challenge the 4th seed for their spot in the ladder, via a new play-in match.

- **Eligibility**: any participant in `tournament.participants` who is not currently one of the 4 `finalStage.sides`. Because Lancaster's final stage is only reached via a strict single-elimination bracket, everyone else has necessarily already lost a match — no separate "eliminated" bookkeeping is needed.
- **Data model**: `finalStage` (lancaster) gains one field, `playIn: null | Match`. When a wildcard is picked:
  - `playIn` is built as a normal 2-way match: wildcard vs. the current 4th seed.
  - `match1.slotA` (which today is pre-filled with the 4th seed by `seedLancasterLadder`) is cleared back to `null`, to be filled by `playIn`'s winner instead — the same "winner of match N feeds match N+1" pattern already used for `match1` → `match2` → `match3`.
  - `match1.slotB` (3rd seed), `match2`, `match3`, and `standings` are untouched.
  - If the organizer picks a *different* wildcard before `playIn` has a result, this simply overwrites `playIn` with a fresh unplayed match against the same 4th seed — no special-casing needed.
  - To back out of the wildcard entirely (go back to the plain 4th-vs-3rd ladder), the expanded control also offers an "Annulla ripescaggio" action while `playIn` has no result yet: it clears `finalStage.playIn` back to `null` and re-fills `match1.slotA` with the 4th seed directly, i.e. exactly `seedLancasterLadder`'s original wiring.
- **Resolution**: on `playIn` completion, its winner fills `match1.slotA` (mirroring the existing `lancaster1`→`match2.slotB` fill in `applyMatchResult`). The loser needs no standings update — they simply remain at whatever placement their earlier bracket loss already gave them (this app doesn't track 5th-and-below placements).
- **Window**: the wildcard picker is available any time before `match1` has a result. Once `match1` is completed (whether or not a play-in happened), the option disappears — consistent with how other pre-play edits in this app lock once results exist (e.g. `tournamentHasStarted`).

### UI

- A new collapsed-by-default control in the Lancaster section of `BracketScreen`, next to the match1/2/3 cards — same expand-on-tap pattern as the existing `WithdrawalControl` ("un arciere si ritira"). Something like "Ripescaggio: fai rientrare un'eliminata →", expanding to a list of eligible participant names.
- Once picked, a `playIn` `MatchCard` appears above match1, scored exactly like any other match (same `MatchScreen`, same keyboard-scoring support in superuser mode).

### Plumbing

One new match-ref kind, `lancasterPlayIn`, threaded through the same places `lancaster1`/`2`/`3` already go:
- `resolveMatchRef` — resolve to `{ match: finalStage.playIn, title: 'Ripescaggio' }`
- `applyMatchResult` — new `ref.kind === 'lancasterPlayIn'` branch that fills `match1.slotA` with the winner on completion
- `flatMatchRefs` — include it (when `finalStage.playIn` exists) so it's automatically covered by the superuser keyboard bracket-cursor navigation
- `isRefPlayable` — standard playable-status check, same as any 2-way match
- `BracketScreen` render — a `MatchCard` for the play-in, shown only when `finalStage.playIn` exists

### Edge cases

- Tournament reset (`resetTournamentBracket`) already discards `finalStage` entirely and rebuilds from `buildBracket`, which never creates a `playIn` — no special handling needed, a reset simply clears any wildcard pick along with everything else.
- Fewer than 4 competitors (no real Lancaster ladder exists): the wildcard control simply won't render, same as the existing Lancaster section already guards on `fs &&` / the ladder existing.

---

## Feature 2 — Change final format after setup

### Current behavior

`finalFormat` is chosen once in `TournamentCreateScreen` and baked into `createTournament` → `buildBracket`. `rebuildTournamentBracket(tournament, participants)` (used by the pre-start "edit participants" screen) and `resetTournamentBracket(tournament)` (used by "Reset torneo", allowed at any point) both currently re-call `buildBracket` with the *existing* `tournament.finalFormat` — the format itself is never editable after creation.

### New behavior

Both rebuild paths accept an optional new final format:

```js
function rebuildTournamentBracket(tournament, participants, finalFormat = tournament.finalFormat) {
  // ...unchanged body, just passes `finalFormat` into buildBracket instead of tournament.finalFormat
}
function resetTournamentBracket(tournament, finalFormat = tournament.finalFormat) {
  return rebuildTournamentBracket(tournament, tournament.participants, finalFormat);
}
```

No other logic changes — this is purely unlocking a parameter that was already being threaded through, defaulted so any call site that doesn't pass it behaves exactly as today.

### UI

- **Shared component**: extract the final-format picker (the 3-card list with label/description/checkmark, currently inline in `TournamentCreateScreen`) into a standalone `FinalFormatPicker({ value, onChange })` component, so it can be reused without copy-pasting the block two more times.
- **Pre-start path** (`TournamentEditParticipantsScreen`): add `FinalFormatPicker`, seeded from `tournament.finalFormat`, below the participant editor. Saving passes both the participant list and the chosen format through to `rebuildTournamentBracket`. Title stays "Modifica partecipanti" (no rename).
- **Reset path** (`ResetTournamentButton`): today this is a bare two-tap button that arms on first tap and auto-cancels after 3 seconds. It becomes an expand-on-tap panel instead (same pattern as `WithdrawalControl`): tapping "Reset torneo" reveals `FinalFormatPicker` (defaulted to the current format), a "Conferma: cancella tutti i risultati" button, and an "Annulla" to collapse without acting. The old instant two-tap flow goes away; confirming without changing the pre-selected format reproduces today's plain reset. `ResetTournamentButton` needs a new `tournament` prop (to read the current format) and its `onReset` callback now takes the chosen `finalFormat` as an argument.

### Wiring changes at the root

```js
onEditParticipants screen onSave: (participants, finalFormat) =>
  updateTournament(activeTournament.id, t => rebuildTournamentBracket(t, participants, finalFormat))

onReset: (finalFormat) =>
  updateTournament(activeTournament.id, t => resetTournamentBracket(t, finalFormat))
```

---

## Feature 3 — Superuser: auto-advance to next match

### Current behavior

In superuser mode's split-view, completing a match/final shows a "Torna al tabellone" button (`MatchScreen`'s and `ThreeWayFinalScreen`'s completed-state views). That button shares its `onBack` prop with the ordinary back-chevron shown throughout the *in-progress* view too (mid-match, before it's done) — so `onBack` can't simply be repointed at "advance," or leaving a match half-scored via the chevron would also skip ahead.

### New behavior

Both components gain a second, optional prop, `onDone`, defaulting to `onBack` when not passed (`const finish = onDone || onBack`). Only the completed-view's two buttons (chevron and "Torna al tabellone" — equivalent once the match is actually over) use `finish`; the in-progress chevron keeps using `onBack` unconditionally. Non-superuser call sites don't pass `onDone` at all, so they're unaffected. In superuser split-view only, `onDone` is wired to jump directly to the next playable match — no intermediate step, no confirmation screen, one click from "match just finished" to "scoring the next one."

Reuses the exact ordering and playability helpers already built for the keyboard bracket-cursor navigation (`flatMatchRefs`, `isRefPlayable`, `refEquals`):

```js
function nextPlayableRef(tournament, justCompletedRef) {
  const all = flatMatchRefs(tournament);
  const idx = all.findIndex(r => refEquals(r, justCompletedRef));
  const start = idx === -1 ? 0 : idx + 1;
  for (let i = 0; i < all.length; i++) {
    const candidate = all[(start + i) % all.length];
    if (isRefPlayable(tournament, candidate)) return candidate;
  }
  return null;
}
```

Called at the point `onBack` fires (tournament state is already updated by then, since `onComplete` ran first when the match was submitted):

```js
onDone: () => {
  const next = nextPlayableRef(activeTournament, activeMatchRef);
  setActiveMatchRef(next);
  setBracketCursor(next); // keep the arrow-key cursor in sync with what's now docked
}
// onBack stays () => setActiveMatchRef(null) — the chevron still just un-docks mid-match.
```

If `nextPlayableRef` returns `null` (nothing else playable — tournament finished, or everything remaining is waiting on other results), this is exactly today's behavior: the docked match clears and the bracket is shown on its own.

### Edge cases

- Works uniformly across every final-stage match kind (`lancaster1`/`2`/`3`, the new `lancasterPlayIn`, `prelim`, `threeFinal`, `thirdPlace`, ordinary bracket rounds) since it's driven by the same `flatMatchRefs` ordering used everywhere else — no per-kind special-casing.
- A completed 3-way final's runoff sub-match (nested `MatchScreen` inside `ThreeWayFinalScreen`) needs both `onBack` and `onDone` forwarded straight through from the parent's own props, so it's covered the same way.
- Wrapping around to the start of the list means if you finish the last currently-playable match in bracket order but an earlier round still has an unplayed bye-adjacent match waiting on a slower match elsewhere, you'll land back near the start rather than getting stuck — matches the existing arrow-key cursor's wraparound behavior, so the two stay mentally consistent.

---

## Feature 4 — Hide bye matches from the list view

`BracketScreen`'s "Elenco" (list) rendering (`tournament.rounds.map(round => round.map(m => <MatchCard .../>))`) currently shows every match in every round, including byes — which only ever occur in round 0. Change the inner `round.map` to filter `m.status !== 'bye'` first, so bye slots (nothing to score, no decision to make) don't clutter the round-by-round list.

Scoped to the list view only — the "Tabellone" tree view (`BracketTree`/`computeBracketLayout`) keeps every node as-is, since its connector-line layout math depends on every bracket position being present.

---

## Feature 5 — Default to the bracket (tree) view

`BracketScreen`'s `viewMode` state (`useState('list')`) defaults to the list view today. Change the default to `'bracket'`. No other behavior changes — the "Elenco"/"Tabellone" toggle still works the same, this just flips which one you land on when opening a tournament. (When `tournament.rounds.length === 0` — a small field with no real bracket rounds — this has no visible effect, same as today, since the tree view only renders when there are rounds to show.)

---

## Testing notes

No test framework exists in this repo today (per `README.md`/`package.json`, this is a static single-file build with no test runner). Verification will be manual: build (`npm run build`), exercise each flow live via the browser preview against the real Supabase-backed test data, same approach used for the recent superuser keyboard-navigation work.
