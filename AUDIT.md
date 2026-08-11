# Repository audit — 2026-08-11

Organizational pass over `archery-scorecard`, plus the reconciliation of two
branches that had been developing in parallel without knowing about each
other. No application behaviour was changed by the organizational work; the
reconciliation carried four earlier commits of correctness work onto trunk.

## 1. Summary

The code is in good shape. The *repository around it* was not, and the worst
of it was invisible from inside a single checkout: **this branch and origin
had both forked from `eee3d9e` (2026-08-07) and done substantial parallel
work on 2026-08-08 without either knowing about the other.**

Origin — the branch the live site deploys from — carried v1.16 through
v1.18: an 80cm six-ring face fix, a miss button and volée confirmation in
target-tap scoring, an installable offline PWA, and a 68-test suite under
`test/`. This checkout carried four passes of correctness work on the
bracket engine and the storage layer, plus its own separate test harness.
Neither side's tests knew about the other side's fixes.

The reconciliation is the substance of this pass. The empirical finding that
justified it: **origin's engine could not finish a 3-competitor tournament**
in either the Finale a 3 or Lancaster format. It deadlocks — no exception,
no error, just a draw with no playable match left and nobody on the podium.
Its 68 tests passed anyway, because none of them ever built a field of three
and none played a tournament through to its podium at all. That is live on
the deployed site today.

The rest was ordinary drift. `git status` listed nine untracked entries, so
it had stopped being a usable signal. `docs/superpowers/` tracked its specs
and not its plans, with no decision recorded either way. `site/build.js` told
you to run it from the wrong directory.

Two previous decisions worth revisiting, neither urgent, both questions
below rather than changes: the default branch of a public repository is
named `claude/arcieri-senesi-scorecard-52a25z`, and the README is now ~880
lines doing two unrelated jobs.

## 2. Tooling used

No skills applied (the one available, `convert-documents-to-markdown`, has
no bearing here). Evidence came from `git ls-files` / `git log` /
`git grep` / `git merge-tree`, `rg`, `gh repo view`, `npm ls`,
`npm ci --dry-run`, the project's own `npm run build` and `npm test`, a
throwaway `git worktree` at origin's HEAD to probe its engine directly, and
`graphify update .` per `CLAUDE.md`. No new dependencies installed.

Baseline on origin before any change: build clean, 68/68 tests passing.
After reconciliation: build clean at 933 KB, **102/102 tests passing**.
Nothing was already failing.

## 3. Changes made

Eleven commits on top of `fdabbae`. The four correctness commits are
carried over unchanged from the pre-existing audit work; the rest are new.

### Carried over — the four correctness passes

`4e597c9`, `c9deb33`, `f8e83b9`, `48b7500`. Deduplication (`TournamentBody`,
`makeStore`, `Disclosure`), dead-code removal, eleven correctness fixes, and
ten unsupported claims retired. Full reasoning in their commit messages;
user-visible summary in the README's new v1.19 section. **Origin had none of
these** — verified function by function, then empirically via the deadlock
probe.

### `528a312` — Drop `sessionTotalArrows` from the test-only export list

The function was removed as dead in `c9deb33`; origin's export block, added
independently, still named it, so the merged file did not compile. No test
referenced it.

### `7ef4564` — Ignore machine-local and personal-data files; track the shared launch config

| Path | Was | Now | Why |
|---|---|---|---|
| `.DS_Store` (×3) | untracked | ignored | Finder droppings. |
| `.claude/settings.local.json` | untracked | ignored | Permission grants with absolute paths to this Mac. |
| `.impeccable/` | untracked | ignored | Skill output, timestamped per run, regenerated on demand. |
| `imports/` (4.6 MB) | untracked | ignored | Twelve scanned scoresheets plus personal score data, in a public repository. |
| `Risultati_Tornei.txt` | untracked | ignored | One-off export from the app. |
| `graphify-out/` | untracked | ignored | Generated knowledge graph — see question 9. |
| `.claude/launch.json` | untracked | **tracked** | The dev-server config the project shares, not a per-machine grant. |

