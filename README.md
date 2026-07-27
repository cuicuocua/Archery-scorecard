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

Assumptions made, to check against FITARCO rules:
- **Indoor 18m**: 40cm face, 3 frecce/volée, 20 volée (60 frecce) — standard.
- **Indoor 25m**: 60cm face, 3×20 — mirrors the 18m structure for the
  Italian indoor 25+18 combined round.
- **Targa 70m / 60m**: 122cm face, 6×12 (72 frecce) — 70m is the
  WA1440/720 distance; 60m covers some categories.
- **Targa 50m**: 80cm face, 6×12 — typical compound/barebow setup.
- **Allenamento libero**: fully editable at session start (distance,
  face, arrows/end, ends), defaults are just a starting point.

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
