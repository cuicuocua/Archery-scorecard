# Participant self-scoring via email identity

Lets a tournament organizer attach an email address to any participant, so
that participant can open the existing public share link, identify
themselves with that email + their name, and enter their own match's score
from their phone — without a password, without a new account, and without
weakening the organizer's own full control over the bracket. A match only
ever updates once **both** participants of that match have independently
submitted the same result.

---

## Current behavior

- `tournament.participants` is an array of `{ id, name, seedScore }` — set
  once at creation via `ParticipantEditor`, and only editable afterward
  through the "edit participants & rebuild bracket" flow, which is gated
  behind `!tournamentHasStarted(tournament)` since changing the participant
  list reseeds and rebuilds the whole bracket.
- A match's playable state is addressed by a small `ref` object —
  `{ kind: 'round', roundIdx, matchIdx }`, or one of the singleton kinds
  `thirdPlace` / `prelim` / `lancasterPlayIn` / `lancaster1` / `lancaster2`
  / `lancaster3` / `threeFinal` — resolved to the actual match object via
  `resolveMatchRef(tournament, ref)` and checked for playability via
  `isRefPlayable(tournament, ref)` (`ArcheryScorecard.jsx:3070-3109`).
- A match's units look like `{ index, arrowsA: [...], arrowsB: [...],
  totalA, totalB, spA, spB }` (`ArcheryScorecard.jsx:2811`) — one entry per
  end, each side's arrows as a flat array of scored values for that end.
- Scoring a match is done through `MatchScreen`
  (`onComplete={(updatedMatch) => updateTournament(activeTournament.id, t
  => applyMatchResult(t, activeMatchRef, updatedMatch))}`,
  `ArcheryScorecard.jsx:5100-5103`) — a single reusable component that
  handles arrow entry for both sides, tap-only by default or with an
  additional keyboard-scoring mode when `keyboardScoring` (superuser) is
  on. `applyMatchResult(tournament, ref, updatedMatch)`
  (`ArcheryScorecard.jsx:3136`) is a pure function: given a ref and a
  completed match object, it splices the result into the bracket and
  propagates winners/losers into the next round or final stage — this is
  the single source of truth for "what does completing this match do to
  the rest of the tournament," used identically for every match kind.
- `tournament.shareToken` (nullable) gates a public, unauthenticated,
  read-only view (`SharedTournamentScreen`, `ArcheryScorecard.jsx:4079`),
  fetched via the `security definer` SQL function `get_shared_tournament`
  (`supabase/schema.sql:59-71`). This is the only existing unauthenticated
  entry point into a tournament's data — everything else requires the
  organizer's own Supabase Auth session and is scoped to `auth.uid() =
  user_id` by RLS.
- `ShareTournamentControl` (`ArcheryScorecard.jsx:3851-3895`) is the
  existing "collapsed button expands to a panel" idiom used on
  `BracketScreen` for organizer-only controls like this.

## New behavior

### Data model — two new optional fields, no schema migration

Both live inside the existing JSONB `data` column, exactly like
`shareToken` does today — no new table, no new column, no RLS change.

- `tournament.participants[i].email` — plain text, optional. Set by the
  organizer; absent (or `''`) means that participant has no self-scoring
  access.
- `tournament.pendingSubmissions` — optional object, keyed by a stable
  string built from a match `ref`:
  ```js
  function refKey(ref) {
    return ref.kind === 'round' ? `round:${ref.roundIdx}:${ref.matchIdx}` : ref.kind;
  }
  ```
  (every non-`'round'` kind is already a unique singleton string, so this
  is injective across every ref the tournament can produce). Shape:
  ```js
  {
    [refKey]: {
      [participantId]: { updatedMatch, submittedAt } // updatedMatch: the same shape MatchScreen's onComplete already produces
    }
  }
  ```
  This key is opaque bookkeeping — nothing server-side ever parses or
  interprets it; only the organizer's own client (which already knows how
  to resolve every `ref` kind) does.

### Admin: attaching participant emails

A new collapsed-button-expands-to-panel control, `ManageParticipantEmailsControl`,
sits on `BracketScreen` next to the existing `ShareTournamentControl`
(same idiom: `ArcheryScorecard.jsx:3851-3895`). Expanded, it lists every
participant with an inline email input (prefilled if already set) and one
"Salva" button for the whole list — same single-action simplicity as
`ShareTournamentControl` itself. Saving writes through the existing
`updateTournament()` path — the exact same call every score entry already
goes through — updating only the `email` field on each matching entry in
`tournament.participants`. No bracket
rebuild, no `tournamentHasStarted` gate: this works identically before,
during, or after the tournament is live, unlike editing the participant
list itself.

### SQL — two new `security definer` functions, same trust model as `get_shared_tournament`

```sql
create or replace function public.identify_participant(p_token text, p_email text, p_name text)
returns table(participant_id text, data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select p ->> 'id', t.data, t.updated_at
  from public.tournaments t,
       jsonb_array_elements(t.data -> 'participants') p
  where t.data ->> 'shareToken' = p_token
    and lower(trim(p ->> 'email')) = lower(trim(p_email))
    and lower(trim(p ->> 'name')) = lower(trim(p_name))
  limit 1;
$$;

grant execute on function public.identify_participant(text, text, text) to anon, authenticated;

create or replace function public.submit_participant_match(
  p_token text, p_email text, p_name text, p_match_key text, p_submission jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_id text;
begin
  select p ->> 'id' into v_participant_id
  from public.tournaments t, jsonb_array_elements(t.data -> 'participants') p
  where t.data ->> 'shareToken' = p_token
    and lower(trim(p ->> 'email')) = lower(trim(p_email))
    and lower(trim(p ->> 'name')) = lower(trim(p_name))
  limit 1;

  if v_participant_id is null then
    raise exception 'not a recognized participant';
  end if;

  update public.tournaments
  set data = jsonb_set(
        coalesce(data, '{}'),
        array['pendingSubmissions', p_match_key, v_participant_id],
        p_submission,
        true
      ),
      updated_at = now()
  where data ->> 'shareToken' = p_token;
end;
$$;

grant execute on function public.submit_participant_match(text, text, text, text, jsonb) to anon, authenticated;
```

Both re-derive the participant's identity from `p_email` + `p_name` on
every call — a client never supplies a trusted `participant_id` directly,
so nobody can submit a result on someone else's behalf just by knowing
their id. Neither function knows anything about rounds, finals, or
brackets — `submit_participant_match` only ever writes into the
`pendingSubmissions` key, never touches `rounds`/`finalStage`/etc., so
there is no way for this narrow, `anon`-callable write path to corrupt or
directly advance the bracket. Same obscure-token trust model as
`get_shared_tournament` — appropriate here for the same reason: a private
club tool, not a public adversarial surface.

### Public page: participant identification

`SharedTournamentScreen` gets a new "Sei un partecipante?" affordance
(collapsed by default, same idiom as `ShareTournamentControl`). Expanded,
it's a small form: email + name. Submitting calls
`identify_participant(token, email, name)`:
- **No match**: inline error, "Email o nome non riconosciuti — controlla
  con l'organizzatore." Form stays open for another attempt.
- **Match found**: the screen now holds `participantId` (in component
  state, not persisted anywhere) alongside the tournament data it already
  had. It computes the participant's current match the same way the
  organizer's own superuser mode already finds "what's next" —
  `flatMatchRefs(tournament).find(ref => isRefPlayable(tournament, ref) &&
  matchRefHasParticipant(tournament, ref, participantId))` (`matchRefHasParticipant`
  is a small new helper: resolves the ref and checks whether
  `participantId` is `slotA.id` or `slotB.id`).
  - **No playable match for them right now** (already played, not yet
    paired, or eliminated): a plain status message — "Nessun turno da
    giocare al momento." — no dead-end crash, no scoring UI shown.
  - **Playable match found, no pending submission of theirs yet**: renders
    `MatchScreen` for that match, `keyboardScoring={false}` (participants
    only ever get the tap-based flow — keyboard scoring stays a superuser
    convenience for the organizer's own device), title unchanged
    (`resolveMatchRef`'s existing title). `onComplete` calls
    `submit_participant_match(token, email, name, refKey(ref), updatedMatch)`
    instead of `applyMatchResult` — the participant's client never mutates
    the bracket directly, only ever proposes.
  - **They already have a pending submission for this match**: instead of
    `MatchScreen`, a waiting state — "Punteggio inviato. In attesa che
    anche l'avversario invii il proprio." — so a participant who submits
    and reopens the link later doesn't see a blank form and re-enter
    (which would silently overwrite their own prior submission with
    whatever they type this time, harmless but confusing).

### Reconciliation — runs on the organizer's own client, not in SQL

`SharedTournamentScreen`'s existing poll (`ArcheryScorecard.jsx:4090-4126`)
already refetches the full tournament `data`, which now includes
`pendingSubmissions` — but reconciliation is meaningless there (that
screen has no write access; it's the read-only spectator view). Instead,
this logic lives in the *organizer's own authenticated app*, where a
tournament the user owns is loaded: alongside the tournament's existing
render, a `useEffect` keyed on `tournament.pendingSubmissions` walks every
`matchKey` present:

1. Resolve `matchKey` back to a `ref` (inverse of `refKey` — trivial
   string parse, since it's their own encoding).
2. If both slot participants' submissions are present for that `ref`:
   - **Compare, order-insensitively per unit per side.** For each unit
     index, `[...arrowsA].sort()` from one submission must equal
     `[...arrowsA].sort()` from the other (same for `arrowsB`) — so
     `[10,9,8]` and `[10,8,9]` count as identical, but `[10,9,8]` vs
     `[10,9,7]` doesn't. (`totalA`/`totalB`/`spA`/`spB` are derived sums,
     so they agree automatically whenever the arrows do — no need to
     compare them separately.) Both submissions must also have the same
     number of units.
   - **Match**: call the real `applyMatchResult(tournament, ref,
     eitherSubmission.updatedMatch)` — the exact function the organizer's
     own manual scoring already uses — via `updateTournament()`, then
     clear `pendingSubmissions[matchKey]` in the same update.
   - **Mismatch**: clear `pendingSubmissions[matchKey]` (both entries)
     without applying anything. Neither participant is notified directly
     — the next time either reopens their link, `identify_participant`
     shows no pending submission for that match anymore, so they simply
     see the entry form again, as if they hadn't submitted yet. No extra
     "your scores didn't match" messaging or state is built for this.
3. If only one side has submitted: leave it as-is (nothing to compare
   yet) — this is also exactly the state an organizer sees mid-event, and
   they can always just walk up and score the match themselves the normal
   way, which calls `applyMatchResult` directly and makes the whole
   question moot (the pending submissions become stale and get silently
   ignored/cleared the next time this effect runs, since the match is no
   longer playable).

This keeps every scrap of bracket-shape knowledge (which round feeds
which final, how Lancaster's ladder seeds, etc.) in exactly one place —
the existing `applyMatchResult` — instead of teaching a second copy of it
to SQL.

## Edge cases

- **Participant has no email on file**: unchanged from today — the
  organizer scores their matches manually, exactly as always. This is
  expected to be the common case (not every participant will bother, or
  even need, self-scoring).
- **Two participants share the same email**, or a **name doesn't
  case/whitespace-match exactly**: `identify_participant`'s comparison is
  `lower(trim(...))` on both fields, so casing/incidental whitespace never
  blocks a legitimate match. A genuine duplicate email across two
  participants only ever returns the first match (`limit 1`) — an
  organizer-side data problem to avoid when entering emails, not one this
  feature tries to solve for.
- **Organizer's app isn't open when both sides submit**: nothing is lost
  — `pendingSubmissions` just sits in the row until the organizer next
  opens that tournament, at which point the reconciliation effect runs
  once on load and catches up on everything at once.
- **Match becomes unplayable between a participant loading the form and
  submitting** (e.g. the organizer scored it manually in the meantime):
  `submit_participant_match` still stores the submission (it doesn't
  understand playability), but the reconciliation effect only ever acts
  on `pendingSubmissions` for matches it still considers playable —
  writing over an already-completed match never happens, since
  `applyMatchResult` is only reached via the match/ref path that arises
  from this effect, not a blind key-value write.
- **Participant's submission is malformed** (wrong number of units,
  missing arrows — e.g. a stale client after this feature changes shape
  later): the sort-and-compare step naturally fails to match anything
  (different lengths never compare equal), so it's treated the same as
  any other mismatch — cleared, no crash, participant just re-enters.
- **Tournament isn't shared** (`shareToken` is `null`): `identify_participant`
  and `submit_participant_match` both filter on `data ->> 'shareToken' =
  p_token`, so an unshared tournament has no matching row for either,
  identical to how `get_shared_tournament` already behaves — no separate
  check needed.

## Out of scope for this pass

- No real email delivery — the organizer shares the link themselves
  (WhatsApp, in person, etc.); nothing in this feature sends mail.
- No participant accounts or passwords — email + name is the entire
  identity check, matching the trust level of the rest of this app's
  sharing model.
- No admin UI for resolving a mismatch beyond what already exists —
  the organizer can always just score the match manually the normal way,
  which is unaffected by any of this.
- Walkover/forfeit entry stays organizer-only (those matches are decided
  outside normal arrow entry and won't be "playable" for a participant by
  the time they're marked that way).

## Testing notes

No test framework in this repo — manual verification via `npm run build`
and the browser preview. Specifically verify: an organizer can attach an
email to a participant mid-tournament without the bracket resetting; a
participant identifying with the wrong email/name sees the error and can
retry; a correctly-identified participant with no playable match sees the
status message, not a crash; two participants independently submitting
identical arrows (in different entry order within a unit) results in the
match auto-completing and propagating exactly as manual entry would;
submitting differing arrows clears both and both participants see a fresh
form on reload; an organizer manually scoring a match that has a pending
(but incomplete, single-sided) submission works exactly as it does today,
and that now-stale pending submission causes no error afterward.
