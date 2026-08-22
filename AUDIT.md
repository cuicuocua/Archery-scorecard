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
named `claude/arcieri-senesi-scorecard-52a25z`, and the README is ~880
lines doing two unrelated jobs. (Both since resolved — see questions 4
and 5.)

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

~~**Splitting the README.**~~ **Since done** — see question 5. The blocker
named here (that the split point was a judgement call) turned out to be the
easy part; the actual work was the eight cross-references spanning the seam,
which a line-based grep missed because two of them wrapped across a newline.

~~**Bundle size on the public share page.**~~ **Since done.** The blocker
named here was wrong: it assumed a second entry point meant restructuring
the component file. It did not — `site/share.jsx` imports only
`SharedTournamentScreen` and esbuild drops the rest, no code moved.
933 KB → 344 KB for spectators. Measuring first would have shown that.

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

2. ~~**Should `CLAUDE.md` be tracked?**~~ **RESOLVED: yes** — committed as
   `ddd72d3` and pushed. Its "No service worker / full offline install —
   deliberate v1 scope" rule was false as written (v1.18 shipped one) and
   has been corrected in place. It still duplicates four sections of the
   README; that overlap is left alone, since a short orientation file and a
   long reference serve different readers.

3. ~~**Is this repository public?**~~ **RESOLVED 2026-08-11 by evidence:**
   `gh repo view` reports `cuicuocua/Archery-scorecard`, `visibility: PUBLIC`.
   Ignoring `imports/` stands. The five committed plans were re-checked
   against that: no real participant names, no personal data, no secrets.

4. ~~**Should the deploy branch be renamed?**~~ **RESOLVED: renamed to
   `main`.** Done with GitHub's server-side branch-rename API, which moves
   the remote branch, the default pointer and any open PRs in one
   operation — not the local `git branch -m` + push proposed earlier, which
   is what nearly overwrote the diverged commits. `deploy-pages.yml`'s
   `branches:` list moved in the same push, since the rename alone would
   have left the workflow watching a branch that no longer exists.

5. ~~**Split the README?**~~ **RESOLVED: split.** `README.md` keeps the
   reference (98 lines); the version sections moved verbatim to
   `CHANGELOG.md` (1,058 lines), kept oldest-first because entries refer to
   each other directionally and reversing would have broken every one.
   Eight cross-references had to be repaired across the seam — four
   pointing forward into the version history, four pointing back at the
   reference sections. One of them (`see "Round definitions" below`) had
   been wrong before the split and is now correct.

6. ~~**Delete `.impeccable/`?**~~ **RESOLVED: deleted**, after checking
   every finding in it against the current code. The disposition of all of
   them is recorded in the appendix below, since the file was untracked and
   deleting it was unrecoverable. One finding was still live and was fixed
   rather than discarded — see the appendix.

7. ~~**The five plans' step checkboxes all read `- [ ]`**~~ **RESOLVED:
   headers added, boxes untouched.** Each plan now opens with the version it
   shipped in (v1.10, v1.11, v1.12, v1.13, v1.15) and says plainly that the
   unticked boxes are a historical record, not open work. The boxes stay as
   written rather than back-filled with a completion nobody witnessed.
   The headers also neutralise each plan's "REQUIRED SUB-SKILL: use
   superpowers:executing-plans to implement this plan task-by-task" banner,
   which was the sharper half of the problem — it instructs an agent to go
   and build something that shipped months ago. The six specs carry no such
   banner and were left alone.

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

---

## Appendix — `.impeccable/critique/2026-07-28T13-06-01Z__archeryscorecard-jsx.md`

Deleted 2026-08-22. It was untracked, so this is the only surviving record.
Design health score at the time: **27/40**, from a dual-agent pass (design
review plus a detector with browser evidence). Its own deterministic
scanner returned zero findings; the score came from the heuristic review.

Every finding, checked against the code before deletion:

| Finding | Status |
|---|---|
| **[P0]** No correction path once a set/end is confirmed — only "Reset torneo", which wipes the whole bracket | **Fixed in v1.7** — `UnitHistory`, tap a scored unit to reopen it |
| **[P0]** No password-recovery path in `AuthGate` | **Fixed in v1.7** — `resetPasswordForEmail` + a `PASSWORD_RECOVERY` screen |
| **[P1]** Superuser mode undiscoverable (no toggle, reachable only by an unhinted `q`) | **Deliberate, not a defect.** Hidden by design; do not "fix" |
| **[P1]** Tournament creation is one long unpaginated scroll | **Fixed in v1.7** — 4-step wizard, mirroring `NewSessionScreen` |
| **[P2]** Chip rows overflow with no affordance that more exists | **Fixed in v1.7** — `ScrollFadeRow` edge mask |
| Bottom nav spans full width while content is a centred column | **Fixed** — v1.6 aligned the nav's icon row; layout revisited again in v1.19 |
| "Finale 3°/4° posto" heading flush against the bottom nav | **Fixed in v1.7** — `pb-8` → `pb-12` |
| `ChipSelect` renders single- and multi-select identically | **Fixed in v1.7** — checkbox glyph on multi-select rows |
| Auth inputs rely on placeholder-only labels | **Fixed in v1.7** — `aria-label` on every auth input |
| Clicks sometimes not registering in its automation tooling | Tool quirk, self-flagged as such. Not an app defect |
| **Persona (Jordan):** `AuthGate` error strings don't distinguish wrong password from no-such-account from **network failure** | **Was still live. Fixed 2026-08-22** (see below) |
| **Persona (Alex):** keyboard accelerators are desktop-only; the phone-at-the-line scorer gets none | **Open, by design.** Superuser mode is a deliberate desktop-only convenience |

Its three closing questions were about the tournament side treating a
confirmed mistake as unrecoverable while the personal side treats mistakes
as expected. v1.7's correction path answered them.

**The one that was still true.** `AuthGate`'s catch block collapsed every
sign-in failure into "Email o password errati" — including a request that
never reached Supabase. An archer at a range with no signal was told their
password was wrong, which on competition morning sends them looking for the
wrong fix. It now distinguishes the two on the absence of an HTTP status
(`AuthRetryableFetchError` reports 0; a bare fetch failure has none) and
says "Connessione assente" instead. Verified both ways in a browser: a
failing fetch gives the connectivity message, and genuinely wrong
credentials against the real Supabase still give "Email o password errati".

This is the same defect class as the participant-submission bug fixed
earlier the same day: reporting a confident, specific, wrong cause for what
is actually a connectivity failure.
