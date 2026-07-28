# Statistiche redesign

Moves all per-round analysis out of `Storico` (where it's gated behind a hard-to-discover filter) and into `Statistiche`, which becomes the app's actual analysis home. `Storico` goes back to being a pure browse/filter/list screen. Also fixes a real rendering bug: every Recharts chart in the app currently renders invisibly.

---

## Current behavior

**`StatisticheScreen`** shows one lifetime-cumulative view, blending every round type together: 4 stat tiles (Sessioni, Frecce, Media/freccia, X totali), a ring-color distribution bar chart, a per-arrow-average trend line, a "Primati per distanza" list (best score per round shape — the one part that's already correctly scoped), and a "Sessioni per tipo" count grid.

**`StoricoScreen`** is a session browser with three filter chip rows (round shape / session type / bow type). Filtering to a specific round shape reveals a large "detailed stats" block: stat tiles (Sessioni/Media/Primato), a total-score trend line, a "Media per volée" fatigue chart, a cumulative group target-face with dispersion bias, and (at 5+ completed sessions for that round+type+bow combination) an "Analisi avanzata" section — dispersion-over-time, horizontal/vertical drift, score distribution histogram, and score-by-condition (wind/time-of-day/sun/tags). Below all of that, the actual session list.

**The blending problem:** distance and face size vary enormously between round types (a 70m/122cm round and an 18m/40cm round aren't comparable), so `Media/freccia`, the trend line, and the color-distribution chart on Statistiche all currently average or plot incomparable data together. The only part of the current Statistiche page that's already correctly scoped is "Primati per distanza," because `bestByShape()` groups by round shape internally.

**The chart rendering bug:** every `Bar`/`Line` chart in the app renders with correct data reaching Recharts (verified via React fiber inspection — e.g. `hitRateByColor()` output reaching the `Bar`'s `data` prop with real non-zero values) but nothing is visually drawn. Root cause: Recharts' entrance animation is stuck at its first frame — inspecting a `<Line>`'s rendered `<path>` shows `stroke-dasharray="6px 1184px"` (i.e. the line-draw reveal animation never advances past ~6px of a 1184px path), and the equivalent for `<Bar>` is that no bar `<rect>` elements exist in the DOM at all. This reproduces reliably in the automated browser environment; whether it also affects real usage is unconfirmed, but the fix is safe and worth applying regardless (`isAnimationActive={false}` is also just a reasonable default for a stats dashboard).

---

## New behavior

### `StoricoScreen` — simplified

Keeps: the three filter chip rows (round/type/bow — unchanged, still narrow which sessions are visible), the session list itself (`SessionRow` when no round shape is selected, `StageEntryRow` per matching stage when one is), and the header icons (import/export/sign-out).

Removed entirely: the stat tiles, "Andamento punteggio" trend chart, "Media per volée" fatigue chart, "Gruppo cumulativo" target face, and the whole "Analisi avanzata" block. All of it moves to `StatisticheScreen` (below) — none of it is deleted, just relocated. `fatigueCurve`, `dispersionTrend`, `scoreDistribution`, `scoreByCondition`, `findPersonalBest`, `computeGroupStats`, and `MIN_SESSIONS_FOR_DEEP_ANALYSIS` are reused as-is; only their call site moves.

Concretely: the `filterId === 'all' ? <small message> : <big analysis block>` branch (current lines ~1806–1931) is deleted. The list-rendering logic that's already at the bottom of the component (lines ~1933–1950) becomes the entire body of the screen below the filter chips — no behavior change to the list itself, it already handles both the "all" and "one shape selected" cases correctly.

### `StatisticheScreen` — new structure, top to bottom

1. **Lifetime header** (always visible, ignores every filter below it): `Sessioni`, `Frecce`, `X totali` — three stat tiles, raw counts only. `Media/freccia` is dropped from this tier entirely, since a blended average is exactly the number this redesign exists to stop showing. Below the tiles, the existing "Sessioni per tipo" 3-tile grid (Allenamento/Gara/Sociale counts) stays, unchanged, still lifetime-wide.

2. **Round-shape list**, replacing "Primati per distanza." Same underlying data (`bestByShape()`, same sort order — distance desc, then face size desc) and same visual row (name, `media X · N sessioni`, best score), but each row is now a button: tapping it sets the screen's local `filterId` state (same concept `StoricoScreen` already uses) and becomes the active round shape for section 4. Defaults on mount to the shape of the most recently completed stage entry across all sessions (not an empty/unselected state) — computed the same way `bestByShape`'s input already is, just taking the max by `completedAt` instead of grouping.

3. **Secondary filter chips**: session type and bow type, identical chip rows to what `StoricoScreen` already has (`SESSION_TYPES` / `BOW_TYPES`, "tutti" option), scoped underneath the round-shape list. These, together with the selected round shape, feed the exact same three-way filter `StoricoScreen` already computes (`typeAndBowFiltered` → `stageEntries` → filtered by `roundShapeKey`) — same filtering logic, just living in this component now instead of `StoricoScreen`.

4. **Scoped analysis for the active round shape + type + bow filters** — this is `StoricoScreen`'s former "detailed stats" block, moved verbatim, plus the color-distribution chart promoted from the old Statistiche page and scoped to match. Top to bottom:
   - Stat tiles: `Sessioni`, `Media`, `Primato` (same 3-tile pattern as today's `StoricoScreen`)
   - "Andamento punteggio" — total-score trend line (`StoricoScreen`'s version, not old Statistiche's per-arrow-average version — once everything's scoped to one round shape, raw total score is directly comparable session-to-session, so the simpler metric wins and the per-arrow-average trend is dropped)
   - "Frecce per colore" — ring-color distribution bar chart (`hitRateByColor()`, promoted from old Statistiche), now scoped to just this filter's arrows instead of every arrow ever shot
   - "Media per volée" (fatigue curve) — unchanged from `StoricoScreen`, its own independent "≥2 data points" gate (not the 5-session minimum below)
   - "Gruppo cumulativo" — target face + dispersion bias readout. Shown whenever there's at least one completed entry for the active filter — **not** gated by the 5-session minimum (same as `StoricoScreen` today: this renders as soon as `filterId` is set, independent of `deepAnalysisReady`)
   - "Analisi avanzata" — dispersion-over-time, horizontal/vertical drift, score distribution, score-by-condition. **This whole section**, and only this section, is gated by the 5-session minimum (`MIN_SESSIONS_FOR_DEEP_ANALYSIS`), with the existing "servono almeno N sessioni" placeholder below threshold — unchanged from `StoricoScreen`

### Chart animation fix

Every `<Bar>` and `<Line>` element that survives this reshuffle (all of them now live in `StatisticheScreen`) gets `isAnimationActive={false}`. No other prop changes.

---

## Edge cases

- **No completed sessions at all**: `StatisticheScreen` keeps its existing empty state ("Completa qualche sessione per iniziare...") — unchanged.
- **Only one round shape ever shot**: the round-shape list has exactly one row, pre-selected by the same "most recent" default logic (trivially correct since there's only one candidate).
- **Fewer than 5 sessions for the active round+type+bow combination**: same "servono almeno 5 sessioni" placeholder `StoricoScreen` already shows, now rendered inside `StatisticheScreen` instead.
- **Switching the round-shape selection**: session-type/bow-type filter selections persist across the switch (they're independent state) — if that combination yields zero matching entries for the newly selected round, the scoped section's stat tiles/charts show their existing empty states (`'—'` for stat tiles, `EmptyChart` placeholders for charts) exactly as `StoricoScreen` already handles a zero-match filter today.
- **Multi-stage sessions (e.g. a 4-stage WA1440) contributing to the "most recent shape" default**: uses the same per-*stage* entry granularity `stageEntries()` already provides — the default selects whichever individual stage was most recently completed, not the parent session as a whole, consistent with how everything else on this page already operates per-stage rather than per-session.

## Testing notes

No test framework in this repo (static single-file build, no test runner) — manual verification via `npm run build` and the browser preview, same approach used throughout this project. Specifically verify: the chart-animation fix actually makes bars/lines visible (re-run the DOM inspection that found the bug — confirm real bar `<rect>` elements exist and the line's `stroke-dasharray` covers its full path length), the round-shape default-selection picks the right entry, and `StoricoScreen`'s list still filters correctly with the analysis block removed.
