# Participant Self-Scoring Implementation Plan

> **Shipped in v1.15** — Participant self-scoring. This is a historical planning record, not open work.
> Its step checkboxes below were never ticked; they are left as they were written rather than
> back-filled with a completion record nobody witnessed. See `CHANGELOG.md` for what actually
> shipped. **The "REQUIRED SUB-SKILL" note that follows no longer applies** — there is nothing
> here left to implement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tournament organizer attach an email to any participant so that participant can identify themselves on the existing public share link and submit their own match's score, applied only once their opponent independently submits the same result.

**Architecture:** Two new `security definer` SQL functions give anonymous, email-identified participants a narrow write path into a new `pendingSubmissions` blob on the tournament's existing JSONB — never touching bracket structure directly. The organizer's own already-open app (the only place that understands bracket structure) polls for and reconciles those submissions using the exact same `applyMatchResult()` function manual scoring already uses.

**Tech Stack:** Same as the rest of this repo — single-file React app (`ArcheryScorecard.jsx`), Supabase (Postgres + `security definer` SQL functions, `@supabase/supabase-js` client), no test framework (manual verification via `npm run build` + browser).

## Global Constraints

- No new database column, no schema migration — every new field (`participants[].email`, `pendingSubmissions`) lives inside the existing JSONB `data` column, exactly like `shareToken` does today.
- No email is ever sent by the app — the organizer shares the link themselves.
- No participant accounts or passwords — email + name (case/whitespace-insensitive match) is the entire identity check, same trust level as the existing `shareToken` sharing model.
- Arrow order within a unit never matters for reconciliation — only which arrows were shot, compared as a sorted multiset per side per unit.
- **Scope trim from the spec, flagged here explicitly:** the 3-way final (`{ kind: 'threeFinal' }`) is excluded from participant self-scoring. It uses a structurally different 3-sided component (`ThreeWayFinalScreen`, not `MatchScreen`) that the spec didn't distinguish from the rest of the bracket. A 3-way gold/silver/bronze final is also realistically always run live, in person, by the organizer. If a participant's only remaining match is the 3-way final, they see the same "Nessun turno da giocare al momento" message as if they had no match at all.
- **Necessary addition not spelled out in the spec, flagged here explicitly:** participants write `pendingSubmissions` directly to Postgres via RPC, with no Supabase Auth session — the organizer's already-loaded local React state has no way to learn about that write on its own. Task 4 below adds a 30-second poll (only while a tournament is open in the organizer's app) that refetches just that row's data and merges in any new `pendingSubmissions`. Without this, submitted scores would only ever be noticed on a full page reload.

---

## Task 1: SQL — `identify_participant` + `submit_participant_match`

**Files:**
- Modify: `supabase/schema.sql` (insert after line 71, the `grant execute on function public.get_shared_tournament...` line, before the "Tournament logos" comment block)

**Interfaces:**
- Produces: two Postgres RPCs callable via `supabase.rpc('identify_participant', { p_token, p_email, p_name })` → `{ data: [{ participant_id, data, updated_at }] | [] }`, and `supabase.rpc('submit_participant_match', { p_token, p_email, p_name, p_match_key, p_submission })` → `{ error }` on failure (invalid identity) or success with no data.

- [ ] **Step 1: Add the two functions to `supabase/schema.sql`**

Insert this block immediately after line 71 (`grant execute on function public.get_shared_tournament(text) to anon, authenticated;`) and before the `-- Tournament logos:` comment:

```sql
-- Participant self-scoring: a participant the organizer has given an email
-- to can identify themselves on the public share page (see
-- get_shared_tournament above) and submit their own match's result. Both
-- functions re-derive the participant's identity from email+name on every
-- call — a caller never supplies a trusted participant id directly, so
-- nobody can submit a result on someone else's behalf just by knowing
-- their id. submit_participant_match only ever writes into the
-- pendingSubmissions key of the JSONB blob; it has no knowledge of
-- rounds/finalStage/etc., so this anon-callable write path has no way to
-- corrupt or directly advance the bracket itself — only the organizer's
-- own authenticated app (via the normal update path) ever does that, once
-- it has reconciled a match's two independent submissions.
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

- [ ] **Step 2: Apply the SQL to the live Supabase project**

This repo has no automated migration runner (`schema.sql`'s own header says "Run this once in your project's SQL Editor"). Open the Supabase dashboard → SQL Editor → New query, paste just the two `create or replace function` blocks + their two `grant execute` lines from Step 1, and run it. Confirm with the user this has been done before continuing — Tasks 3 and 4 call these RPCs and cannot be verified live until they exist.

- [ ] **Step 3: Sanity-check the functions are callable**

In a browser tab on the live app (any existing shared tournament's `?share=<token>` URL), open devtools console and run:

```js
await window.supabase?.rpc?.('identify_participant', { p_token: 'not-a-real-token', p_email: 'x@x.com', p_name: 'x' })
```

If `window.supabase` isn't exposed globally, this step can instead be done from the app's own network tab after Task 3 wires up the real UI call — in that case, skip this manual console check and fold verification into Task 3's browser check instead. Expected (if run): `{ data: [], error: null }` — an empty array, not a SQL error, confirming the function exists and handles a non-matching lookup cleanly.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add identify_participant + submit_participant_match SQL functions"
```

