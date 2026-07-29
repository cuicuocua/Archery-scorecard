# Arcieri Senesi — Scorecard

`ArcheryScorecard.jsx` is a single-file React component (React + recharts +
lucide-react + `@supabase/supabase-js`, Tailwind core utilities only).
It's built and deployed automatically to GitHub Pages by
`.github/workflows/deploy-pages.yml` on every push to this branch — see
`site/` for the build tooling (`entry.jsx` mounts the component,
`build.js` compiles Tailwind + bundles everything with esbuild into one
`site/dist/index.html`). `ArcheryScorecard.jsx` itself is the only file
that matters for the app's behavior; everything under `site/` is just
plumbing to publish it as a static page.

Data lives in Supabase (Postgres + row-level security), not in browser
storage — sign in with an email + password and your sessions follow
you to any device. Schema in `supabase/schema.sql`; the project URL and
publishable ("anon") key are inlined near the top of
`ArcheryScorecard.jsx` — that key is meant to be public, security comes
from the RLS policies in the schema, not from hiding it.

This is v1: data model and export are the focus, no service worker /
full offline install yet — that's a deliberate follow-up (though sync
across devices, the main reason you'd want that, is already solved via
Supabase).

## Round definitions

Edit the `ROUND_TYPES` array at the top of the file. Every round is a list
of `stages` (distance, face diameter, arrows/end, number of ends per
stage) — nothing about a round is hardcoded elsewhere. Most rounds are one
stage; a few (WA1440, WA Combined) are shot as several distances back to
back within a single session.

Assumptions made, to check against FITARCO/World Archery rules:
- **Indoor 18m**: 40cm face, 3 frecce/volée, 20 volée (60 frecce) — standard.
- **Indoor 25m**: 60cm face, 3×20 — mirrors the 18m structure for the
  Italian indoor 25+18 combined round.
- **Targa 90m / 70m / 60m**: 122cm face, 6×12 (72 frecce) — 90/70m are the
  WA1440 long distances (70m is also the current WA outdoor ranking-round
  distance); 60m covers some categories (para, juniors).
- **Targa 50m / 40m / 30m**: 80cm face, 6×12 — the WA1440 short distances,
  and the standard compound/barebow distances.
- **Personalizzata**: fully editable at session start (distance, face,
  arrows/end, ends per stage), and lets you add more stages via
  "+ Aggiungi tappa" — this is how WA1440 (any of its several age/gender
  distance combinations), WA Combined, or any club-invented multi-distance
  round get logged, since there's no single fixed distance list that
  covers every WA1440 variant. Available for both allenamento and gara.
- Compound's WA rule of only scoring the inner 5-10 zone ("compound
  face") is **not** modelled — every bow type scores the full 10-zone
  face here.

Scoring: 10 zones, X is the inner half of the 10 ring (worth 10, counted
separately). Ring colours centre-out: gold, gold, red, red, blue, blue,
black, black, white, white.

## Data model

