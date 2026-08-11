# Tournament Sharing (Public Spectator Link) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tournament organizer generate a public, no-login link that shows a read-only, auto-updating view of the bracket.

**Architecture:** A new Postgres function (`get_shared_tournament`) is the sole public read path — no RLS policy changes, so private data stays exactly as private as it is today. `shareToken` is a plain field inside the tournament's existing `data` JSON blob (no schema migration). `entry.jsx` checks the URL for `?share=<token>` before deciding whether to mount the authenticated app or a new, standalone `SharedTournamentScreen` that never touches auth. That screen polls the RPC every 45s but only re-renders when the returned `updated_at` actually changes.

**Tech Stack:** React 18 (hooks only), `@supabase/supabase-js` (already used throughout), `lucide-react` icons, Tailwind utility classes. Everything client-side lives in `ArcheryScorecard.jsx` except the one-line `entry.jsx` change; the SQL lives in `supabase/schema.sql`.

## Global Constraints

- No new dependencies, no new files beyond what's listed per task.
- No test framework exists in this repo. Verification is: (a) `npm run build` stays clean, (b) live browser checks via the local static preview server (`.claude/launch.json`, name `static`, port 8934).
- Follow existing patterns exactly: the `T.*` color token object, `GOLD_TEXT` for text on gold backgrounds, the collapsed-button-expands-to-panel idiom already used by `ResetTournamentButton` (`ArcheryScorecard.jsx:3676`), and the tap-to-arm confirm idiom used by `DeleteSessionButton` (`ArcheryScorecard.jsx:2296`).
- **Cannot be verified end-to-end without a manual step only the user can perform**: Task 1's SQL must be run in the user's live Supabase SQL Editor before Task 3's spectator screen can be live-tested against real data. Stop and ask the user to do this — never attempt to run SQL against their live database directly, there is no credential or tool available to do so, and it wouldn't be appropriate to try even if there were.
- Spec: `docs/superpowers/specs/2026-07-29-tournament-sharing-design.md`.
- **Deliberate scope narrowing vs. the spec's wording**: the spec says the public screen "reuses the existing bracket-tree/list rendering... in a read-only mode." This plan reuses only the tree view (`BracketTree`), not the list-view toggle — the tree is already this app's default view (see `BracketScreen`'s `viewMode` state, defaulting to `'bracket'`) and shows everything a spectator needs. Adding the list-mode toggle back is a small, separable follow-up if it turns out to be wanted.

---

### Task 1: SQL — public read function

**Files:**
- Modify: `supabase/schema.sql` — append the new function after the existing `tournaments` policies (end of file).

**Interfaces:**
- Consumes: the existing `public.tournaments` table (`id`, `user_id`, `data jsonb`, `updated_at`).
- Produces: a Postgres function `public.get_shared_tournament(p_token text)` returning `table(data jsonb, updated_at timestamptz)`, callable by anonymous clients. Task 3's `SharedTournamentScreen` calls this via `supabase.rpc('get_shared_tournament', { p_token: token })`.

- [ ] **Step 1: Append the function to `supabase/schema.sql`**

Add this to the end of the file:

```sql

-- Tournament sharing: a tournament organizer can put a random token into
-- their tournament's data (data->>'shareToken', set from the app — no
-- migration needed since it's just a field inside the existing JSONB blob)
-- to make it publicly viewable at /?share=<token>. This function is the
-- ONLY public read path — it runs with the owner's privileges (security
-- definer) so no new RLS policy is needed on the table itself, and unlike
-- a table-level policy, a parameterized function can never be used to
-- enumerate every shared tournament: it only ever returns the one row
-- whose token exactly matches what the caller already has.
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

- [ ] **Step 2: Ask the user to run it**

This SQL cannot be applied automatically — there is no database credential available for DDL, and this is the user's live production data. Tell the user:

> "I've added the `get_shared_tournament` function to `supabase/schema.sql`. Could you run it in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query → paste the new function from the end of `supabase/schema.sql` → Run)? I need this live before I can test the spectator link end-to-end."

Wait for their confirmation before treating Task 3's live-verification step as unblocked. It's fine to write and build-verify Tasks 2 and 3's code before this is confirmed — only the final end-to-end browser check in Task 3 actually needs it.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add get_shared_tournament() for public read-only tournament links"
```

---

### Task 2: Organizer share controls

**Files:**
- Modify: `ArcheryScorecard.jsx`:
  - Add `Share2` to the `lucide-react` import (currently `ArcheryScorecard.jsx:6-10`).
  - Add a new `ShareTournamentControl` component, placed directly after `ResetTournamentButton` (currently ends at `ArcheryScorecard.jsx:3702`).
  - Wire it into `BracketScreen` (currently `ArcheryScorecard.jsx:3704`): add an `onSetShareToken` prop, and render `<ShareTournamentControl>` right after the date/format info line (currently `ArcheryScorecard.jsx:3721-3723`), before `<PodiumCard/>`.
  - Wire the call site (currently `ArcheryScorecard.jsx:4613-4621`, the `<BracketScreen .../>` render inside the root component) to pass `onSetShareToken={(token) => updateTournament(activeTournament.id, t => ({ ...t, shareToken: token }))}`. `updateTournament` is already in scope there (used by the existing `onReset`/`onSetLancasterWildcard` props on the same element).

**Interfaces:**
- Consumes: `T`, `GOLD_TEXT` (module-level color tokens), `updateTournament(id, updater)` (already defined in the root component, `ArcheryScorecard.jsx` around line 4511 — takes a tournament id and a `tournament => tournament` updater function, saves the result).
- Produces: every tournament object gains an optional `shareToken: string | null` field (lives inside the existing JSONB `data`, no new column). Task 3 reads this field indirectly, via Task 1's SQL function, not directly from this component.

- [ ] **Step 1: Add the `Share2` import**

Change (`ArcheryScorecard.jsx:6-10`):

```js
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, Upload, RotateCcw, Play, Check, StickyNote, LogOut, BarChart3,
  Swords, Trophy, Users, UserPlus, Shuffle, Minus, RefreshCw, Unlock, Pencil,
} from 'lucide-react';
```

to:

```js
import {
  Target, Clock, ChevronLeft, ChevronRight, Plus, Trash2,
  Download, Upload, RotateCcw, Play, Check, StickyNote, LogOut, BarChart3,
  Swords, Trophy, Users, UserPlus, Shuffle, Minus, RefreshCw, Unlock, Pencil, Share2,
} from 'lucide-react';
```

- [ ] **Step 2: Add `ShareTournamentControl`**

Insert immediately after `ResetTournamentButton`'s closing `}` (`ArcheryScorecard.jsx:3702`):

```jsx
// Same collapsed-button-expands-to-panel idiom as ResetTournamentButton
// right above. Minting a token is idempotent (re-tapping "Condividi
// torneo" after a link already exists just re-copies it) so an already-
// sent link never silently breaks.
function ShareTournamentControl({ tournament, onSetShareToken }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = () => {
    const token = tournament.shareToken || crypto.randomUUID();
    if (!tournament.shareToken) onSetShareToken(token);
    const url = `${window.location.origin}${window.location.pathname}?share=${token}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.surface, color: T.textDim, border: `1px solid ${T.border}` }}>
        <Share2 size={16} /> Condividi torneo
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-3" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      <div className="text-xs" style={{ color: T.textDim }}>
        Chiunque abbia questo link può seguire il tabellone in tempo reale, senza bisogno di accedere.
      </div>
      <button onClick={handleCopy}
        className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Share2 size={16} /> {copied ? 'Link copiato!' : (tournament.shareToken ? 'Copia link' : 'Genera e copia link')}
      </button>
      {tournament.shareToken && (
        <button onClick={() => onSetShareToken(null)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Disattiva condivisione</button>
      )}
      <button onClick={() => setOpen(false)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Chiudi</button>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `BracketScreen`**

Change the function signature (`ArcheryScorecard.jsx:3704`) from:

```jsx
function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
```

to:

```jsx
function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetShareToken, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
```

Then change (`ArcheryScorecard.jsx:3721-3725`):

```jsx
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>

      <PodiumCard podium={podium} />
```

to:

```jsx
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>

      <ShareTournamentControl tournament={tournament} onSetShareToken={onSetShareToken} />

      <PodiumCard podium={podium} />
```

- [ ] **Step 4: Wire the call site**

Change (`ArcheryScorecard.jsx:4613-4621`):

```jsx
            <BracketScreen tournament={activeTournament} focusRef={bracketFocusRef}
              onBack={() => { setActiveMatchRef(null); setActiveTournamentId(null); setView('tornei'); }}
              onOpenMatch={(ref) => { setActiveMatchRef(ref); if (!superuser) setView('match'); }}
              onOpenThreeFinal={() => { setActiveMatchRef({ kind: 'threeFinal' }); if (!superuser) setView('threefinal'); }}
              onDelete={() => { setActiveMatchRef(null); deleteTournament(activeTournament.id); setActiveTournamentId(null); setView('tornei'); }}
              onEditParticipants={() => setView('tornei-edit')}
              onReset={(finalFormat) => updateTournament(activeTournament.id, t => resetTournamentBracket(t, finalFormat))}
              onSetLancasterWildcard={(wildcard) => updateTournament(activeTournament.id, t => ({ ...t, finalStage: setLancasterWildcard(t.finalStage, wildcard) }))}
              onClearLancasterWildcard={() => updateTournament(activeTournament.id, t => ({ ...t, finalStage: clearLancasterWildcard(t.finalStage) }))} />
```

to:

```jsx
            <BracketScreen tournament={activeTournament} focusRef={bracketFocusRef}
              onBack={() => { setActiveMatchRef(null); setActiveTournamentId(null); setView('tornei'); }}
              onOpenMatch={(ref) => { setActiveMatchRef(ref); if (!superuser) setView('match'); }}
              onOpenThreeFinal={() => { setActiveMatchRef({ kind: 'threeFinal' }); if (!superuser) setView('threefinal'); }}
              onDelete={() => { setActiveMatchRef(null); deleteTournament(activeTournament.id); setActiveTournamentId(null); setView('tornei'); }}
              onEditParticipants={() => setView('tornei-edit')}
              onReset={(finalFormat) => updateTournament(activeTournament.id, t => resetTournamentBracket(t, finalFormat))}
              onSetShareToken={(token) => updateTournament(activeTournament.id, t => ({ ...t, shareToken: token }))}
              onSetLancasterWildcard={(wildcard) => updateTournament(activeTournament.id, t => ({ ...t, finalStage: setLancasterWildcard(t.finalStage, wildcard) }))}
              onClearLancasterWildcard={() => updateTournament(activeTournament.id, t => ({ ...t, finalStage: clearLancasterWildcard(t.finalStage) }))} />
```

- [ ] **Step 5: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)`.

- [ ] **Step 6: Live-verify in the browser**

1. Start the preview server (name `static`, port 8934), navigate to `http://localhost:8934`. If prompted to log in, ask the user — never enter credentials yourself.
2. Open a tournament's bracket screen ("Tornei" tab → any existing tournament, or create one).
3. Confirm a "Condividi torneo" button appears below the date/format line, above the podium.
4. Tap it — confirm it expands to a panel with a gold "Genera e copia link" button.
5. Tap that — confirm the button label changes to "Link copiato!" briefly, then confirm a "Disattiva condivisione" text link now appears below it.
6. Collapse the panel ("Chiudi") and reopen it — confirm the button now reads "Copia link" (not "Genera e copia link"), proving the token persisted.
7. Tap "Disattiva condivisione" — confirm it disappears and the button reverts to "Genera e copia link" on next open.
8. Screenshot for the record.

Note: actually reading back the copied clipboard content isn't reliably automatable in this environment — verify via the button-label state transitions above instead, which prove the same underlying behavior (token minted, persisted, and cleared).

- [ ] **Step 7: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add organizer share controls to BracketScreen"
```

---

### Task 3: Public spectator screen

**Files:**
- Modify: `ArcheryScorecard.jsx` — add a new exported `SharedTournamentScreen` component, placed after `BracketScreen`'s closing `}` (currently `ArcheryScorecard.jsx:3788`, right before the `ResetTournamentButton` comment block Task 2 already added a sibling near).
- Modify: `site/entry.jsx` — branch on `?share=` before mounting.

**Interfaces:**
- Consumes: `supabase` (module-level client, `ArcheryScorecard.jsx:725`), `normalizeTournament(t)` (`ArcheryScorecard.jsx:769`), `LoadingScreen` (`ArcheryScorecard.jsx:872`), `PodiumCard`, `tournamentPodium`, `BracketTree`, `MatchCard`, `ThreeWayFinalCard`, `formatDateShort`, `matchFormatDef`, `finalFormatDef`, `T`, `RefreshCw` — all already defined/imported earlier in the same file.
- Produces: `export function SharedTournamentScreen({ token })`, imported by `site/entry.jsx`. Nothing else consumes it.

- [ ] **Step 1: Add `SharedTournamentScreen`**

Insert after `BracketScreen`'s closing `}` (`ArcheryScorecard.jsx:3788`), before the `ResetTournamentButton` comment block:

```jsx
// Public, no-login view of a tournament — mounted directly by entry.jsx
// when the URL has ?share=<token>, bypassing AuthGate and every bit of
// Supabase auth machinery entirely (a spectator's visit should never fire
// an auth listener or session check). Polls get_shared_tournament() every
// 45s but only touches state (and re-renders) when the row's updated_at
// actually moved, so an unchanged bracket never visibly flickers.
export function SharedTournamentScreen({ token }) {
  const [tournament, setTournament] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'not-found'

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_shared_tournament', { p_token: token });
    // A transient network error leaves whatever's currently displayed
    // alone and just retries next interval — only a successful call that
    // genuinely finds no matching row means "not shared" (spec edge case:
    // a failed request must never be treated the same as an invalid token).
    if (error) return;
    if (!data || data.length === 0) {
      setStatus('not-found');
      return;
    }
    const row = data[0];
    setStatus('ready');
    setLastUpdatedAt(prev => {
      if (prev === row.updated_at) return prev;
      setTournament(normalizeTournament(row.data));
      return row.updated_at;
    });
  }, [token]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 45000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'not-found') {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" style={{ background: T.bg, color: T.textDim }}>
        Questo torneo non è più condiviso, o il link non è valido.
      </div>
    );
  }

  const podium = tournamentPodium(tournament);
  const fs = tournament.finalStage;

  return (
    <div className="min-h-screen w-full mx-auto px-4 pt-4 pb-12 flex flex-col gap-4" style={{ background: T.bg, color: T.text }}>
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold flex-1 truncate">{tournament.name}</h1>
        <button onClick={refresh} className="p-2 rounded-full min-w-11 min-h-11 flex items-center justify-center" style={{ background: T.surface, border: `1px solid ${T.border}` }} aria-label="Aggiorna">
          <RefreshCw size={18} color={T.textDim} />
        </button>
      </div>
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>
      {lastUpdatedAt && (
        <div className="text-xs" style={{ color: T.textFaint }}>
          Ultimo aggiornamento: {new Date(lastUpdatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      <PodiumCard podium={podium} />

      {tournament.rounds.length > 0 && <BracketTree tournament={tournament} onOpenMatch={() => {}} focusRef={null} />}

      {tournament.finalFormat === 'standard' && tournament.thirdPlaceMatch && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold" style={{ color: T.textDim }}>Finale 3°/4° posto</div>
          <MatchCard match={tournament.thirdPlaceMatch} onOpen={() => {}} focused={false} />
        </div>
      )}

      {tournament.finalFormat === 'threeway' && fs && (
        <>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Preliminare 3°/4° posto</div>
            <MatchCard match={fs.prelim} onOpen={() => {}} focused={false} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Finale a 3 — oro/argento/bronzo</div>
            <ThreeWayFinalCard final={fs.final} onOpen={() => {}} focused={false} />
          </div>
        </>
      )}

      {tournament.finalFormat === 'lancaster' && fs && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold" style={{ color: T.textDim }}>Finale Lancaster (per punteggio di qualifica)</div>
          <div className="flex flex-col gap-2">
            {fs.playIn && <MatchCard match={fs.playIn} onOpen={() => {}} focused={false} />}
            <MatchCard match={fs.match1} onOpen={() => {}} focused={false} />
            <MatchCard match={fs.match2} onOpen={() => {}} focused={false} />
            <MatchCard match={fs.match3} onOpen={() => {}} focused={false} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire up `site/entry.jsx`**

Change (`site/entry.jsx`, full current contents):

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import ArcheryScorecard from '../ArcheryScorecard.jsx';

createRoot(document.getElementById('root')).render(<ArcheryScorecard />);
```

to:

```jsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import ArcheryScorecard, { SharedTournamentScreen } from '../ArcheryScorecard.jsx';

const shareToken = new URLSearchParams(window.location.search).get('share');

createRoot(document.getElementById('root')).render(
  shareToken ? <SharedTournamentScreen token={shareToken} /> : <ArcheryScorecard />
);
```

- [ ] **Step 3: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)`.

- [ ] **Step 4: Confirm Task 1's SQL has been applied**

If the user hasn't yet confirmed they ran the SQL from Task 1 in their Supabase SQL Editor, stop here and ask now — the rest of this task's verification needs it live.

- [ ] **Step 5: Live-verify end-to-end in the browser**

1. In the authenticated tab, open a tournament that has at least one playable match, tap "Condividi torneo" → "Genera e copia link" (Task 2). Note the tournament's name for identification.
2. Open a **fresh, logged-out** browser tab (or a private/incognito context) at the copied URL directly (reconstruct it as `http://localhost:8934/?share=<token>` if the clipboard can't be read back programmatically — read the token from the running app's state via the browser tools if needed, e.g. by inspecting the React fiber for `activeTournament.shareToken`, same technique used elsewhere in this project's verification).
3. Confirm the tournament renders read-only: correct name, podium, bracket tree, no organizer controls (no edit/reset/delete/share buttons, no score-entry affordance), tapping a match card does nothing.
4. Back in the authenticated tab, score an arrow/end/match result.
5. In the public tab, tap the manual refresh icon — confirm the update appears and "Ultimo aggiornamento" advances.
6. Back in the authenticated tab, tap "Disattiva condivisione" on that tournament.
7. In the public tab, tap refresh again — confirm it now shows "Questo torneo non è più condiviso, o il link non è valido."
8. Screenshot the working spectator view for the record.

- [ ] **Step 6: Commit**

```bash
git add ArcheryScorecard.jsx site/entry.jsx
git commit -m "Add public spectator screen for shared tournaments"
```

---

### Task 4: Document in README and push

**Files:**
- Modify: `README.md` — append a new `## v1.12 additions` section after the existing `## v1.11 additions` section (end of file).

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (final task).

- [ ] **Step 1: Add the README section**

Append to the end of `README.md`:

```markdown

## v1.12 additions — Tournament sharing

- **Public spectator link**: a "Condividi torneo" control on the bracket
  screen generates a `?share=<token>` link that anyone can open without
  logging in, to watch the bracket update as it's scored
  (`SharedTournamentScreen`, mounted directly by `site/entry.jsx` — it
  never touches Supabase auth at all). The token
  (`crypto.randomUUID()`) lives inside the tournament's own `data` blob,
  same as every other tournament field, so no database migration was
  needed. The only public read path is a new `security definer` SQL
  function, `get_shared_tournament()` (`supabase/schema.sql`) — it can
  only ever return the one row whose token matches what the caller
  already has, so (unlike a table-level RLS policy would) it can't be used
  to enumerate every tournament anyone has ever shared. "Disattiva
  condivisione" clears the token, turning existing copies of the link into
  a plain "no longer shared" message on their next check.
- **Deliberately polling, not push**: the public screen re-checks every
  45 seconds (plus a manual refresh icon) rather than using a live
  subscription — but it only ever re-renders when the fetched data's
  `updated_at` actually changed, so an unchanged bracket never flickers.
  True zero-polling push was considered and rejected: Supabase Realtime
  subscriptions are filtered by table-level RLS, not by a security-definer
  function, so enabling it for anonymous spectators would have meant
  re-opening the exact "list every shared tournament" leak the RPC
  design exists to avoid.
```

- [ ] **Step 2: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully (README changes don't affect the build, but this confirms nothing else broke since Task 3).

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "Document v1.12 tournament sharing in README"
git push
```

- [ ] **Step 4: Confirm the push landed**

Run: `git log --oneline -6` and `git status`
Expected: the four commits from this plan appear at the top of the log, and `git status` reports the branch is up to date with its remote (no unpushed commits).
