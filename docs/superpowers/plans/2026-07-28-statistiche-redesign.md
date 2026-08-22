# Statistiche Redesign Implementation Plan

> **Shipped in v1.10** — Statistiche redesign. This is a historical planning record, not open work.
> Its step checkboxes below were never ticked; they are left as they were written rather than
> back-filled with a completion record nobody witnessed. See `CHANGELOG.md` for what actually
> shipped. **The "REQUIRED SUB-SKILL" note that follows no longer applies** — there is nothing
> here left to implement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all per-round analysis out of `StoricoScreen` (currently gated behind a filter, easy to miss) into `StatisticheScreen`, which becomes the app's real analysis home — scoped by round shape instead of blended across every round type — and fix the app-wide invisible-chart bug along the way.

**Architecture:** `StatisticheScreen` gains a tappable round-shape selector (reusing the existing `bestByShape()` data) that drives a scoped analysis section built from logic already proven in `StoricoScreen` (trend, personal best, cumulative group target face, dispersion/distribution/conditions deep-analysis), just relocated and re-parameterized by local filter state instead of `StoricoScreen`'s. `StoricoScreen` then sheds that block entirely, going back to pure browse/filter/list.

**Tech Stack:** React 18 (hooks only, no class components), Tailwind utility classes, Recharts for charts — all within the single `ArcheryScorecard.jsx` file (this project's established one-file architecture; do not split it).

## Global Constraints

- **No test framework in this repo.** Every task's verification step is `npm run build` (must exit with no errors) followed by a live check in the browser preview (`mcp__Claude_Browser__*` tools, local static server per `.claude/launch.json`) — not automated tests. This matches how every other feature in this codebase has been verified this session.
- Every `<Bar>` and `<Line>` element touched by this plan must include `isAnimationActive={false}` — this is the fix for the confirmed bug where Recharts' entrance animation gets stuck at its first frame (verified via React fiber inspection: a `<Line>`'s rendered `<path>` had `stroke-dasharray="6px 1184px"`, meaning the draw-in animation never advanced).
- All Italian UI copy must match the existing style exactly: lowercase sentence case, existing terms reused verbatim (`Sessioni`, `Frecce`, `Media`, `Primato`, `Tutti i tipi`, `Tutti gli archi`, etc.) — do not invent new phrasing where an existing label already covers the concept.
- Reuse existing helper functions as-is (`stageEntries`, `bestByShape`, `hitRateByColor`, `fatigueCurve`, `dispersionTrend`, `scoreDistribution`, `scoreByCondition`, `findPersonalBest`, `computeGroupStats`, `roundShapeKey`, `roundShapeLabel`, `totalScore`, `formatDateShort`, `MIN_SESSIONS_FOR_DEEP_ANALYSIS`) — none of them change in this plan, only their call sites move.

---

## Task 1: Rebuild `StatisticheScreen` — lifetime header + tappable round-shape selector

Replaces the blended lifetime stat tiles and the static "Primati per distanza" list with a trimmed lifetime header (raw counts only, no blended average) and a tappable round-shape list that becomes the selector for Task 2's scoped section. After this task, tapping a row visibly selects it (highlighted like an active `FilterChip`) but nothing else on the page reacts yet — that's Task 2.

**Files:**
- Modify: `ArcheryScorecard.jsx` — the `StatisticheScreen` function (currently lines 2034–2138)

**Interfaces:**
- Consumes: `stageEntries`, `bestByShape`, `roundShapeKey`, `roundShapeLabel`, `SESSION_TYPES`, `StatTile`, `numeralStyle` (all pre-existing, unchanged)
- Produces: `StatisticheScreen` now holds local state `filterId` (`string | null`, a `roundShapeKey()` value or `null` when there are no completed entries at all) — Task 2 reads and extends this same state.

- [ ] **Step 1: Replace the `StatisticheScreen` function body**

Find the current `StatisticheScreen` function (starts `function StatisticheScreen({ sessions }) {` at line 2034, ends at line 2138) and replace its entire contents with:

```jsx
function StatisticheScreen({ sessions }) {
  const completedSessions = useMemo(() => sessions.filter(s => s.status === 'completed'), [sessions]);
  const entries = useMemo(() => stageEntries(completedSessions), [completedSessions]);

  const totalArrows = entries.reduce((s, e) => s + arrowsShotCount(e), 0);
  const totalX = entries.reduce((s, e) => s + xCount(e), 0);

  const shapeRows = useMemo(() => bestByShape(entries), [entries]);

  const typeCounts = useMemo(() => {
    const counts = {};
    SESSION_TYPES.forEach(t => (counts[t.id] = 0));
    completedSessions.forEach(s => { counts[s.sessionType || 'allenamento'] += 1; });
    return counts;
  }, [completedSessions]);

  // Defaults to whichever round shape was most recently completed, so the
  // scoped section below always opens on something relevant instead of an
  // empty "pick one" state. Lazy initializer: only needs to run once, since
  // `entries` at mount time is what a first-time visitor sees regardless of
  // later data changes (re-selecting explicitly is what chip taps are for).
  const [filterId, setFilterId] = useState(() => {
    if (!entries.length) return null;
    const latest = entries.reduce((a, b) => (new Date(b.completedAt) > new Date(a.completedAt) ? b : a));
    return roundShapeKey(latest.round);
  });

  if (!completedSessions.length) {
    return (
      <div className="w-full mx-auto px-4 pt-4 pb-8 flex flex-col gap-4">
        <h1 className="text-xl font-bold">Statistiche</h1>
        <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
          Completa qualche sessione per iniziare a vedere le tue statistiche cumulative.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">
      <h1 className="text-xl font-bold">Statistiche</h1>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Sessioni" value={completedSessions.length} />
        <StatTile label="Frecce" value={totalArrows} />
        <StatTile label="X totali" value={totalX} />
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Sessioni per tipo</div>
        <div className="grid grid-cols-3 gap-2">
          {SESSION_TYPES.map(t => <StatTile key={t.id} label={t.label} value={typeCounts[t.id]} />)}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold" style={{ color: T.textDim }}>Le tue prove</div>
        <div className="flex flex-col gap-2">
          {shapeRows.map(row => {
            const key = roundShapeKey(row.round);
            const active = key === filterId;
            return (
              <button key={key} onClick={() => setFilterId(key)}
                className="text-left rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
                style={{ background: active ? T.surfaceAlt : T.surface, border: `1px solid ${active ? T.gold : T.border}` }}>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{roundShapeLabel(row.round)}</div>
                  <div className="text-xs" style={{ color: T.textDim }}>media {row.avg.toFixed(1)} · {row.count} sessioni</div>
                </div>
                <div className="text-lg font-bold shrink-0" style={numeralStyle}>{row.best}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify no errors**

Run: `npm run build`
Expected: completes with `Built site/dist/index.html (... KB)` and no errors.

- [ ] **Step 3: Verify live in the browser**

Start the local preview (`.claude/launch.json` "static" config, or `preview_start` with name `static`), navigate to the app, log in, tap the **Statistiche** tab. Confirm:
- Three lifetime tiles show `Sessioni` / `Frecce` / `X totali` with real non-zero numbers (no `Media/freccia` tile anymore).
- "Sessioni per tipo" grid still shows Allenamento/Gara/Gara sociale counts.
- "Le tue prove" shows one row per round shape you've shot, sorted by distance descending, each with `media X · N sessioni` and a best-score number.
- Exactly one row is pre-highlighted (gold border) on page load — the most recently completed round shape.
- Tapping a different row moves the highlight to that row (nothing else changes yet — that's expected, Task 2 adds the reactive section).

- [ ] **Step 4: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "$(cat <<'EOF'
Rebuild Statistiche lifetime header and add tappable round-shape list

Drops the blended Media/freccia lifetime stat (a per-round-type average
that shouldn't be summed across incomparable round shapes). "Primati per
distanza" becomes a tappable selector, defaulting to the most recently
completed round shape — the foundation for scoping the rest of the page
by round type instead of blending everything together.
EOF
)"
```

---

## Task 2: Add secondary filters and the full scoped analysis section

Makes tapping a round-shape row (from Task 1) actually reveal a scoped analysis section below it: type/bow filter chips, stat tiles, trend chart, color-distribution chart, fatigue chart, cumulative group target face, and the gated "Analisi avanzata" block — all moved from `StoricoScreen`'s existing filtered view, plus the color chart promoted from the old lifetime-blended Statistiche page.