Each session is one row in Supabase's `sessions` table (`id`, `user_id`,
`data jsonb`) — the whole session object lives in `data`, upserted on every
change. A session is `stages: [stage, ...]` plus shared metadata (tipo,
arco, date, conditions, location, note); a stage is
`{ round: {label,distanceM,faceCm,arrowsPerEnd,ends}, ends: [{index,arrows}] }`.
Most rounds are one stage; multi-distance rounds (WA1440, WA Combined, ...)
are several stages shot back to back within a single session — see "Round
definitions" below. Each stage snapshots its own round config at creation
time, so editing `ROUND_TYPES` later never corrupts historical data. Arrows
keep entry order within a stage; UI sorts a copy for display. Arrows
entered via the tappable face carry `x`/`y` (normalized -1..1, fraction of
face radius); keypad-entered arrows have `x`/`y: null` and are excluded
from spatial analysis (correctly — there's no position to analyze).

Sessions saved before v1.4 have a flat `round`+`ends` instead of `stages`;
`normalizeSession()` upgrades them to the new shape on load (wrapped as a
single stage) without touching stored data — they only get rewritten to
the new shape the next time they're edited.

## Export

The download icon on the Storico screen exports the full sessions array
as JSON, meant to seed the future offline app.

## v1.1 additions

- **Zoom recentring**: at 2×/4× on the shooting face, the crop follows the
  centroid of the last 3 volée instead of always centring on the
  bullseye, so a group that's drifted off-centre stays visible and
  tappable at high zoom.
- **Group-size trace**: the live crosshair now draws a dashed circle at
  the group's actual radius (furthest arrow from centroid), not just a
  centre point. It renders behind the arrow marks so a tight group is
  never hidden under the crosshair itself.
- **Arco + tipo (gara/allenamento)**: every session records an optional
  bow (`ricurvo`/`compound`/`nudo`) and a required `sessionType`
  (`allenamento`/`gara`, defaults to allenamento). Personal-best and pace
  comparisons are scoped by round + arco + tipo — a gara score and an
  allenamento score are different achievements and never mixed. Storico
  filters on all three dimensions independently.
- **Custom sessions**: distance/face/arrows-per-end/ends are editable at
  session start via "Personalizzata", available regardless of tipo.
- **Analisi avanzata**: unlocks once a round+arco+tipo combination has at
  least `MIN_SESSIONS_FOR_DEEP_ANALYSIS` (5) completed sessions —
  dispersion-over-time, horizontal/vertical bias-over-time, and a score
  distribution histogram.
- **Condizioni**: after finishing a round (and editable later from a
  session's detail view), pick wind / time of day / sun position
  (single-select) and other factors like rain or fatigue (multi-select)
  — always by choice, never free text, so it stays analyzable. Feeds a
  "media per condizioni" chart in Analisi avanzata once you have data.

## v1.2 additions

- **Gara sociale**: a third `sessionType` alongside allenamento/gara, for
  unofficial club competitions with made-up rules. Picking it jumps
  straight to the "Personalizzata" round picker, since these are usually
  improvised on the spot. Has its own personal-best bucket, like the
  other two types.
- **Personal-best scoping fix**: PB/pace comparisons now match on the
  actual round snapshot (distance/face/arrows/ends), not just `roundId`
  — two "Personalizzata" sessions with different made-up rules are not
  the same round and were previously (incorrectly) compared as if
  chasing the same PB.
- **New Session is now a 4-step flow** (tipo → prova → arco → dettagli)
  instead of one long scrolling form.
- **Real cross-device sync**: moved persistence from browser storage to
  Supabase, with an email + password login gate (`AuthGate`). See
  "Data model" above. (Started as an email one-time-code flow, but
  Supabase's free email service turned out too unreliable without custom
  SMTP — switched to password auth so login doesn't depend on email
  delivery at all.)
- **Importa**: the counterpart to Export, on the Storico screen — loads a
  JSON file in the same shape `exportJson` produces (or a bare array of
  sessions) and upserts it, so re-importing an updated file is safe.
  Existing browser-local data from before this version is offered as a
  one-time import prompt on first login (`findLegacyLocalSessions`).
- **GitHub Pages deployment**: the app now has a permanent URL independent
  of any particular conversation or session — see the top of this file.

## v1.3 additions

- **Editable session details**: the Storico detail screen now lets you
  change a recorded session's date, tipo, and arco after the fact (not
  just location/note as before) — useful for correcting historical
  imports. Round parameters (distance/face/arrows/ends) stay fixed once a
  session exists, since the recorded arrows are tied to that shape;
  delete and re-enter if the round itself was wrong. Changing the date
  shifts `startedAt`/`completedAt` together, preserving time-of-day and
  the gap between them.

## v1.4 additions

- **Multi-distance rounds** (WA1440, WA Combined, or any club round shot
  across several distances): logged as a single session made of multiple
  "tappe" instead of forcing you to split it into separate sessions. Build
  one via "Personalizzata" → "+ Aggiungi tappa" in the New Session wizard.
  The shooting screen walks through each stage in order — the target face
  and distance swap automatically when a stage's volée are all shot — and
  shows a running session-wide total alongside stage-scoped stats.
- **Personal bests are now scoped per distance, not per session**: a
  WA1440's 70m tappa is compared against every other 70m attempt you've
  ever logged, including standalone Targa 70m sessions — not just other
  WA1440s. This is the whole point of the change above: previously a
  multi-distance round couldn't exist as one session at all, so there was
  no way to compare "just the 70m part" of anything against your real 70m
  personal best.
- **Storico's round filter is now built from what you've actually shot**,
  not a fixed preset list — since a custom/multi-distance round's shape
  isn't enumerable in advance. Selecting a distance shows every session
  (or stage, for multi-distance ones) shot at that exact distance/face/
  arrows/ends, with its own PB, trend, dispersion, and score-distribution
  charts, sourced by flattening every session into per-stage records
  (`stageEntries()`) before any of that analysis runs.
- Sessions saved before this version (single `round`+`ends`, no `stages`)
  keep working unchanged — see "Data model" above.

## v1.5 additions

- **Statistiche tab**: a third bottom-nav screen with cumulative stats
  across every completed session — total sessions/arrows/points-per-arrow/X,
  a "frecce per colore" chart (percentage of every arrow ever shot landing
  in each ring colour, derived from score via `ringGroupForScore` so it
  works for keypad-entered arrows too), an overall points-per-arrow trend,
  a personal-best-per-distance table (built on the same `stageEntries()`
  flattening Storico uses), and a sessions-by-tipo breakdown.
- **Analisi rapida**: every completed session now gets a short, deterministic
  1-2 sentence takeaway (`sessionInsight()`) — no external AI call, just
  arithmetic over your own history, so it works fully offline. First
  sentence compares this session's points-per-arrow against your historical
  average for the same round shape + tipo + arco (combined per stage for
  multi-distance rounds). Second sentence surfaces whichever signal is most
  notable — group bias, in-session fatigue (first half vs second half),
  misses, or gold rate — omitted if nothing stands out. Shown right after
  finishing a session and again anytime you revisit it in Storico.

## v1.6 additions — Tournament manager

A fourth bottom-nav tab, entirely separate from the personal scorecard: run
a single-elimination tournament with live match scoring.

- **Data model**: a tournament is `{ participants, bracketSize, rounds }`,
  stored in its own `tournaments` table (`supabase/schema.sql`), same
  RLS-per-user pattern as `sessions`. `rounds[0]` is the first round;
  `buildBracket()` seeds it and every later round from `participants`
  (already sorted best-seed-first) using the classic recursive tournament
  seeding order (`standardSeedOrder()` — for 8 players: 1v8, 4v5, 2v7, 3v6,
  so the top 2 seeds can't meet before the final). Byes go to the top seeds
  automatically when the field isn't a power of 2, and resolve immediately
  — no user action needed to advance a bye.
- **One match engine for both formats**: individual and team matches both
  reduce to "play a sequence of units (sets or ends), award 2 set-points to
  the higher side each unit (1-1 if tied), first to the target set-points
  wins, shoot-off if still tied once every unit is played" — see
  `MATCH_FORMATS` for the three presets (Individuale: 5 sets/3 arrows/6 SP;
  Team misto: 2 archers/side, 4 ends/2 arrows each/5 SP; A squadre: 3
  archers/side, same end structure) and `recordUnit()`/`recordShootOff()`
  for the engine itself. These are WA-standard assumptions — verify locally,
  same spirit as `ROUND_TYPES`. Team formats record each end's arrows as one
  combined list per side rather than attributing them to a specific archer
  — a deliberate simplification.
  - Shoot-off winner is a manual declaration (tap "Vince X"), not
    auto-computed from arrow position — closest-to-center requires a
    judgment call the app can't make from a keypad score. Optional score
    entry is there for the record only.
- **Live scoring**: `MatchScreen` reuses the same `Keypad` component the
  personal scorecard uses. Entering a side's last arrow for a unit
  auto-advances the active-side toggle to the other side, so the scorer
  doesn't have to remember to switch manually between sets. A completed
  match calls `applyMatchResult()`, which records the result and — unless
  it was the final — propagates the winner into next round's slot via
  `propagateWinner()`.
- **Bracket view** defaults to a classic horizontal bracket tree
  (`BracketTree` — connector lines computed with the standard
  doubling-spacing algorithm, so the draw stays visually balanced at any
  size), with a toggle to switch to a vertical round-by-round list of match
  cards instead. The tree is horizontally scrollable rather than squeezed to
  fit, since a multi-round bracket won't fit a phone screen at once either
  way. Both views open the same live `MatchScreen` when you tap a playable
  match, so you can score directly from the tree. The list view skips bye
  matches entirely — nothing to score, nothing to decide — while the tree
  keeps every node, since its connector-line layout depends on each bracket
  position being present.
- **Bulk participant entry**: "Incolla un elenco" in the tournament setup
  screen accepts a pasted list, one participant per line, name and score in
  either order ("Anna Rossi 600" or "600 Anna Rossi" — real scoreboards get
  pasted both ways) and in any reasonable separator (space, comma, colon,
  tab, dash). Lines it can't parse are reported rather than silently
  dropped or guessed at.
- **Target face size** is a picker over the four real WA sizes
  (40/60/80/122cm) instead of a stepper whose increments didn't land on
  any actual target size; the distance stepper is bounded to WA's real
  competition range (10-90m).
- **Editable round name**: `session.roundLabel` (the display name shown in
  Storico/Home/Detail) is now an editable field in `SessionMetaEditor`, with
  autocomplete suggestions from `ROUND_TYPES`. Purely cosmetic — it doesn't
  touch the recorded round shape or affect PB/analysis grouping, which is
  always keyed on the actual distance/face/arrows/ends, not the label — but
  useful for renaming an imported session (e.g. "WA 70m" as printed on an
  old scoresheet) to match the label you'd normally recognize it by
  ("Targa 70m").
- **Manual reload button** on the Home header — a static page cached by the
  browser doesn't always pick up a new deploy on its own.
- **Responsive layout**: every screen's container scales from phone width
  up through `sm`/`lg` breakpoints instead of staying pinned at a fixed
  mobile width with empty margins on a tablet or desktop; the bottom nav's
  background stays full-bleed but its icon row aligns to the same centered
  column as the content above it.
- **Round shape shown next to "Nome prova"** ("70m · 122cm", or each
  stage's shape joined with `+` for a multi-distance session) so you can
  see exactly what you're naming — a session's actual shape drives every
  bit of grouping/PB logic, the label never does, so this is what actually
  matters when deciding what to call something.
- **Save errors are surfaced, never silent**: session/tournament writes to
  Supabase used to fail with only a `console.error`, so a tournament that
  couldn't save (e.g. the `tournaments` table not existing yet) looked fine
  until the next reload wiped it. A dismissible red banner now shows
  whenever a save/delete fails, on every screen.
- **Forfeit / walkover**: any playable match (`WithdrawalControl` in
  `MatchScreen`) can be declared a walkover — pick who withdrew, the other
  side is awarded the win and advances exactly like a normal result
  (`forfeitMatch()`), tagged "W.O." in the bracket. Works at any point in
  the tournament, not just round 1.
- **Edit participants & redraw bracket**: while nothing in the draw has
  been played or forfeited yet (`tournamentHasStarted()`), a "Modifica
  partecipanti" button on the bracket screen reopens the participant list
  (add/remove/bulk-paste) and regenerates the whole seeding from scratch
  (`rebuildTournamentBracket()`) — for a no-show discovered before the
  first match, or a late arrival. The same screen also lets the final
  format itself be changed at this point, not just at creation — saving
  passes both the edited participant list and the chosen format through to
  the same rebuild. The button disappears once any match has a real result
  (a completed Lancaster wildcard play-in counts, even if match1 itself
  hasn't been played yet), since redrawing after that would silently
  discard it.
- **Three ways to decide the podium**, chosen per tournament at creation
  (`FINAL_FORMATS`, stored as `tournament.finalFormat`):
  - **Finale classica** (default): normal semifinal + final, plus an
    independent bronze match between the two semifinal losers — the app
    previously had no bronze match at all, losers were just eliminated.
  - **Finale a 3**: the semifinal round is still played normally; its two
    losers play a preliminary decider, and the winner joins the two
    semifinal winners for a genuine 3-way final. All three shoot every end
    simultaneously — the end's top score gets 2 set-points, a 2- or 3-way
    tie for the top score splits 1 point each — first to 6 wins gold
    outright (`record3WayUnit()`); a tie for the lead once ends run out
    goes to a 3-way shoot-off among just the tied contenders
    (`record3WayShootOff()`). Once gold's decided, the other two play on
    for silver/bronze as an ordinary match, seeded with the exact
    set-points they already had against each other in the 3-way stage
    (`startThreeWayRunoff()`) — reuses `MatchScreen` unchanged, including
    forfeit.
  - **Finale Lancaster**: skips the bracket's semifinal and final rounds
    entirely. Once the field is down to its last 4, they're re-ranked by
    their original qualification seeding score — not by how the bracket
    happened to pair them, since upsets can put a lower seed through — into
    a sequential ladder: 4th-seed vs 3rd-seed, winner vs 2nd-seed, winner
    vs 1st-seed for gold (`seedLancasterLadder()`), three ordinary matches
    chained together. Before that first match is played, a collapsed
    "Ripescaggio" control lets the organizer bring one already-eliminated
    competitor back as a wildcard, challenging the 4th seed for their ladder
    spot in an extra play-in match (`setLancasterWildcard()`) — anyone not
    currently one of the 4 semifinalists qualifies, since Lancaster's final
    stage is only ever reached via a strict single-elimination bracket, so
    everyone else has necessarily already lost. The play-in's winner feeds
    match1 exactly the way match1's winner feeds match2 — one extra optional
    link at the front of the same chain. Reversible ("Annulla ripescaggio")
    right up until the play-in itself is scored.
  - All three reduce to the existing 2-way match engine except the 3-way
    final's own pre-gold phase, which is the one genuinely new piece
    (`ThreeWayFinalScreen`). Tournaments saved before this feature default
    to "Finale classica" with no bronze match (`normalizeTournament()`),
    exactly how they behaved before.
- **Reset tournament**: once a tournament has started (`tournamentHasStarted()`),
  a "Reset torneo" button on the bracket screen expands into a small panel
  (tap to open, same collapsed-by-default pattern as the withdrawal
  control) offering the final-format picker — defaulted to the tournament's
  current format — plus an explicit confirm, before wiping every match
  result and redrawing the bracket from scratch against the exact same
  seeded participant list (`resetTournamentBracket()` — same rebuild the
  edit-participants flow uses, just fed the tournament's own current
  `participants` instead of an edited list). A do-over, not a redraw: who's
  entered and how they're seeded doesn't change, only the results played so
  far are discarded (confirming without touching the pre-selected format
  reproduces a plain reset). Available at any point, including after the
  tournament's finished, unlike editing participants which locks once play
  begins — this is the only place the final format can be changed once a
  result already exists, since a reset already wipes them anyway.
- **Superuser mode** (desktop only): pressing `q` toggles a mode where
  opening a match docks its scoring card in a side panel next to the
  bracket instead of navigating full-screen over it. No extra plumbing was
  needed for the bracket to update live as each end is saved — match
  updates already flow straight back into tournament state after every
  unit via `applyMatchResult()` (see "Live scoring" above), so the bracket
  card for that match simply re-renders with the new score as you score it.
  Gated to real desktop input (`pointer: fine` + `innerWidth >= 1024`) so a
  stray "q" while typing on a touch device never triggers it, and ignored
  while focus is in a text field. Toggling mid-match folds/unfolds the
  split view without losing your place — turning it on while a match is
  open full-screen brings the bracket back on screen with that match now
  docked beside it; turning it off pops the docked match back to
  full-screen. While it's on, the keyboard also mirrors the Keypad
  (`keyToScore()`): digits `1`-`9`, `0` for a plain 10, `x` for an X, `m`
  for a miss, `Enter` to confirm a set/end (only once both sides have
  enough arrows, same as the button), `Backspace` to undo the active
  side's last arrow, `←`/`→` to switch the active side (cycles 0/1/2 in the
  3-way final, restricted to the live contenders during a shoot-off). While
  browsing the bracket, `↑`/`↓` move a cursor through the playable matches
  (highlighted with a ring) and `Enter` opens whichever one it's on, docking
  it exactly like a click would — a full round can be scored without
  touching the mouse. The scoring digits/`x`/`m` stay undocumented, but
  every other shortcut (`↑↓`, `←→`, `Invio`, `⌫`) is listed in a banner
  across the top of the page while the mode is on — in normal document flow
  rather than a fixed overlay, so it never sits on top of the bracket cards
  it's describing. Declaring a shoot-off winner still requires a manual tap, keyboard
  or not, since that's a judgment call. Finishing a match goes one step
  further than closing it: "Torna al tabellone" skips the bracket entirely
  and docks whatever's next to score (`nextPlayableRef()`, same ordering the
  arrow-key cursor uses, wrapping around the bracket if needed) — one click
  from "match just finished" to "scoring the next one." This only applies to
  that specific button; the ordinary back-chevron shown mid-match still just
  un-docks without advancing, since leaving a match half-scored shouldn't
  skip ahead.

## v1.7 additions

- **Correct a confirmed set/end**: `MatchScreen` now lists every already-
  scored unit for the open match (`UnitHistory`) with each row tappable to
  reopen it — previously the only recovery from a scoring mistake was
  "Reset torneo," which discards every result in the bracket, not just the
  one wrong entry. Reopening a unit re-seeds the keypad with its recorded
  arrows and, on save, resubmits just that unit through the existing
  `recordUnit()` — which already recomputes cumulative set-points from the
  full unit list regardless of which index changed, so no separate undo
  data model was needed. This works even on a completed match: correcting
  an earlier unit can flip the outcome and un-completes the match back to
  `in_progress` or `shootoff` exactly as if it had never finished.
- **Password recovery**: the sign-in screen has a "Password dimenticata?"
  link that calls `supabase.auth.resetPasswordForEmail()`. Clicking the
  emailed link brings the user back with a `PASSWORD_RECOVERY` auth event,
  which the root component intercepts (`passwordRecovery` state) to show a
  dedicated "set a new password" screen (`supabase.auth.updateUser()`)
  before dropping them into the app — otherwise the recovery session would
  log them in without ever letting them actually replace the password they
  forgot.
- **Tournament creation is a 4-step wizard** (`TournamentCreateScreen`):
  details → format → participants → final format, mirroring the step
  pattern `NewSessionScreen` already uses for the personal-session flow,
  instead of one long unbroken scroll through six decision categories.
  Each step's "Continua" is gated on that step's own requirement (a name,
  at least 2 participants); the final step's button generates the bracket
  exactly as before.
- **Scroll-fade on overflowing chip rows**: Storico's three filter rows
  (round shape, session type, bow) get a standing edge mask
  (`ScrollFadeRow`) so a row with more chips than fit on screen fades at
  the edge instead of hard-clipping with no indication more options exist
  off to the side.
- **Full-width layout**: every screen's outer wrapper dropped the
  `max-w-...-6xl` column cap in favor of `w-full` — on a wide desktop
  screen the app now fills the available viewport instead of sitting in a
  centered column with the bottom nav bar spanning wider than the content
  above it. `TargetFace` keeps its own `max-w-2xl` cap so the target
  diagram doesn't balloon to viewport width on an ultra-wide monitor;
  charts and lists scale with the new full-width columns as intended.
- **`ChipSelect` signals its mode**: a multi-select row (`multi` prop,
  currently just "Altre condizioni") now shows a small checkbox glyph on
  each chip, filled when active — single-select rows stay plain pills.
  Previously both modes looked identical, so there was no visual cue
  for whether tapping a chip would toggle it independently or swap out
  the whole selection.
- **Auth inputs have `aria-label`s**: email/password fields across sign-in,
  password reset, and set-new-password relied on placeholder text alone
  for a screen reader.
- **More breathing room under the bracket screen's last section**:
  `BracketScreen`'s bottom padding grew from `pb-8` to `pb-12` so the
  final podium-format section never sits flush against the sticky bottom
  nav.

## v1.8 additions — `/impeccable audit` fixes

- **Semantic page titles**: every screen's title (`Storico`, `Tornei`,
  `Scorecard`, the per-step tournament/session wizard titles, match
  titles, etc.) is now an `<h1>` instead of a plain `<div>` — 18 sites.
  Screen readers previously had zero page-structure landmarks anywhere in
  the app; now every screen announces its topic.
- **Every icon-only button has an `aria-label`**: back chevrons (11
  sites), import/export/sign-out, edit-participants, add/remove
  participant, refresh, new-tournament, and both delete-with-confirm
  buttons (which now announce "Elimina sessione/torneo" unarmed and
  "Conferma eliminazione" once armed, matching their actual behavior)
  were previously blank buttons to assistive tech.
- **`T.textFaint` now clears WCAG AA contrast**: lightened from `#6B707A`
  to `#8B929F` (same cool-gray hue, ~1.3x brighter) — the old value
  measured 3.64:1 against `T.bg` and 3.13:1 against `T.surfaceAlt` (need
  4.5:1), despite being used for real text throughout (category labels,
  "Annulla" links, nav labels), not just decorative borders. The new
  value clears 4.5:1 against every surface tone in the app while staying
  the faintest of the three text tiers.
- **Touch targets cleared to 44×44px**: `FilterChip` and `ChipSelect`
  chips, and every icon-only button, get `min-w-11 min-h-11` (or
  `min-h-11` alone for chips, whose width already comes from their
  label). Verified live — Storico alone had 33 of 37 interactive
  elements measuring 34-36px before this; all now clear 44px except the
  bottom nav tabs, whose full-height flex-1 hit area is generous despite
  being narrower than 44px wide.
- **Stray hex colors tokenized**: the ~10 scattered `'#fff'` literals
  (white text on a red delete-confirm background) became `T.onRed`; the
  arrow-mark outline in `TargetFace` became `T.markStroke`. Every color
  in the file now lives in the `T`/`SCORE_COLORS` token objects — no
  loose hex values elsewhere.

## v1.9 additions

- **Standardized, non-editable session names**: the free-text "Nome prova"
  field is gone — every session's display name is now always computed
  (`sessionDisplayName()`) from its round shape instead of typed by hand.
  Single-stage sessions reuse `roundShapeLabel()`'s existing preset match
  (a recognized shape like "Targa 70m" or "Indoor 18m" still wins over a
  raw "70m · 122cm"; an unrecognized shape — most "Personalizzata"
  rounds — falls back to that raw "Xm · Ycm" form). A 4-stage session
  gets named "WA 1440 (d1/d2/d3/d4m)", since that's this club's own
  FITARCO/WA aggregate convention; any other stage count just lists its
  distances (e.g. a 2-stage indoor+18m combo becomes "25/18m"). `roundLabel`
  is no longer written to new sessions at all — nothing reads it anymore,
  so there's nothing for a future bulk import to fill in either.

## v1.10 additions — Statistiche redesign

`Statistiche` becomes the app's real analysis home; `Storico` goes back to
being a pure browse/filter/list screen (see below). Also fixes a real
rendering bug: every Recharts `<Bar>`/`<Line>`/`<Area>` in the app now sets
`isAnimationActive={false}` — Recharts' entrance animation was getting stuck
at its first frame in some environments, leaving charts visually blank
despite correct data reaching them.

- **Round-shape matching loosened to distance+face only** (`roundShapeKey()`,
  `sameRound()`) — previously also compared arrows-per-end and ends, which
  incorrectly split a standalone "Targa 70m" session from a WA1440's 70m
  stage into two separate groups despite being the same round. This also
  means groups can now mix sessions with different arrow counts (e.g. 60
  vs 72 arrows), so every score comparison that used to total the raw
  score now uses **average score per arrow** instead throughout
  (`bestByShape()`, Statistiche's trend line, personal-best comparisons) —
  the only fair unit once "same round" no longer implies "same arrow count."
- **Session naming recognizes more archetypes**: a 2-stage session whose
  distances include both 25m and 18m is now named "WA Combined," the
  standard FITARCO indoor aggregate, alongside the existing 4-stage "WA
  1440" recognition. `sessionDisplayName()` now returns `{name,
  isArchetype}`; the new `SessionName` component dims non-archetype names
  (`T.textFaint`) so a "Personalizzata" round that doesn't match a known
  shape is visually distinguishable from a real archetype at a glance,
  everywhere a session name is shown.
- **`Statistiche` restructured around a per-round-shape selector** instead
  of one lifetime view blending every round type together (distance and
  face size vary too much between round types for a blended average to
  mean anything). Top to bottom: a lifetime header (session/arrow/X counts
  only, no blended average), a tappable "Le tue prove" list
  (`bestByShape()` — per-arrow average and personal best, one row per
  round shape), secondary type/bow filter chips, then a scoped analysis
  section for the selected round shape + filters.
- **Two new charts in the scoped section**:
  - **"Andamento per volée"** — a candlestick-style chart
    (`endRangeStats()`) showing, per end position (1 through the round's
    max ends) across every session of that round shape, the min/average/max
    arrow score at that end. Built as a Recharts `<ComposedChart>`: a
    floating `<Bar dataKey="range">` fed a `[min, max]` 2-element array per
    point renders the range, with a `<Line dataKey="avg">` overlaid.
  - **"Andamento colori nel tempo"** — a 100%-stacked `<AreaChart>`
    (`colorTrendByShape()`, five `<Area>`s sharing one `stackId`) showing
    the percentage of arrows landing in each ring-color band over time
    across sessions of that round shape.
- **Stats with no usable data show a placeholder, not an empty/misleading
  chart**: applies generally now, not just to position-based (grouping)
  stats — "Gruppo cumulativo" shows a dashed-border "record more sessions
  to unlock this analysis"-style message when no arrow in the current
  filter has a recorded position (i.e. every arrow was keypad-entered),
  instead of an empty target face.
- **`Storico` simplified back to browse/filter/list**: the stat tiles,
  trend chart, fatigue chart, cumulative group, and "Analisi avanzata"
  block that used to appear when filtering to a round shape are gone from
  this screen entirely — that whole section moved into `Statistiche`
  above. `Storico` now only ever renders its three filter chip rows plus
  the session list.

## v1.11 additions

- **"Costanza" consistency chart**: Statistiche's scoped analysis section now
  shows each session's arrow-score standard deviation over time
  (`scoreStdDevBySession()`), right below the existing average-per-arrow
  trend. Two sessions can share the same average and be very different
  achievements — one nervy with a wide spread of scores, one tight and
  repeatable — and this is the first chart on the page that distinguishes
  them. Lower is better (tighter grouping of scores), the opposite reading
  direction from every other trend chart here; no explanatory copy is added
  for this, consistent with the app's existing habit of a labeled axis over
  annotation. Gated on the same 2-session minimum the average chart uses,
  not the 5-session "Analisi avanzata" threshold — it's a peer of the
  average chart, not part of that deeper section.