Everything named stays on disk untouched. `git status` now reports one
untracked entry (`CLAUDE.md`, question 2) instead of nine.

### `f763891` — Track the implementation plans alongside the specs

`specs/` was in git — six deliberate commits — and `plans/` was not, despite
being the same artifact for the same six features. Five plans, 2,654 lines,
committed verbatim. Each carries reasoning its spec does not: the
participant-self-scoring plan is the only record of why the 3-way final is
excluded from self-scoring, and the only record that the organizer's
30-second poll was not in the spec and had to be added or a submitted score
would only be noticed on a full page reload. Scanned for secrets and
personal data before staging: clean.

### `d2172ce` — Document the audit pass as v1.19; correct two stale claims

Written as v1.16 on the pre-reconciliation branch, which had not seen
origin's v1.16–v1.18. Renumbered to v1.19 and appended after them, here and
at the two places referencing it (README's v1.7 entry and
`normalizeSession`'s contract comment). Also corrected: v1.7's claim that
every screen dropped its max-width cap (eighteen were capped again at
`max-w-3xl`), and `site/build.js`'s header saying to run it from `site/`.

### `09055a9` — Fold the standalone engine harness into the v1.18 test suite

Two harnesses existed for the same file, written in parallel. `test/` is the
better one — it transpiles rather than bundles, shims `localStorage` and the
Supabase client, and reads functions off the shared export block rather than
a second `__engine` object maintained beside it. So `test_bracket.mjs` was
deleted and its checks moved to `test/bracket-engine.test.js` (30 tests).
Every test in that file drives the whole scorer loop rather than one
function, because that is how a bracket bug presents.

Nine existing tests changed, all asserting behaviour the audit commits
deliberately corrected: eight outbox tests called `readPending`/`setPending`/
`applyPending` without a user id (the outbox is keyed per account now), and
`findPersonalBest`'s fixture had no `arrowsPerEnd`/`ends` (candidates must
now match on total arrow count). Three tests added covering exactly those
changes.

### Not carried over

`6d46bbe`, which added an `npm test` step to the deploy workflow. Origin
added the same step on 2026-08-08. Origin's workflow is untouched.

### Nothing was deleted except `test_bracket.mjs`

Superseded by `test/bracket-engine.test.js`, in the same commit, with its
coverage preserved and extended.

## 4. Proposed but not executed

**`npm install` → `npm ci` in CI.** The lockfile supports it
(`npm ci --dry-run` exits 0). *Blocker:* the dry run also surfaced
`npm warn allow-scripts — esbuild@0.23.1 (postinstall)`. That postinstall
fetches esbuild's platform binary; if a fresh runner blocks it, the build
fails at a step that currently works. The lockfile pins every version and is
in sync, so `npm install` resolves identically today. Hygiene, not
correctness — not worth risking the deploy to verify blind.

**`@supabase/supabase-js` 2.110.9 → 2.112.2.** *Blocker:* no functional
reason, and the auth/RPC paths have no browser-verifiable coverage. Worth
doing next time someone is already testing a signed-in flow end to end.

**Splitting the README.** ~880 lines doing two jobs: an architecture
reference at the top, then nineteen `v1.x additions` sections that are a
changelog. The reference part is what anyone needs and it is buried above
800 lines of history. *Blocker:* a rewrite of the primary document, and the
split point is a judgement call — question 5.

**Bundle size on the public share page.** One 933 KB `index.html` reaches
every spectator following a share link, including recharts, the whole
personal-scorecard app, and `@supabase/supabase-js`. *Blocker:* fixing it
means a second entry point and a second HTML output, which changes the
deployment shape. Feature-sized, not organizational.

**Moving `test/bracket-engine.test.js`'s `playThrough` helper into
`test/load.cjs`.** Considered and rejected — one consumer, and the loop is
easier to read next to the assertions that depend on it.

## 5. Open questions

Numbers stay stable as they close; resolved ones are struck through.

