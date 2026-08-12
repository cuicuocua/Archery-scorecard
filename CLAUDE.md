# archery-scorecard

Scorecard web app for tracking archery rounds and scores, deployed to GitHub Pages. See `README.md` for the full write-up.

## Architecture

`ArcheryScorecard.jsx` is the app — a single-file React component (React + recharts + lucide-react + supabase-js, Tailwind core utilities only). **It's the only file whose contents matter for behavior.** Everything under `site/` is publishing plumbing: `entry.jsx` mounts it, `build.js` bundles it with esbuild + Tailwind into `site/dist/index.html`, and `.github/workflows/deploy-pages.yml` builds and deploys on every push. Data lives in Supabase Postgres; schema in `supabase/schema.sql`.

Build with `npm run build`.

## Rules

- Round definitions live in the `ROUND_TYPES` array at the top of `ArcheryScorecard.jsx` — nothing about a round is hardcoded anywhere else. Add or change rounds there.
- The Supabase URL and publishable ("anon") key are inlined near the top of the JSX **deliberately**. That key is meant to be public; security comes from the RLS policies in `supabase/schema.sql`. Don't report or "fix" it as a leaked secret.
- Every write **by the signed-in owner** goes through a per-account localStorage outbox before Supabase, so a save made offline isn't lost. Keep that path intact when touching save logic. One write does not: a participant submitting their own match score from the public share page has no auth session and no outbox, so that's a bare RPC with no retry — don't assume the outbox covers it.
- There **is** a service worker (`site/sw.js`, v1.18): the app shell opens with no connectivity and installs as a PWA. It caches the shell only — data still comes from Supabase, so offline *reads* of your sessions are not covered. This rule used to say the opposite; it was written before v1.18 shipped one.
- Round definitions are assumptions to verify against FITARCO / World Archery rules. Cite the source when changing one.

## Knowledge graph

There's a workspace graph at `/Users/teo/Claude/graphify-out/`. For codebase questions run `graphify query "<question>"` (also `graphify path "<A>" "<B>"` and `graphify explain "<concept>"`) before falling back to grep, and `graphify update .` after changing code.
