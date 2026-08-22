# Statistiche Consistency Trend Chart Implementation Plan

> **Shipped in v1.11** — the "Costanza" consistency chart. This is a historical planning record, not open work.
> Its step checkboxes below were never ticked; they are left as they were written rather than
> back-filled with a completion record nobody witnessed. See `CHANGELOG.md` for what actually
> shipped. **The "REQUIRED SUB-SKILL" note that follows no longer applies** — there is nothing
> here left to implement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Costanza" line chart to Statistiche's scoped analysis section, showing each session's arrow-score standard deviation over time, so two sessions with the same average but different spread stop looking identical.

**Architecture:** One new pure function (`scoreStdDevBySession`) computes population standard deviation of arrow scores per completed entry, chronological — mirrors the existing `trend`/`dispersionTrend` pattern exactly. One new `useMemo` in `StatisticheScreen` wires it to the already-filtered `completed` list. One new `ChartCard` renders it as a `LineChart`, placed directly under the existing "Andamento media a freccia" chart.

**Tech Stack:** React 18 (hooks only), Recharts (`LineChart`/`Line`/`CartesianGrid`/`XAxis`/`YAxis`/`Tooltip`, all already imported), Tailwind utility classes. Everything lives in the single file `ArcheryScorecard.jsx`.

## Global Constraints

- Single source file: `ArcheryScorecard.jsx`. No new files, no new dependencies.
- No test framework exists in this repo (static single-file build, no test runner). Verification is: (a) a throwaway `node -e` sanity check of the arithmetic where noted, (b) `npm run build` must stay clean, (c) live browser check via the local static preview server (`.claude/launch.json`, name `static`, port 8934) using the project's browser tools. Never leave a temporary verification script behind.
- Every `<Line>`/`<Bar>`/`<Area>` in this file sets `isAnimationActive={false}` (fixes a real Recharts entrance-animation bug — confirmed elsewhere in the app). The new `<Line>` must do the same.
- Follow existing patterns exactly: `ChartCard`/`EmptyChart` wrapper components, the `T.*` color token object, `formatDateShort()` for x-axis labels, population (not sample) standard deviation, per spec.
- Spec: `docs/superpowers/specs/2026-07-29-statistiche-consistency-trend-design.md`.

---

### Task 1: `scoreStdDevBySession()` data function

**Files:**
- Modify: `ArcheryScorecard.jsx` — insert a new function immediately after `endRangeStats` ends (currently line 612, right before the blank line that precedes `function dispersionTrend(completedList)` at line 614).

**Interfaces:**
- Consumes: `flattenArrows(stage)` (line 263, returns a flat array of `{score, isX, x, y}` for one entry — takes an object with `.ends`), `formatDateShort(iso)` (line 670, formats an ISO date string for chart x-axis labels).
- Produces: `scoreStdDevBySession(completedList)` — takes the same array `trend`/`dispersionTrend` already consume (each element has `.ends` and `.completedAt`), returns `[{ label: string, stddev: number|null }, ...]` sorted chronologically by `completedAt`. Task 2 calls this directly.

- [ ] **Step 1: Sanity-check the arithmetic in isolation**

Run this to confirm the population-stddev formula gives the expected result before it's embedded in the file (mean 5, four arrows split evenly between 10 and 0 → stddev 5):

```bash
node -e "
const scores = [10, 0, 10, 0];
const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
console.log(Math.sqrt(variance));
"
```

Expected output: `5`

- [ ] **Step 2: Add the function to `ArcheryScorecard.jsx`**

Insert after line 612 (the closing `}` of `endRangeStats`), before the blank line that precedes `dispersionTrend`:

```js
// Population standard deviation of a session's individual arrow scores — a
// "how steady, not just how good" measure. Two sessions can share the same
// average and be very different achievements: one nervy with a wide score
// spread, one tight and repeatable. Lower stddev = more consistent.
function scoreStdDevBySession(completedList) {
  return completedList
    .slice()
    .sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
    .map(e => {
      const scores = flattenArrows(e).map(a => a.score);
      if (scores.length < 2) return { label: formatDateShort(e.completedAt), stddev: null };
      const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
      const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
      return { label: formatDateShort(e.completedAt), stddev: Math.sqrt(variance) };
    });
}
```