**Files:**
- Modify: `ArcheryScorecard.jsx` — `StatisticheScreen`, extending the version Task 1 produced

**Interfaces:**
- Consumes: `filterId`/`setFilterId` from Task 1, plus `stageEntries`, `hitRateByColor`, `fatigueCurve`, `dispersionTrend`, `scoreDistribution`, `scoreByCondition`, `computeGroupStats`, `SESSION_TYPES`, `BOW_TYPES`, `CONDITION_DIMENSIONS`, `MIN_SESSIONS_FOR_DEEP_ANALYSIS`, `ScrollFadeRow`, `FilterChip`, `ChartCard`, `EmptyChart`, `SegmentedControl`, `TargetFace` (all pre-existing, unchanged)
- Produces: nothing new consumed by later tasks — this completes `StatisticheScreen`.

- [ ] **Step 1: Add filter state and the three-way-filtered data pipeline**

In `StatisticheScreen`, immediately after the `filterId` state declaration added in Task 1, add:

```jsx
  const [typeFilter, setTypeFilter] = useState('all');
  const [bowFilter, setBowFilter] = useState('all');
  const [conditionDim, setConditionDim] = useState('wind');

  const typeAndBowFiltered = sessions.filter(s =>
    (typeFilter === 'all' || (s.sessionType || 'allenamento') === typeFilter) &&
    (bowFilter === 'all' || s.bowType === bowFilter));
  const allEntries = useMemo(() => stageEntries(typeAndBowFiltered), [typeAndBowFiltered]);
  const activeShape = filterId ? shapeRows.find(r => roundShapeKey(r.round) === filterId)?.round : null;
  const matchingEntries = filterId ? allEntries.filter(e => roundShapeKey(e.round) === filterId) : [];
  const completed = matchingEntries.filter(e => e.status === 'completed');

  const trend = useMemo(() =>
    completed.slice().sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(e => ({ label: formatDateShort(e.completedAt), score: totalScore(e) })),
    [completed]);
  const pb = completed.length ? completed.reduce((b, e) => (totalScore(e) > totalScore(b) ? e : b)) : null;
  const avgScore = completed.length ? completed.reduce((s, e) => s + totalScore(e), 0) / completed.length : null;
  const colorData = useMemo(() => hitRateByColor(completed), [completed]);
  const fatigue = useMemo(() => (filterId ? fatigueCurve(completed) : []), [completed, filterId]);
  const allArrows = useMemo(() => completed.flatMap(e => flattenArrows(e)), [completed]);
  const cumGroup = useMemo(() => (activeShape ? computeGroupStats(allArrows, activeShape.faceCm) : null), [allArrows, activeShape]);
  const dispersion = useMemo(() => (filterId ? dispersionTrend(completed) : []), [completed, filterId]);
  const distribution = useMemo(() => (filterId ? scoreDistribution(completed) : []), [completed, filterId]);
  const byCondition = useMemo(() => (filterId ? scoreByCondition(completed, conditionDim) : []), [completed, filterId, conditionDim]);
  const deepAnalysisReady = filterId != null && completed.length >= MIN_SESSIONS_FOR_DEEP_ANALYSIS;
```

This is the exact same pipeline `StoricoScreen` already runs (`typeAndBowFiltered` → `stageEntries` → filter by `roundShapeKey` → `completed`), just against this component's own `filterId`/`typeFilter`/`bowFilter` state instead of `StoricoScreen`'s.

- [ ] **Step 2: Render the scoped section**

Immediately after the "Le tue prove" `</div>` closing block Task 1 added (still inside the outer `<div className="w-full mx-auto px-4 pt-4 pb-8 flex flex-col gap-5">`), add:

