# Arcieri Senesi — Scorecard

`ArcheryScorecard.jsx` is a single-file React component (React + recharts +
lucide-react + `@supabase/supabase-js`, Tailwind core utilities only).
It's built and deployed automatically to GitHub Pages by
`.github/workflows/deploy-pages.yml` on every push to this branch — see
`site/` for the build tooling. `build.js` compiles Tailwind and bundles
with esbuild into two self-contained pages: `site/dist/index.html` (the
app, from `entry.jsx`) and `site/dist/share.html` (the public spectator
page, from `share.jsx` — see v1.23 in CHANGELOG.md).
`ArcheryScorecard.jsx` itself is the only file that matters for the app's
behavior; everything under
`site/` is just plumbing to publish it as static pages.

Data lives in Supabase (Postgres + row-level security) — sign in with an
email + password and your sessions follow you to any device. Schema in
`supabase/schema.sql`; the project URL and publishable ("anon") key are
inlined near the top of `ArcheryScorecard.jsx` — that key is meant to be
public, security comes from the RLS policies in the schema, not from
hiding it. Every write you make while signed in also goes through a
per-account localStorage outbox first (see "Offline-resilient saves"
in CHANGELOG.md), so Supabase stays the source of truth but a save made
without
connectivity isn't lost. The one write that doesn't is a participant
submitting their own match score from a public share link — they have no
account and no outbox, so that one needs connectivity at the moment they
send it, and says so plainly when it doesn't have it (see v1.23 in
CHANGELOG.md).

The app installs as an offline-capable PWA (`site/sw.js` — see v1.18 in
CHANGELOG.md): the app shell still opens with no connectivity, and
cross-device sync is
handled by Supabase as above.

## Round definitions

Edit the `ROUND_TYPES` array at the top of the file.

A round may carry `bows: ['ricurvo', ...]`, which scopes it to those bow
types in the picker (see v1.26 in CHANGELOG.md); leaving it off offers the
round to everyone. Tag a round only where FITARCO's Regolamento Tecnico
Libro 2 ties its face to a division regardless of age class, and cite the
article — see the comment above `RECURVE_BOWS` for the two that qualify.
 Every round is a list
of `stages` (distance, face diameter, arrows/end, number of ends per
stage) — nothing about a round is hardcoded elsewhere. Most rounds are one
stage; a few (WA1440, WA Combined) are shot as several distances back to
back within a single session.

Assumptions made, to check against FITARCO/World Archery rules:
- **Indoor 18m**: 40cm face, 3 frecce/volée, 20 volée (60 frecce) — standard.
- **Vegas 3 punti**: 18m/40cm triangular triple, 3×10 (30 frecce), in two
  versions — the full ten-ring one for ricurvo/nudo and a compound one
  scoring the inner 10, per the Las Vegas Shoot's compound divisions and
  the same World Archery indoor rule the compound triples already use.
- **Indoor 25m**: 60cm face, 3×20 — mirrors the 18m structure. FITARCO
  Libro 2 art. 4.7.3 recognises the Gara al Chiuso a 25 metri and the
  Combinata (25m+18m) for Olimpico, Arco Nudo and Compound alike, and
  art. 7.2.2 lists single, triple-triangular and triple-vertical 60cm
  faces, so all three 25m variants here are real faces.
- **Targa 90m / 70m / 60m**: 122cm face, 6×12 (72 frecce) — 90/70m are the
  WA1440 long distances (70m is also the current WA outdoor ranking-round
  distance); 60m covers some categories (para, juniors).
- **Targa 50m / 40m / 30m**: 80cm face, 6×12 — the WA1440 short distances.
  50m/80cm is also FITARCO's 50 metri Compound Round (Libro 2 art. 4.5.1.3),
  but recurve shoots 50m on the 80cm face in the 1440 too, so it is not
  scoped to compound.
- **Targa 50m — arco nudo**: 122cm face, 6×12 (72 frecce). Barebow's own
  qualification round (FITARCO Libro 2 art. 4.5.1.7), and the only outdoor
  distance+face the rules give to a single division — everyone else
  shooting 50m is on the 80cm face.
- **Personalizzata**: fully editable at session start (distance, face,
  arrows/end, ends per stage), and lets you add more stages via
  "+ Aggiungi tappa" — this is how WA1440 (any of its several age/gender
  distance combinations), WA Combined, or any club-invented multi-distance
  round get logged, since there's no single fixed distance list that
  covers every WA1440 variant. Available for both allenamento and gara.
- There are **two** 80cm faces, and both are here (FITARCO Libro 2
  art. 7.2.2). The plain one prints all ten rings and is the default at
  50/40/30m per art. 7.2.3 — that is Targa 50m/40m/30m. The
  "80 cm/sei zone di punteggio" prints only rings 5–10 and is used when the
  boss carries several faces at once (compulsory for compound at 30m,
  art. 7.2.3; the Compound Match Round face, art. 7.2.3.4) — that is the
  "— 6 zone" set, carrying `ringClass: 'outdoor6'`. v1.16 applied the cut
  face to every 80cm round, which scored every 1–4 at those distances as a
  miss; corrected in v1.27. 40/60/122cm faces are the full 10-zone face.

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
definitions" above. Each stage snapshots its own round config at creation
time, so editing `ROUND_TYPES` later never corrupts historical data. Arrows
keep entry order within a stage; UI sorts a copy for display. Arrows
entered via the tappable face carry `x`/`y` (normalized -1..1, fraction of
face radius); keypad-entered arrows have `x`/`y: null` and are excluded
from spatial analysis (correctly — there's no position to analyze). On a
multi-spot face an arrow also carries `spot`, and its `x`/`y` are that
spot's own local coordinates — normalized to the SPOT's radius, not the
sheet's. An end carries `at` (v1.22+), the moment its volée was confirmed;
ends saved before that have none and every reader skips them.

Sessions saved before v1.4 have a flat `round`+`ends` instead of `stages`;
`normalizeSession()` upgrades them to the new shape on load (wrapped as a
single stage) without touching stored data — they only get rewritten to
the new shape the next time they're edited.

## Export

The download icon on the Storico screen exports the full sessions array
as JSON, meant to seed the future offline app.

## Change history

Every version's additions, from v1.1 to the present, are in
[CHANGELOG.md](CHANGELOG.md) — kept oldest-first, so the newest work is at
the bottom. It was split out of this file once the reference above had ~800
lines of history sitting on top of it.
