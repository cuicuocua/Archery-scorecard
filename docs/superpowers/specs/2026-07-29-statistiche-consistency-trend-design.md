# Statistiche: consistency trend chart

Adds a "how steady am I shooting" view to Statistiche's scoped analysis
section, next to the existing "how well am I scoring" average trend. Two
sessions can share the same average and be very different achievements —
one nervy with a wide spread of scores, one tight and repeatable — and
nothing in the app currently distinguishes them.

---

## Current behavior

Statistiche's scoped section (selected round shape + type + bow filters)
shows "Andamento media a freccia" — a line chart of each completed
session's average score per arrow, chronological. That's the only
session-level score trend on the page; everything else is either a
lifetime aggregate, a per-end-position aggregate across sessions
("Andamento per volée"), or spatial (grouping/dispersion, which requires
recorded arrow positions and is unavailable for keypad-entered sessions).

There is no measure of within-session consistency at all — two sessions
with the same average currently look identical on every existing chart.

## New behavior

**`scoreStdDevBySession(completedList)`** — new function, same input list
`trend` already consumes (`completed`, the `stageEntries()`-flattened
entries already filtered to the active round shape + type + bow). For each
entry, takes its arrow scores via the existing `flattenArrows(e).map(a =>
a.score)` and computes the population standard deviation. Returns the same
chronological shape `trend` already produces —
`{ label: formatDateShort(e.completedAt), stddev }` — sorted by
`completedAt` the same way, so the new chart reuses the existing
x-axis/label plumbing verbatim. An entry with fewer than 2 scored arrows
contributes `stddev: null` (skipped by the chart, same convention
`endRangeStats` already uses for sparse points) — not expected in practice
since every real round is 20-72 arrows, but keeps the function safe for a
hypothetical 1-arrow "Personalizzata" round.

**New chart, "Costanza"** — placed immediately after "Andamento media a
freccia" in Statistiche's scoped section (mean and spread read together).
A `LineChart` (same `ChartCard`/`EmptyChart` wrapper, `isAnimationActive={false}`
per the existing convention), one line, y-axis auto-scaled from 0 (no fixed
domain — unlike the average chart, which is fixed to the 0-10 score range,
standard deviation has no natural ceiling). Tooltip formats the value as
"σ = X.XX punti". Gated on the same `trend.length >= 2` condition the
average chart already uses (not the 5-session `MIN_SESSIONS_FOR_DEEP_ANALYSIS`
threshold — this isn't part of "Analisi avanzata", it's a peer of the
existing average trend chart and should appear exactly when that one does).

Lower is better (tighter grouping of scores), the opposite direction from
every other trend chart on the page (higher = better). No annotation is
added to call this out — the chart's title and the σ-labeled tooltip are
judged sufficient; this is consistent with the app's existing habit of
trusting the reader with a natural axis rather than adding explanatory
copy to every chart.

## Edge cases

- **Fewer than 2 completed sessions for the active filter**: same
  `EmptyChart` fallback the average chart already shows ("Servono almeno 2
  sessioni completate").
- **A session with only misses (all zeros)**: standard deviation is 0
  (perfectly "consistent," even though the consistency is at the worst
  possible score) — mathematically correct, not special-cased. The
  average chart sitting right next to it already shows the low score, so
  the pairing prevents this from being misread as a good result in
  isolation.
- **Switching round shape / type / bow filters**: recomputes from the same
  `completed`/`stageEntries()` filtering every other scoped chart already
  uses — no new filter state, no new edge case beyond what the existing
  average chart already handles for a zero/one-match filter.

## Testing notes

No test framework in this repo — manual verification via `npm run build`
and the browser preview. Specifically verify: the new chart appears
directly below "Andamento media a freccia" only once 2+ sessions exist for
the active filter, the line renders immediately (animation fix applied),
and the tooltip shows a sensible σ value (spot-check against a manual
calculation for one real session).