```jsx
      {filterId && (
        <>
          <div className="flex flex-col gap-2">
            <ScrollFadeRow>
              <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} label="Tutti i tipi" />
              {SESSION_TYPES.map(t => <FilterChip key={t.id} active={typeFilter === t.id} onClick={() => setTypeFilter(t.id)} label={t.label} />)}
            </ScrollFadeRow>
            <ScrollFadeRow>
              <FilterChip active={bowFilter === 'all'} onClick={() => setBowFilter('all')} label="Tutti gli archi" />
              {BOW_TYPES.map(b => <FilterChip key={b.id} active={bowFilter === b.id} onClick={() => setBowFilter(b.id)} label={b.label} />)}
            </ScrollFadeRow>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Sessioni" value={completed.length} />
            <StatTile label="Media" value={avgScore != null ? avgScore.toFixed(1) : '—'} />
            <StatTile label="Primato" value={pb ? totalScore(pb) : '—'} />
          </div>

          <ChartCard title="Andamento punteggio">
            {trend.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }} />
                  <Line type="monotone" dataKey="score" stroke={T.gold} strokeWidth={2} dot={{ r: 3, fill: T.gold }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Servono almeno 2 sessioni completate" />}
          </ChartCard>

          <ChartCard title="Frecce per colore">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={colorData}>
                <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 11 }} />
                <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={32} unit="%" />
                <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                  formatter={(v, name, item) => [`${item.payload.count} frecce (${Number(v).toFixed(1)}%)`, 'frecce']} />
                <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {colorData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Media per volée (curva di fatica)">
            {fatigue.filter(f => f.avg != null).length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fatigue}>
                  <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="end" stroke={T.textDim} tick={{ fontSize: 11 }} />
                  <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                  <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                    formatter={(v) => [Number(v).toFixed(2), 'media']} labelFormatter={(l) => `Volée ${l}`} />
                  <Bar dataKey="avg" fill={T.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Dati insufficienti" />}
          </ChartCard>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Gruppo cumulativo</div>
            <TargetFace faceCm={activeShape.faceCm} points={allArrows.filter(a => a.x != null)} centroid={cumGroup} dense />
            {cumGroup ? (
              <div className="text-sm" style={{ color: T.textDim }}>
                Deviazione orizzontale: {Math.abs(cumGroup.cxCm).toFixed(1)} cm {cumGroup.cxCm >= 0 ? 'a destra' : 'a sinistra'} ·
                {' '}Deviazione verticale: {Math.abs(cumGroup.cyCm).toFixed(1)} cm {cumGroup.cyCm >= 0 ? 'in basso' : 'in alto'} · {cumGroup.count} frecce
              </div>
            ) : <div className="text-sm" style={{ color: T.textDim }}>Nessuna freccia con posizione registrata (modalità tastierino).</div>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Analisi avanzata</div>
            {!deepAnalysisReady ? (
              <div className="rounded-2xl p-4 text-sm" style={{ background: T.surface, border: `1px dashed ${T.border}`, color: T.textDim }}>
                Servono almeno {MIN_SESSIONS_FOR_DEEP_ANALYSIS} sessioni completate per questa combinazione di prova, tipo e arco
                {' '}(ne hai {completed.length}). Continua a registrare i tuoi allenamenti e le tue gare.
              </div>
            ) : (
              <>
                <ChartCard title="Dispersione media nel tempo (cm)">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dispersion}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 'auto']} />
                      <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                        formatter={(v) => [`${Number(v).toFixed(1)} cm`, 'dispersione']} />
                      <Line type="monotone" dataKey="dispersion" stroke={T.blue} strokeWidth={2} dot={{ r: 3, fill: T.blue }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Deriva orizzontale e verticale (cm)" tall>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dispersion}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                        formatter={(v, name) => [`${Number(v).toFixed(1)} cm`, name === 'biasX' ? 'orizzontale' : 'verticale']} />
                      <Legend formatter={(value) => (value === 'biasX' ? 'Orizzontale' : 'Verticale')} wrapperStyle={{ fontSize: 11, color: T.textDim }} />
                      <Line type="monotone" dataKey="biasX" stroke={T.gold} strokeWidth={2} dot={{ r: 2, fill: T.gold }} isAnimationActive={false} />
                      <Line type="monotone" dataKey="biasY" stroke={T.red} strokeWidth={2} dot={{ r: 2, fill: T.red }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Distribuzione dei punteggi">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={distribution}>
                      <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 11 }} />
                      <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }} />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                        {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
                  <div className="text-sm font-semibold" style={{ color: T.textDim }}>Media per condizioni</div>
                  <div className="overflow-x-auto pb-1">
                    <SegmentedControl options={CONDITION_DIMENSIONS} value={conditionDim} onChange={setConditionDim} small />
                  </div>
                  <div className="h-40">
                    {byCondition.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={byCondition}>
                          <CartesianGrid stroke={T.border} strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="key" stroke={T.textDim} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={40} />
                          <YAxis stroke={T.textDim} tick={{ fontSize: 11 }} width={28} domain={[0, 10]} />
                          <Tooltip contentStyle={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }} labelStyle={{ color: T.text }}
                            formatter={(v, name, item) => [`${Number(v).toFixed(2)} (${item.payload.count} sessioni)`, 'media']} />
                          <Bar dataKey="avg" fill={T.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <EmptyChart text="Nessuna condizione registrata per queste sessioni ancora" />}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
```

