# Arcieri Senesi — Scorecard

`ArcheryScorecard.jsx` is a single-file React component built for the
claude.ai artifact runtime (React + `window.storage` + `recharts` +
`lucide-react`, Tailwind core utilities only). Paste it into a Claude
artifact to use it on your phone during a session.

This is v1: data model and export are the focus, no service worker /
PWA / offline install yet — that's a deliberate follow-up.

## Round definitions

Edit the `ROUND_TYPES` array at the top of the file — every field
(distance, face diameter, arrows/end, number of ends) drives the whole
app, nothing about a round is hardcoded elsewhere.

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
  arrows/end, ends) — for anything not covered above (para/youth classes,
  club rounds, etc.), and available for both allenamento and gara.
- Compound's WA rule of only scoring the inner 5-10 zone ("compound
  face") is **not** modelled — every bow type scores the full 10-zone
  face here.

Scoring: 10 zones, X is the inner half of the 10 ring (worth 10, counted
separately). Ring colours centre-out: gold, gold, red, red, blue, blue,
black, black, white, white.

## Data model

Everything lives under one `window.storage` key
(`archery-scorecard-v1`) as `{ sessions: [...] }`. Each session snapshots
its round config at creation time, so editing `ROUND_TYPES` later never
corrupts historical data. Arrows keep entry order; UI sorts a copy for
display. Arrows entered via the tappable face carry `x`/`y` (normalized
-1..1, fraction of face radius); keypad-entered arrows have `x`/`y: null`
and are excluded from spatial analysis (correctly — there's no position
to analyze).

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
  session start via "Allenamento libero" (hidden when tipo = Gara, since
  competitions don't use ad-hoc distances).
- **Analisi avanzata**: unlocks once a round+arco+tipo combination has at
  least `MIN_SESSIONS_FOR_DEEP_ANALYSIS` (5) completed sessions —
  dispersion-over-time, horizontal/vertical bias-over-time, and a score
  distribution histogram.
- **Condizioni**: after finishing a round (and editable later from a
  session's detail view), pick wind / time of day / sun position
  (single-select) and other factors like rain or fatigue (multi-select)
  — always by choice, never free text, so it stays analyzable. Feeds a
  "media per condizioni" chart in Analisi avanzata once you have data.