---

## Task 2: Admin — participant email management panel

**Files:**
- Modify: `ArcheryScorecard.jsx`
  - Add `Mail` to the `lucide-react` import (line 6-10)
  - Add new component `ManageParticipantEmailsControl` right after `ShareTournamentControl` (after line 3895)
  - `BracketScreen` (line 3977): add `onSetParticipantEmails` prop, render the new control after `<ShareTournamentControl .../>` (after line 4003)
  - Root component's `<BracketScreen .../>` call site (~line 5044-5055): add `onSetParticipantEmails` prop

**Interfaces:**
- Consumes: `updateTournament(id, updater)` (existing, `ArcheryScorecard.jsx:4942`) — same pattern every other `BracketScreen` callback already uses.
- Produces: `tournament.participants[i].email` (string, optional) — read by Task 3's identification RPC indirectly (via SQL, not JS) and by nothing else in this task.

- [ ] **Step 1: Add the `Mail` icon import**

In `ArcheryScorecard.jsx`, change:

```js
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, Upload, RotateCcw, Play, Check, StickyNote, LogOut, BarChart3,
  Swords, Trophy, Users, UserPlus, Shuffle, Minus, RefreshCw, Unlock, Pencil, Share2,
} from 'lucide-react';
```

to:

```js
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, Upload, RotateCcw, Play, Check, StickyNote, LogOut, BarChart3,
  Swords, Trophy, Users, UserPlus, Shuffle, Minus, RefreshCw, Unlock, Pencil, Share2, Mail,
} from 'lucide-react';
```

- [ ] **Step 2: Add `ManageParticipantEmailsControl`**

Insert this new component immediately after `ShareTournamentControl`'s closing brace (after line 3895, before the `// Same collapsed-button-expands-to-panel idiom as ShareTournamentControl` comment that precedes `LogoUpload`):

```jsx
// Same collapsed-button-expands-to-panel idiom as ShareTournamentControl
// right above. Unlike the edit-participants-and-rebuild-bracket flow, this
// only ever sets an `email` field on each participant — it never touches
// bracket structure, so it works identically before, during, or after the
// tournament is live, with no tournamentHasStarted gate.
function ManageParticipantEmailsControl({ tournament, onSetParticipantEmails }) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState(() => Object.fromEntries(tournament.participants.map(p => [p.id, p.email || ''])));

  function save() {
    onSetParticipantEmails(tournament.participants.map(p => ({ ...p, email: emails[p.id]?.trim() || undefined })));
    setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.surface, color: T.textDim, border: `1px solid ${T.border}` }}>
        <Mail size={16} /> Gestisci email partecipanti
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      <div className="text-xs" style={{ color: T.textDim }}>
        Un partecipante con email può accedere dal link pubblico e inserire da solo il punteggio del proprio turno.
      </div>
      {tournament.participants.map(p => (
        <div key={p.id} className="flex items-center gap-2">
          <div className="flex-1 truncate text-sm">{p.name}</div>
          <input type="email" inputMode="email" aria-label={`Email di ${p.name}`} value={emails[p.id] || ''}
            onChange={e => setEmails(prev => ({ ...prev, [p.id]: e.target.value }))}
            placeholder="email@esempio.it" className="w-40 rounded-xl px-3 py-2 text-sm"
            style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        </div>
      ))}
      <button onClick={save}
        className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        Salva
      </button>
      <button onClick={() => setOpen(false)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Chiudi</button>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `BracketScreen`**

Change the `BracketScreen` signature (line 3977) from:

```js
function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetShareToken, userId, onSetLogo, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
```

to:

```js
function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetShareToken, onSetParticipantEmails, userId, onSetLogo, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
```

Then change (line 4003):

```jsx
      <ShareTournamentControl tournament={tournament} onSetShareToken={onSetShareToken} />