1. ~~**Has the share-token unique index been run against the live
   database?**~~ **RESOLVED 2026-08-11: yes, applied.** The underlying gap
   stands — `supabase/schema.sql` is applied by hand, has no migration
   runner, and nothing records what has been run — but nothing is blocked on
   it today.

2. **Should `CLAUDE.md` be tracked?** It is the last untracked file and
   duplicates four sections of the README. Note that its "No service worker
   / full offline install — deliberate v1 scope" rule is now false: v1.18
   shipped one. Whichever way this goes, that line needs deleting.

3. ~~**Is this repository public?**~~ **RESOLVED 2026-08-11 by evidence:**
   `gh repo view` reports `cuicuocua/Archery-scorecard`, `visibility: PUBLIC`.
   Ignoring `imports/` stands. The five committed plans were re-checked
   against that: no real participant names, no personal data, no secrets.

4. **Should the deploy branch be renamed?** The default branch of a public
   repository, and the only branch `deploy-pages.yml` watches, is
   `claude/arcieri-senesi-scorecard-52a25z`. **Do this with GitHub's own
   branch-rename** (`gh api -X POST repos/cuicuocua/Archery-scorecard/branches/<old>/rename`),
   which moves the remote branch, the default pointer and any open PRs in
   one server-side operation — not the local `git branch -m` + push I
   proposed earlier, which is what nearly overwrote the diverged commits.

5. **Split the README?** Reference stays in `README.md`; the nineteen
   `v1.x additions` sections move to `CHANGELOG.md` untouched. Yes/no.

6. **Delete `.impeccable/`?** Its single critique is dated 2026-07-28 and
   both its P0 findings were fixed in v1.7. It reads as a list of current
   problems that are not current. Ignored rather than deleted.

7. **The five plans' step checkboxes all read `- [ ]`** — 98 of them, none
   checked, for features that all shipped. Committed verbatim rather than
   ticked, since marking them retroactively fabricates a record. Leave, or
   add a one-line "shipped in vX.Y" header to each?

8. **`.claude/launch.json` runs `npx serve`, not a devDependency.** Every
   dev-server start fetches it from the network. Add `serve` to
   `devDependencies`, or leave it?

9. **Which knowledge graph is canonical?** `CLAUDE.md` points at
   `/Users/teo/Claude/graphify-out/`, last built 2026-07-28, but the command
   it gives — `graphify update .` — run from this project writes a second,
   project-scoped graph here. Should the rule say
   `graphify update /Users/teo/Claude` instead?

## 6. Rule conflicts and deviations

1. **Working-tree precondition.** Phase 3 said to stop if the tree was not
   clean. It was not — nine untracked entries — but those entries were the
   audit's own primary finding, so stopping would have produced a report
   whose top item was the reason it could not act. I proceeded. No tracked
   file's content was modified at that point and every action was additive
   and revertable.

2. **Dedicated branch.** Phase 3 said to work on one. The work happened on
   `audit-rebase`, cut from origin's HEAD, and only became the working
   branch once 102/102 tests passed on it. The pre-reconciliation state is
   tagged `audit-pre-rebase`.

3. **Filesystem scope.** `/Users/teo/Claude/CLAUDE.md` forbids reading
   outside `/Users/teo/Claude/`, excepting `~/.claude/` config "when I
   explicitly ask you to inspect it". Phase 0 instructed loading
   `~/.claude/CLAUDE.md`; treated that as the explicit ask, checked, and the
   file does not exist — so no user-level rules applied.

4. **A stale rule, not a conflict.** Both `CLAUDE.md` and this README stated
   "No service worker / full offline install — deliberate v1 scope, not an
   oversight." I treated that as binding for most of this pass. v1.18
   shipped a service worker and a web app manifest. The README now says so;
   `CLAUDE.md` still does not — see question 2.

Not a conflict but worth stating: `/Users/teo/Claude/CLAUDE.md` requires one
topic per response and forbids enumerated end-of-turn lists. This document is
an enumerated list of everything at once, because that is what the audit
asked for in writing. The chat replies alongside it keep to one topic.
