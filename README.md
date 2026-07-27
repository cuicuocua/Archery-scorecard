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
storage — sign in with an email one-time code and your sessions follow
you to any device. Schema in `supabase/schema.sql`; the project URL and
publishable ("anon") key are inlined near the top of
`ArcheryScorecard.jsx` — that key is meant to be public, security comes
from the RLS policies in the schema, not from hiding it.

This is v1: data model and export are the focus, no service worker /
full offline install yet — that's a deliberate follow-up (though sync
across devices, the main reason you'd want that, is already solved via
Supabase).

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

Each session is one row in Supabase's `sessions` table (`id`, `user_id`,
`data jsonb`) — the whole session object (round snapshot, ends, arrows,
conditions, etc.) lives in `data`, upserted on every change. Each session
snapshots its round config at creation time, so editing `ROUND_TYPES`
later never corrupts historical data. Arrows keep entry order; UI sorts a
copy for display. Arrows entered via the tappable face carry `x`/`y`
(normalized -1..1, fraction of face radius); keypad-entered arrows have
`x`/`y: null` and are excluded from spatial analysis (correctly — there's
no position to analyze).

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
  Supabase, with an email one-time-code login gate (`AuthGate`). See
  "Data model" above.
- **Importa**: the counterpart to Export, on the Storico screen — loads a
  JSON file in the same shape `exportJson` produces (or a bare array of
  sessions) and upserts it, so re-importing an updated file is safe.
  Existing browser-local data from before this version is offered as a
  one-time import prompt on first login (`findLegacyLocalSessions`).
- **GitHub Pages deployment**: the app now has a permanent URL independent
  of any particular conversation or session — see the top of this file.