- [ ] **Step 3: Build and verify no errors**

Run: `npm run build`
Expected: completes clean, no errors.

- [ ] **Step 4: Verify live in the browser — chart rendering fix**

Navigate to Statistiche. Confirm the "Frecce per colore" bar chart shows actual visible colored bars (not an empty axis), and "Andamento punteggio" shows a visible gold line with dots. Use the browser JS console/devtools if needed to confirm: the `<Bar>` rectangles exist in the DOM (`document.querySelectorAll('.recharts-bar-rectangle rect, .recharts-bar-rectangle path').length > 0`), and a rendered `<Line>` path's `stroke-dasharray` covers its full length rather than being stuck near zero.

- [ ] **Step 5: Verify live in the browser — scoped analysis**

Pick a round shape with 5+ completed sessions (e.g. the imported "Indoor 18m" data). Confirm:
- Type/bow filter chips appear and narrow the section correctly when tapped.
- Stat tiles (`Sessioni`/`Media`/`Primato`) show numbers matching what `StoricoScreen`'s filtered view currently shows for the same round+type+bow combination (cross-check against `StoricoScreen` before Task 3 removes it).
- All charts render with visible data: trend line, color bars, fatigue bars, dispersion lines (both charts), score distribution bars, conditions bars (if any conditions were logged).
- "Gruppo cumulativo" shows the target face and the "Nessuna freccia con posizione registrata" message (expected — these are keypad-entered sessions with no x/y).
- Pick a round shape with fewer than 5 sessions and confirm the "Servono almeno 5 sessioni..." placeholder shows instead of the deep-analysis charts.
- Switch round shapes and confirm the previously-selected type/bow filters persist (independent state, not reset).

- [ ] **Step 6: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "$(cat <<'EOF'
Add scoped analysis section to Statistiche, fix invisible charts

Selecting a round shape now reveals the full per-round breakdown (moved
from Storico's filtered view): type/bow filters, stat tiles, score trend,
color distribution, fatigue curve, cumulative group target face, and the
5-session-gated deep analysis (dispersion, score distribution,
conditions). Every chart gets isAnimationActive={false}, fixing Recharts'
entrance animation getting stuck at its first frame — bars and lines were
rendering with correct data but zero visible pixels.
EOF
)"
```

---

## Task 3: Strip `StoricoScreen` down to filters + list only

Removes the now-duplicated analysis block from `StoricoScreen`, since Task 2 moved all of it to `StatisticheScreen`. `StoricoScreen` keeps its three filter chip rows (still useful for narrowing the browse list) and the session list itself — nothing else changes about how the list renders.

**Files:**
- Modify: `ArcheryScorecard.jsx` — `StoricoScreen` (currently lines 1729–1953)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed elsewhere — this is a pure deletion within `StoricoScreen`.

- [ ] **Step 1: Remove the unused per-shape analysis computations**

In `StoricoScreen`, delete these `useMemo`/plain declarations (everything computed only for the removed analysis block — `trend`, `pb`, `avgScore`, `fatigue`, `allArrows`, `cumGroup`, `dispersion`, `distribution`, `byCondition`, `deepAnalysisReady`, and the `conditionDim` state, since the conditions chart moved away):

```jsx
  const trend = useMemo(() =>
    completed.slice().sort((a, b) => new Date(a.completedAt) - new Date(b.completedAt))
      .map(e => ({ label: formatDateShort(e.completedAt), score: totalScore(e) })),
    [completed]);

  const pb = completed.length ? completed.reduce((b, e) => (totalScore(e) > totalScore(b) ? e : b)) : null;
  const avgScore = completed.length ? completed.reduce((s, e) => s + totalScore(e), 0) / completed.length : null;

  const fatigue = useMemo(() => (filterId === 'all' ? [] : fatigueCurve(completed)), [completed, filterId]);

  const allArrows = useMemo(() => completed.flatMap(e => flattenArrows(e)), [completed]);
  const cumGroup = useMemo(() => (activeShape ? computeGroupStats(allArrows, activeShape.faceCm) : null), [allArrows, activeShape]);

  const dispersion = useMemo(() => (filterId === 'all' ? [] : dispersionTrend(completed)), [completed, filterId]);
  const distribution = useMemo(() => (filterId === 'all' ? [] : scoreDistribution(completed)), [completed, filterId]);
  const byCondition = useMemo(() => (filterId === 'all' ? [] : scoreByCondition(completed, conditionDim)), [completed, filterId, conditionDim]);
  const deepAnalysisReady = filterId !== 'all' && completed.length >= MIN_SESSIONS_FOR_DEEP_ANALYSIS;