```

to:

```jsx
      <ShareTournamentControl tournament={tournament} onSetShareToken={onSetShareToken} />
      <ManageParticipantEmailsControl tournament={tournament} onSetParticipantEmails={onSetParticipantEmails} />
```

- [ ] **Step 4: Wire it into the root component's `<BracketScreen/>` call site**

Change (~line 5051):

```jsx
              onSetShareToken={(token) => updateTournament(activeTournament.id, t => ({ ...t, shareToken: token }))}
              userId={userId}
```

to:

```jsx
              onSetShareToken={(token) => updateTournament(activeTournament.id, t => ({ ...t, shareToken: token }))}
              onSetParticipantEmails={(participants) => updateTournament(activeTournament.id, t => ({ ...t, participants }))}
              userId={userId}
```

- [ ] **Step 5: Build and verify in the browser**

```bash
npm run build
```

Open the app, sign in, open any tournament's bracket (started or not — both should work), tap "Gestisci email partecipanti", enter an email for one participant, tap "Salva". Reload the page and reopen the same tournament: confirm the email is still there (proves it persisted through `updateTournament` → Supabase, not just local state). Confirm the tournament's bracket, podium, and every other control still render exactly as before — this task only adds a field, nothing else should change.

- [ ] **Step 6: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add participant email management panel to BracketScreen"
```

---

## Task 3: Public page — participant identification & score entry

**Files:**
- Modify: `ArcheryScorecard.jsx`
  - Add `refKey`, `parseRefKey`, `matchRefHasParticipant` right after `flatMatchRefs` (after line 3099, before `PLAYABLE_MATCH_STATUSES`)
  - Add new component `ParticipantAccess` right before `SharedTournamentScreen` (before line 4079)
  - `SharedTournamentScreen` (line 4079): render `<ParticipantAccess .../>`, passing `refresh` down

**Interfaces:**
- Consumes: `flatMatchRefs(tournament)`, `isRefPlayable(tournament, ref)`, `resolveMatchRef(tournament, ref)` (existing, `ArcheryScorecard.jsx:3070-3122`); `MatchScreen` (existing, `ArcheryScorecard.jsx:4339`, props `{ match, title, formatId, onBack, onComplete, keyboardScoring }`).
- Produces: `refKey(ref) → string`, `parseRefKey(key) → ref` (inverse of `refKey`) — consumed by Task 4's reconciliation effect.

- [ ] **Step 1: Add `refKey` / `parseRefKey` / `matchRefHasParticipant`**

Insert immediately after `flatMatchRefs`'s closing brace (after line 3099, before the `const PLAYABLE_MATCH_STATUSES = ...` line):

```js
// Stable string key for a match ref, used as the pendingSubmissions map
// key (see participant self-scoring below). Every non-'round' kind is
// already a unique singleton string, so this is injective across every
// ref a tournament can produce. Opaque bookkeeping — nothing server-side
// ever parses or interprets it, only this file's own reconciliation logic
// does, via parseRefKey below.
function refKey(ref) {
  return ref.kind === 'round' ? `round:${ref.roundIdx}:${ref.matchIdx}` : ref.kind;
}

function parseRefKey(key) {
  if (key.startsWith('round:')) {
    const [, roundIdx, matchIdx] = key.split(':');
    return { kind: 'round', roundIdx: Number(roundIdx), matchIdx: Number(matchIdx) };
  }
  return { kind: key };
}

// threeFinal is deliberately excluded everywhere this is used — its
// 3-sided ThreeWayFinalScreen doesn't share MatchScreen's slotA/slotB
// shape, and a gold/silver/bronze final is realistically always run live
// by the organizer anyway.
function matchRefHasParticipant(tournament, ref, participantId) {
  if (ref.kind === 'threeFinal') return false;
  const resolved = resolveMatchRef(tournament, ref);
  if (!resolved) return false;
  return resolved.match.slotA?.id === participantId || resolved.match.slotB?.id === participantId;
}
```

- [ ] **Step 2: Add the `ParticipantAccess` component**

Insert immediately before `export function SharedTournamentScreen({ token }) {` (before line 4079):