- [ ] **Step 3: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)` and no errors.

- [ ] **Step 4: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add scoreStdDevBySession() for a per-session consistency measure"
```

---

### Task 2: Wire the chart into `StatisticheScreen`

**Files:**
- Modify: `ArcheryScorecard.jsx` — add a `useMemo` near line 2003 (immediately after the existing `trend` useMemo, before the `pb` line) and a new `ChartCard` in the JSX near line 2101 (immediately after the "Andamento media a freccia" `ChartCard` closes, before the "Andamento colori nel tempo" `ChartCard` begins).

**Interfaces:**
- Consumes: `scoreStdDevBySession(completedList)` from Task 1 (returns `[{label, stddev}, ...]`). `completed` (the already-filtered entry list already in scope in `StatisticheScreen`, same list `trend` is built from). Existing components `ChartCard`, `EmptyChart`, and Recharts imports (`ResponsiveContainer`, `LineChart`, `Line`, `CartesianGrid`, `XAxis`, `YAxis`, `Tooltip`) — all already imported/defined in this file, no new imports needed.
- Produces: nothing consumed by later tasks — this is the final visible deliverable.

- [ ] **Step 1: Add the `useMemo`**

Find this existing block (around line 2000-2003):

```js
  const trend = useMemo(() =>
    completed.slice().sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(e => ({ label: formatDateShort(e.completedAt), avg: entryAvg(e) })),
    [completed]);
```

Add immediately after it (still before the `const pb = ...` line):

```js
  const consistencyTrend = useMemo(() => scoreStdDevBySession(completed), [completed]);
```

- [ ] **Step 2: Add the "Costanza" chart**

Find the existing "Andamento media a freccia" `ChartCard` (around line 2088-2101):

```jsx
          <ChartCard title="Andamento media a freccia">
            {trend.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                    formatter={(v) => [Number(v).toFixed(2), 'media a freccia']} />
                  <Line type="monotone" dataKey="avg" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>
```

Insert this new block immediately after its closing `</ChartCard>`, before the "Andamento colori nel tempo" `ChartCard`:

```jsx
          <ChartCard title="Costanza">
            {consistencyTrend.filter(c => c.stddev != null).length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={consistencyTrend}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                    formatter={(v) => [`σ = ${Number(v).toFixed(2)} punti`, 'costanza']} />
                  <Line type="monotone" dataKey="stddev" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>
```

Note: the gate uses `consistencyTrend.filter(c => c.stddev != null).length >= 2` rather than `consistencyTrend.length >= 2` — a `null` `stddev` (an entry with fewer than 2 scored arrows) shouldn't count toward the "enough data" threshold, since the chart would render null gaps for the same 2-session minimum `trend.length >= 2` implicitly assumes has real values.

- [ ] **Step 3: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)` and no errors.

- [ ] **Step 4: Live-verify in the browser**

1. Start the preview server (name `static`, port 8934) and navigate to `http://localhost:8934`.
2. If prompted to log in, stop and ask the user to log in — never enter credentials.
3. Open the "Statistiche" tab.
4. Tap a round-shape row that has at least 2 completed sessions (e.g. "Indoor 18m" or "Targa 70m" from the existing data).
5. Scroll to the scoped section and confirm:
   - A "Costanza" chart appears directly below "Andamento media a freccia".
   - The line is fully drawn immediately (not stuck at the first frame — confirms `isAnimationActive={false}` took effect).
   - Hovering/tapping a point shows a tooltip formatted like `σ = 1.23 punti`.
6. Take a screenshot for the record.

- [ ] **Step 5: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add Costanza consistency trend chart to Statistiche"
```

---

### Task 3: Document in README and push

**Files:**
- Modify: `README.md` — append a new `## v1.11 additions` section after the existing `## v1.10 additions` section (end of file).

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (final task).

- [ ] **Step 1: Add the README section**

Append to the end of `README.md`:

```markdown

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
```

- [ ] **Step 2: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully (README changes don't affect the build, but this confirms nothing else broke since Task 2).

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "Document v1.11 Costanza consistency chart in README"
git push
```

- [ ] **Step 4: Confirm the push landed**

Run: `git log --oneline -5` and `git status`
Expected: the three commits from this plan appear at the top of the log, and `git status` reports the branch is up to date with its remote (no unpushed commits).