```

Also remove the `const [conditionDim, setConditionDim] = useState('wind');` line from the top of the component (the other three `useState` declarations — `filterId`, `typeFilter`, `bowFilter` — stay, they still drive the list filter).

Also remove two more declarations that only existed to feed the deleted block — `activeShape` (used solely by `cumGroup` and the "Gruppo cumulativo" JSX, both gone) and `completed` (used solely by the analysis JSX, also gone):

```jsx
  const activeShape = filterId === 'all' ? null : stageShapes.find(s => s.key === filterId)?.round;
```

```jsx
  const completed = matchingEntries.filter(e => e.status === 'completed');
```

`matchingEntries` itself stays — the "Sessioni" list section below still uses it directly to render `StageEntryRow` items.

- [ ] **Step 2: Remove the analysis JSX block**

Find this block (the `{filterId === 'all' ? (...) : (...)}` conditional that currently sits between the filter chip rows and the "Sessioni" list heading):

```jsx
      {filterId === 'all' ? (
        <div className="text-sm" style={{ color: T.textDim }}>{typeAndBowFiltered.length} sessioni. Seleziona una prova per le statistiche dettagliate.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Sessioni" value={completed.length} />
            ...
          </div>
        </>
      )}
```

(the full block spans from `{filterId === 'all' ? (` through its matching `)}`, currently lines ~1806–1931 — everything between the filter chips and the "Sessioni" heading `<div className="flex flex-col gap-2"><div className="text-sm font-semibold" ...>Sessioni</div>`).

Delete the entire block. `StoricoScreen`'s JSX now flows directly from the three `ScrollFadeRow` filter chip rows straight into the existing "Sessioni" list section (which already correctly branches on `filterId === 'all'` to choose between `SessionRow` and `StageEntryRow` rendering — that part is untouched).

- [ ] **Step 3: Build and verify no errors**

Run: `npm run build`
Expected: completes clean. If it fails with an "unused variable" or "undefined" error, double check Step 1 removed exactly the right set of now-dead declarations and nothing still references them.

- [ ] **Step 4: Verify live in the browser**

Navigate to Storico. Confirm:
- The three filter chip rows (round/type/bow) still work exactly as before.
- Selecting "Tutte le prove" shows the full session list (`SessionRow` items).
- Selecting a specific round shape shows the filtered per-stage list (`StageEntryRow` items) — no stat tiles, no charts, no "Analisi avanzata" section above the list anymore.
- Import/export/sign-out icons in the header still work.

- [ ] **Step 5: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "$(cat <<'EOF'
Strip Storico down to filters and list — analysis moved to Statistiche

Removes the stat tiles, trend/fatigue charts, cumulative group target
face, and Analisi avanzata block that Task 2 relocated to Statistiche.
Storico is now purely a session browser: filter chips (round/type/bow)
narrowing a list, plus import/export/sign-out — no duplicated analysis.
EOF
)"
```

---

## Post-implementation

Update `README.md` with a `## v2.0 additions` (or next appropriate version number — check the latest `## vX.Y additions` heading before picking one) section describing the Statistiche redesign, following this repo's existing README convention (see `README.md`'s prior `## v1.9 additions` section for the expected level of detail and tone). This is documentation, not a separate task — fold it into whichever of the three tasks above is executed last, or add it as a small final commit.
