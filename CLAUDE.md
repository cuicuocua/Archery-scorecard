# archery-scorecard

Scorecard web app for tracking archery rounds and scores, deployed to GitHub Pages. See `README.md` for the full write-up.

## Architecture

`ArcheryScorecard.jsx` is the app — a single-file React component (React + recharts + lucide-react + supabase-js, Tailwind core utilities only). **It's the only file whose contents matter for behavior.** Everything under `site/` is publishing plumbing: `build.js` bundles it with esbuild + Tailwind into **two** self-contained pages — `index.html` (the app, from `entry.jsx`) and `share.html` (the public spectator page, from `share.jsx`, which imports only `SharedTournamentScreen` so esbuild drops recharts and the rest of the personal scorecard). `.github/workflows/deploy-pages.yml` builds and deploys on every push. Data lives in Supabase Postgres; schema in `supabase/schema.sql`.

Build with `npm run build`.

## Rules

- Round definitions live in the `ROUND_TYPES` array at the top of `ArcheryScorecard.jsx` — nothing about a round is hardcoded anywhere else. Add or change rounds there.
- The Supabase URL and publishable ("anon") key are inlined near the top of the JSX **deliberately**. That key is meant to be public; security comes from the RLS policies in `supabase/schema.sql`. Don't report or "fix" it as a leaked secret.
- Every write **by the signed-in owner** goes through a per-account localStorage outbox before Supabase, so a save made offline isn't lost. Keep that path intact when touching save logic. One write does not: a participant submitting their own match score from the public share page has no auth session and no outbox, so that's a bare RPC — don't assume the outbox covers it. Because nothing retries it for them, that path has to surface its own failures, and does: the RPC's error is checked and the scored match is offered back with a retry button. Don't let it go back to reporting success unconditionally.
- There **is** a service worker (`site/sw.js`, v1.18): the app shell opens with no connectivity and installs as a PWA. It caches the shell only — data still comes from Supabase, so offline *reads* of your sessions are not covered. This rule used to say the opposite; it was written before v1.18 shipped one.
- Round definitions are assumptions to verify against FITARCO / World Archery rules. Cite the source when changing one.
- `@supabase/realtime-js` is aliased to a stub at build time (`site/realtime-stub.js`) — supabase-js builds a client for it unconditionally and this app has no realtime call sites by design. Restore the real package before trying to use channels; `channel()` throws to say so.

## Knowledge graph

This project's graph lives in `archery-scorecard/graphify-out/` (gitignored) — that's what `graphify update .` writes when run from here. There's also a workspace-wide graph at `/Users/teo/Claude/graphify-out/`, but it is a **separate, older** artifact covering every sibling project; `graphify update .` never refreshes it. Don't confuse the two.

For codebase questions run `graphify query "<question>"` (also `graphify path "<A>" "<B>"` and `graphify explain "<concept>"`) before falling back to grep, and `graphify update .` after changing code — **and before trusting a query, if the tree has moved since the last build.** A stale graph answers confidently and wrongly: it simply won't contain a function added since it was built, and reports "No matching nodes found" as though the symbol didn't exist.

One trap worth knowing: for a "how does X work" question the graph often ranks `docs/superpowers/` plan and spec nodes above the code. Those describe what was *intended* at the time they were written, and every one of them has since shipped and moved on — they're marked as historical for exactly this reason. Prefer nodes whose `src` is `ArcheryScorecard.jsx`.