```jsx
// Lets a participant the organizer has given an email to identify
// themselves on the public share page and score their own current match.
// Reuses the exact MatchScreen the organizer's own app scores with —
// keyboardScoring is always off here (that's a superuser convenience for
// the organizer's own device). The only thing that differs from the
// organizer's own scoring flow is where onComplete's result goes: instead
// of applying directly to the bracket via applyMatchResult, it's stored as
// a pending submission via submit_participant_match, and only actually
// applied once the opponent's own submission is present and matches (see
// the reconciliation effect in the root component).
function ParticipantAccess({ tournament, token, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null); // { participantId, email, name }
  const [submitted, setSubmitted] = useState(false);

  async function identify() {
    setBusy(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('identify_participant', {
      p_token: token, p_email: email.trim(), p_name: name.trim(),
    });
    setBusy(false);
    if (rpcError || !data || data.length === 0) {
      setError('Email o nome non riconosciuti. Controlla con l’organizzatore.');
      return;
    }
    setSession({ participantId: data[0].participant_id, email: email.trim(), name: name.trim() });
  }

  async function submit(updatedMatch, matchKey) {
    await supabase.rpc('submit_participant_match', {
      p_token: token, p_email: session.email, p_name: session.name,
      p_match_key: matchKey, p_submission: { updatedMatch, submittedAt: new Date().toISOString() },
    });
    setSubmitted(true);
    onSubmitted?.();
  }

  if (!session) {
    if (!open) {
      return (
        <button onClick={() => setOpen(true)}
          className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 min-h-11"
          style={{ background: T.surface, color: T.textDim, border: `1px solid ${T.border}` }}>
          <Mail size={16} /> Sei un partecipante?
        </button>
      );
    }
    return (
      <div className="rounded-2xl p-3 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
        <div className="text-xs" style={{ color: T.textDim }}>
          Inserisci la tua email e il tuo nome per inserire il punteggio del tuo turno.
        </div>
        <input type="email" inputMode="email" autoComplete="email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="La tua email" className="rounded-xl px-3 py-2.5"
          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        <input aria-label="Nome" value={name} onChange={e => setName(e.target.value)}
          placeholder="Il tuo nome" className="rounded-xl px-3 py-2.5"
          style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text }} />
        {error && <div className="text-xs" style={{ color: T.red }}>{error}</div>}
        <button onClick={identify} disabled={!email.trim() || !name.trim() || busy}
          className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40"
          style={{ background: T.gold, color: GOLD_TEXT }}>
          Accedi
        </button>
        <button onClick={() => setOpen(false)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Chiudi</button>
      </div>
    );
  }

  const candidateRefs = flatMatchRefs(tournament).filter(r => r.kind !== 'threeFinal');
  const ref = candidateRefs.find(r => isRefPlayable(tournament, r) && matchRefHasParticipant(tournament, r, session.participantId));
  const matchKey = ref ? refKey(ref) : null;
  const alreadyPending = matchKey && tournament.pendingSubmissions?.[matchKey]?.[session.participantId];

  if (ref && !alreadyPending && !submitted) {
    const resolved = resolveMatchRef(tournament, ref);
    return (
      <MatchScreen match={resolved.match} title={resolved.title} formatId={tournament.formatId} keyboardScoring={false}
        onBack={() => setSession(null)}
        onComplete={(updatedMatch) => submit(updatedMatch, matchKey)} />
    );
  }

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-2 items-center text-center" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      <div className="text-sm" style={{ color: T.textDim }}>
        {(alreadyPending || submitted)
          ? 'Punteggio inviato. In attesa che anche l’avversario invii il proprio.'
          : 'Nessun turno da giocare al momento.'}
      </div>
      <button onClick={() => setSession(null)} className="text-xs py-1" style={{ color: T.textFaint }}>Torna al tabellone</button>
    </div>
  );
}
```

- [ ] **Step 3: Render `ParticipantAccess` inside `SharedTournamentScreen`**

In `SharedTournamentScreen`, change:

```jsx
      {lastUpdatedAt && (
        <div className="text-xs" style={{ color: T.textFaint }}>
          Ultimo aggiornamento: {new Date(lastUpdatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <PodiumCard podium={podium} accentColor={accentColor} />
```

to:

```jsx
      {lastUpdatedAt && (
        <div className="text-xs" style={{ color: T.textFaint }}>
          Ultimo aggiornamento: {new Date(lastUpdatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <ParticipantAccess tournament={tournament} token={token} onSubmitted={refresh} />

      <PodiumCard podium={podium} accentColor={accentColor} />
```

- [ ] **Step 4: Build and verify in the browser**

```bash
npm run build
```

Using the tournament from Task 2 (with one participant's email set): open its public share link in a fresh/incognito tab. Confirm "Sei un partecipante?" appears. Tap it, try a wrong email — confirm the error message appears and the form stays open. Enter the correct email + that participant's exact name — confirm it transitions past the form. If that participant currently has no playable match, confirm "Nessun turno da giocare al momento." appears (rather than a crash); if they do have one, confirm the real `MatchScreen` renders with the right two names and title. Score through a full match and submit — confirm the screen switches to "Punteggio inviato..." rather than looping back to a blank form.

- [ ] **Step 5: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add participant identification and score entry to the public share page"
```

---

## Task 4: Organizer — poll and reconcile pending submissions

**Files:**
- Modify: `ArcheryScorecard.jsx`
  - Add `unitsMatch` right after `matchRefHasParticipant` (from Task 3)
  - Add a new `useEffect` in the root component, right after the existing `useEffect(() => { setBracketCursor(null); }, [activeTournamentId]);` (line 4818)

**Interfaces:**
- Consumes: `parseRefKey` (Task 3), `isRefPlayable`, `applyMatchResult` (existing), `updateTournament`, `activeTournament`, `userId` (existing root-component locals).

- [ ] **Step 1: Add `unitsMatch`**

Insert immediately after `matchRefHasParticipant`'s closing brace (from Task 3, Step 1):

```js
// Order-insensitive per-unit, per-side comparison: two participants
// independently recalling the same end don't always list the arrows in
// the same order (e.g. "10-9-8" vs "10-8-9" are the same end), so this
// sorts each side's arrows numerically before comparing rather than
// requiring the arrays to match element-for-element. totalA/totalB/spA/spB
// are sums derived from the arrows, so they agree automatically whenever
// the arrows do — no need to compare them separately.
function unitsMatch(unitsA, unitsB) {
  if (!Array.isArray(unitsA) || !Array.isArray(unitsB) || unitsA.length !== unitsB.length) return false;
  const sortNums = arr => [...(arr || [])].sort((x, y) => x - y);
  return unitsA.every((ua, i) => {
    const ub = unitsB[i];
    if (!ub) return false;
    return JSON.stringify(sortNums(ua.arrowsA)) === JSON.stringify(sortNums(ub.arrowsA))
        && JSON.stringify(sortNums(ua.arrowsB)) === JSON.stringify(sortNums(ub.arrowsB));
  });
}
```

- [ ] **Step 2: Add the poll-and-reconcile effect**

Insert immediately after (line 4818):

```js
  useEffect(() => { setBracketCursor(null); }, [activeTournamentId]);
```

this new effect:

```js
  // Participants write their own match submissions directly via the
  // submit_participant_match RPC (Task 1/3) — they have no Supabase Auth
  // session of their own, so that write bypasses this app's local state
  // entirely. While a tournament is open here, poll its own row every 30s
  // for pendingSubmissions a participant may have added, and once both
  // sides of a match agree (see unitsMatch above), apply the result
  // through the exact same applyMatchResult() the organizer's own manual
  // scoring uses — this is the only place bracket-shape knowledge lives,
  // so it's reused rather than taught to SQL a second time.
  const lastPendingJsonRef = useRef('{}');
  useEffect(() => {
    if (!activeTournament || !userId) return;
    let cancelled = false;

    async function reconcile() {
      const { data, error } = await supabase.from('tournaments').select('data').eq('id', activeTournament.id).single();
      if (cancelled || error) return;
      const remotePending = data?.data?.pendingSubmissions || {};
      const remoteJson = JSON.stringify(remotePending);
      if (remoteJson === lastPendingJsonRef.current) return;
      lastPendingJsonRef.current = remoteJson;
      if (Object.keys(remotePending).length === 0) return;

      updateTournament(activeTournament.id, t => {
        let next = t;
        const pending = { ...remotePending };
        for (const [matchKey, submissions] of Object.entries(remotePending)) {
          const ids = Object.keys(submissions);
          if (ids.length < 2) continue; // only one side in so far — nothing to reconcile yet
          const ref = parseRefKey(matchKey);
          if (!isRefPlayable(next, ref)) { delete pending[matchKey]; continue; }
          const [subA, subB] = ids.map(id => submissions[id].updatedMatch);
          if (unitsMatch(subA.units, subB.units)) next = applyMatchResult(next, ref, subA);
          delete pending[matchKey]; // resolved (applied) or mismatched (discarded) either way
        }
        return { ...next, pendingSubmissions: pending };
      });
    }

    reconcile();
    const interval = setInterval(reconcile, 30 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTournament?.id, userId]);
```

- [ ] **Step 3: Build and verify in the browser — matching submission auto-completes**

```bash
npm run build
```

With a tournament that has two participants with emails set on the same playable match: open two separate tabs (or one incognito + one normal) on the public share link, identify as each of the two participants, and submit **the same** arrow values for every unit (arrow order within a unit may differ between the two tabs — that's the point of `unitsMatch`). In the organizer's own authenticated tab (tournament open), wait up to 30s (or reload) and confirm: the match now shows as completed with the correct winner, the bracket has advanced exactly as manual entry would, and `pendingSubmissions` no longer contains an entry for that match (check via a fresh `SELECT data FROM tournaments WHERE id = '<id>'` in the Supabase SQL editor, or by reopening the participant links — both should now show "Nessun turno da giocare al momento" since the match is no longer playable).

- [ ] **Step 4: Build and verify in the browser — mismatched submission clears**

Repeat with two participants on a different playable match, this time submitting **different** arrow values for at least one unit. Confirm: the match stays unscored in the organizer's tab, and reopening either participant's link (after the 30s poll or a reload) shows the entry form again — not "Punteggio inviato" — since their pending submission was cleared.

- [ ] **Step 5: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Poll and reconcile participant-submitted match scores"
```

---

## Task 5: Document in README and push

**Files:**
- Modify: `README.md` (append a new version section, following the existing pattern — see the "v1.14 additions" section for the outbox/round-labels feature as a template)

- [ ] **Step 1: Add a README section**

Append a new section after the most recent version section (search the file for the highest existing `## v1.` heading and add directly after its content), following the file's existing style:

```markdown
## v1.15 additions — Participant self-scoring

Lets a tournament organizer attach an email to any participant (a new
"Gestisci email partecipanti" panel on the bracket screen — works whether
or not the tournament has started). That participant can then open the
existing public share link, tap "Sei un partecipante?", and identify
themselves with that email + their name to score their own current match
from their phone — the same arrow-by-arrow entry screen the organizer
uses, tap-only (no keyboard-scoring mode, which stays an organizer-only
convenience).

A match only ever updates once **both** participants have independently
submitted it, and their arrows are compared per unit as a sorted set
rather than requiring the same entry order (so "10-9-8" and "10-8-9" count
as the same end). A mismatch clears both submissions silently — the next
time either participant reopens their link, they just see the entry form
again. Everything is stored in a new `pendingSubmissions` field alongside
the tournament's existing data (no schema migration), written by two new
`security definer` SQL functions (`identify_participant`,
`submit_participant_match`) that re-derive identity from email+name on
every call and never touch bracket structure directly — only the
organizer's own app, which polls for pending submissions every 30s while a
tournament is open, ever calls `applyMatchResult()` to actually advance
the bracket. No email is ever sent by the app; the organizer shares the
link themselves.
```

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "Document v1.15 participant self-scoring in README"
git push origin claude/arcieri-senesi-scorecard-52a25z
```

---

## Self-review notes (for the plan author, not a task to execute)

- **Spec coverage:** data model (Task 1/2/3), admin email panel (Task 2), SQL functions (Task 1), participant identification (Task 3), score entry reusing `MatchScreen` (Task 3), order-insensitive reconciliation (Task 4), no-email-sending / no-accounts (respected throughout, no task adds either) — all covered. Two deviations from the literal spec are called out explicitly in Global Constraints above (3-way final exclusion, the added poll) rather than silently introduced.
- **Type consistency:** `refKey`/`parseRefKey` (Task 3) are the only encode/decode pair for `pendingSubmissions` keys and are used identically in Task 3 (`ParticipantAccess`) and Task 4 (reconciliation effect). `updatedMatch` — the shape `MatchScreen`'s `onComplete` already produces — flows unchanged from Task 3's `submit()` through storage into Task 4's `applyMatchResult(next, ref, subA)` call, matching `applyMatchResult`'s existing signature exactly.
