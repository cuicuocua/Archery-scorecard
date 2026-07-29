# Tournament sharing (public spectator link)

Lets a tournament organizer generate a link that anyone — no login — can
open to watch a bracket's scores update as the organizer scores matches,
without exposing any other tournament or requiring changes to the app's
existing per-user authentication and data model.

---

## Current behavior

Tournaments are fully private: each row in the `tournaments` table is
locked to its owner (`auth.uid() = user_id`) by row-level security, on
every operation (select/insert/update/delete). The app itself has no
concept of a URL at all — `entry.jsx` unconditionally mounts
`ArcheryScorecard`, which unconditionally decides between `<AuthGate/>`
(signed out) and the full authenticated app (signed in). There is no
public, unauthenticated read path to any data in this app today.

## New behavior

### Data model — `shareToken` lives inside the existing `data` blob

No new database column, no schema migration. `shareToken` becomes a plain
field on the tournament object itself (`{ ..., shareToken: 'a1b2c3...' |
null }`), stored exactly like `finalFormat` or `participants` already are
— inside the JSONB `data` column. `null` (or absent, for tournaments that
predate this feature) means sharing is off. Generated client-side with
`crypto.randomUUID()` (122 bits of randomness — not derived from the
tournament's own `id`, which is `t_<timestamp>_<6 random chars>` and both
leaks its creation time and doesn't have enough entropy to double as a
public secret).

Turning sharing on or off is just a normal tournament save through the
app's *existing* `updateTournament()` path (same one every score entry
already goes through) — no new save plumbing.

### Public read path — one Postgres function, no RLS changes

A new `security definer` SQL function is the *only* way an anonymous
visitor can read a tournament:

```sql
create or replace function public.get_shared_tournament(p_token text)
returns table(data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select data, updated_at from public.tournaments
  where data ->> 'shareToken' = p_token
  limit 1;
$$;

grant execute on function public.get_shared_tournament(text) to anon, authenticated;
```

This runs with the function owner's privileges (bypassing RLS internally
for its own single filtered query), so it needs no new RLS policy on
`tournaments` at all — the table's existing per-user policies are
untouched, and authenticated access to every other tournament is exactly
as private as it is today. Critically, this is *not* the same as adding a
public "select where shared" RLS policy directly on the table: a table
policy would let anyone with the (public, embedded) anon key drop the
`.eq('share_token', ...)` filter and list every tournament anyone has ever
shared. A function parameterized on the token can only ever return the one
row whose token matches what the caller already has — there is no way to
enumerate or browse through it.

Returning `updated_at` alongside `data` is what lets the client tell "did
anything actually change" from "I re-checked and nothing's new" — see
polling behavior below.

### Sharing controls — `BracketScreen` header

A "Condividi" icon sits next to the existing edit-participants/reset
icons. Tapping it:
- **No token yet**: generates one (`crypto.randomUUID()`), saves the
  tournament via the existing `updateTournament()` path, builds
  `` `${window.location.origin}${window.location.pathname}?share=${token}` ``
  (same construction `resetPasswordForEmail`'s redirect already uses
  elsewhere in this file), copies it to the clipboard
  (`navigator.clipboard.writeText`), and shows a brief confirmation.
- **Token already exists**: re-copies the same link — tapping "Condividi"
  again never invalidates a link already sent to someone.

Once a token exists, a second control, "Disattiva condivisione", appears
next to it and sets `shareToken` back to `null` (same save path). Existing
copies of the link then resolve to the "no longer shared" state described
below — nothing crashes, nothing silently keeps working.

### The public screen — bypasses the authenticated app entirely

`entry.jsx` checks `new URLSearchParams(window.location.search).get('share')`
*before* deciding what to mount:

```js
const shareToken = new URLSearchParams(window.location.search).get('share');
createRoot(document.getElementById('root')).render(
  shareToken ? <SharedTournamentScreen token={shareToken} /> : <ArcheryScorecard />
);
```

`SharedTournamentScreen` is a new component exported alongside (not
nested inside) `ArcheryScorecard` — it never touches `supabase.auth`,
never mounts `AuthGate`, and a spectator's visit never fires an auth
listener or session check. It reuses the existing bracket-tree/list
rendering (`BracketTree`/`BracketList` — same components `BracketScreen`
already draws match cards, scores, and in-progress state with) in a
read-only mode: tapping a match is a no-op, and none of the organizer-only
controls (score entry, edit participants, reset, superuser, share) exist
on this screen. Live in-progress match scores show exactly as recorded —
this is already part of the tournament's `data`, so no extra work is
needed to surface it, only a decision not to hide it. Fetched data runs
through the same `normalizeTournament()` every authenticated load already
applies, so a tournament created before the `finalFormat` feature (or any
other past normalization) renders identically to how the organizer sees
it — no separate compatibility path for the public screen.

**Polling, and the "only update when there's new data" requirement:**
every 45 seconds (plus once on mount, plus on tap of a manual refresh
icon — same precedent as the existing manual reload button on the Home
screen), the screen calls `get_shared_tournament(token)` and compares the
returned `updated_at` against the last value it rendered:
- **Unchanged**: no state update, no re-render, nothing visibly happens.
- **Changed** (or first load): the bracket updates, and a small "ultimo
  aggiornamento: HH:MM" caption (derived from `updated_at`) refreshes too,
  so a spectator has a passive signal that the page is alive and current,
  not just a static screenshot.

This keeps the request cadence simple and predictable (still just a
45-second timer, no new infrastructure, no websocket/subscription
lifecycle to manage) while satisfying the actual goal — the *visible*
bracket only ever changes when there's real new data, never a hollow
refresh flicker. A true zero-polling push design was considered and
rejected: Supabase Realtime subscriptions are filtered by the table's RLS
policy, not by a security-definer function, so enabling it for anonymous
spectators would require re-opening exactly the enumerable "list every
shared tournament" RLS policy this design deliberately avoids — real added
complexity (or a second, narrowly-scoped table) for a spectator feature
where a few seconds of latency is a complete non-issue.

## Edge cases

- **Invalid or already-revoked token** (RPC returns no row): a plain
  centered message — "Questo torneo non è più condiviso, o il link non è
  valido." — instead of a stuck loading spinner or a crash.
- **Sharing revoked while someone is actively watching**: the next poll
  (≤45s later) returns no row; the screen transitions from the bracket to
  the same "no longer shared" message.
- **Tournament created before this feature exists**: no `shareToken` field
  at all (not just `null`) — treated identically to `null` (sharing off)
  everywhere this is checked, no migration needed.
- **Organizer taps "Condividi" twice in a row**: idempotent — the second
  tap re-copies the existing token's link rather than minting a new one
  and silently breaking the first copy already sent out.
- **Network error on a poll** (not "no row found", but the request itself
  failing): leaves the currently-displayed bracket exactly as it is
  (stale-but-present beats blanking the screen) and retries on the next
  interval — same "don't fail loudly for a background poll" spirit as the
  rest of the app's remote-save error handling.

## Testing notes

No test framework in this repo — manual verification via `npm run build`
and the browser preview, same approach used throughout this project.
Specifically verify: sharing a tournament produces a working `?share=`
link openable in a fresh (logged-out) browser tab/session, the public
view shows the bracket read-only with no organizer controls, scoring a
match in the authenticated tab and waiting for the next poll (or tapping
manual refresh) updates the public tab, an untouched public tab does
*not* visibly re-render on a poll where nothing changed, revoking sharing
turns a previously-working link into the "no longer shared" message
within one poll cycle, and an invalid token (hand-edited query string)
shows the same message immediately.
