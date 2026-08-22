# Tournament Logo + Accent Color Implementation Plan

> **Shipped in v1.13** — Tournament logo + accent colour. This is a historical planning record, not open work.
> Its step checkboxes below were never ticked; they are left as they were written rather than
> back-filled with a completion record nobody witnessed. See `CHANGELOG.md` for what actually
> shipped. **The "REQUIRED SUB-SKILL" note that follows no longer applies** — there is nothing
> here left to implement.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tournament organizer upload a logo, show it on both the organizer's and the public spectator's bracket screens, and swap the public page's gold accent for a color extracted from that logo (falling back to gold if the extracted color fails a contrast check).

**Architecture:** A new public Supabase Storage bucket holds logo images, one per tournament at a fixed `{user_id}/{tournament_id}.png` path, uploaded via client-side canvas resize (no server processing). `logoUrl`/`accentColor` are new fields inside the tournament's existing `data` JSON blob — no schema migration. Five shared bracket-rendering components (`MatchCard`, `CompactMatchCard`, `BracketTree`, `ThreeWayFinalCard`, `PodiumCard`) gain an optional `accentColor` prop defaulting to `T.gold`, so the organizer's `BracketScreen` (which never passes it) looks identical to today, while `SharedTournamentScreen` passes the tournament's extracted color through all of them.

**Tech Stack:** React 18 (hooks only), `@supabase/supabase-js` (Storage API, already imported), Canvas 2D API (`HTMLCanvasElement`, `CanvasRenderingContext2D.getImageData`) for resize + color sampling — no new dependency. Everything client-side lives in `ArcheryScorecard.jsx`; the bucket/policy setup lives in `supabase/schema.sql`.

## Global Constraints

- No new dependencies, no new files beyond what's listed per task.
- No test framework exists in this repo. Verification is: (a) `node -e` sanity checks for pure arithmetic (the contrast-ratio math has no DOM dependency), (b) browser-console checks for anything touching Canvas/Image (color extraction needs a real `<canvas>`, unavailable in plain Node), (c) `npm run build` must stay clean, (d) live browser checks via the local static preview server (`.claude/launch.json`, name `static`, port 8934).
- Follow existing patterns exactly: `T.*`/`GOLD_TEXT` color tokens, the collapsed-panel idiom already used by `ShareTournamentControl`/`ResetTournamentButton` (`ArcheryScorecard.jsx:3713`/`3681`), `ImportButton`'s file-input-via-ref pattern (`ArcheryScorecard.jsx:1650`) for the file picker itself, and the `flagSaveError`-style "surface it, don't fail silently" convention for upload errors.
- **Cannot be verified end-to-end without a manual step only the user can perform**: Task 1's SQL (bucket + policies) must be run in the user's live Supabase SQL Editor before Task 3's upload can be live-tested against real Storage. Stop and ask the user to do this — never attempt to run SQL or create storage buckets against their live project directly, there is no credential or tool available to do so.
- Spec: `docs/superpowers/specs/2026-07-29-tournament-logo-design.md`.

---

### Task 1: Storage bucket + RLS policies

**Files:**
- Modify: `supabase/schema.sql` — append after the `get_shared_tournament` block added by the previous feature (end of file).

**Interfaces:**
- Consumes: nothing new — this is the first task.
- Produces: a public Storage bucket named `tournament-logos`, with insert/update/delete restricted to the authenticated owner's own `{user_id}/` folder. Task 3's upload/remove calls target this bucket by name.

- [ ] **Step 1: Append the bucket + policies to `supabase/schema.sql`**

```sql

-- Tournament logos: a public Storage bucket (public bucket = reads bypass
-- RLS entirely, served via a plain URL — appropriate here since a logo
-- isn't sensitive the way bracket/score data is, unlike the tournaments
-- table itself). Writes are still locked down: an authenticated user may
-- only insert/update/delete objects inside a folder path prefixed with
-- their own auth.uid(), enforced by matching the first path segment.
insert into storage.buckets (id, name, public)
values ('tournament-logos', 'tournament-logos', true)
on conflict (id) do nothing;

create policy "insert own logos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "update own logos" on storage.objects
  for update to authenticated
  using (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own logos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 2: Ask the user to run it**

Tell the user:

> "I've added the `tournament-logos` bucket and its policies to `supabase/schema.sql`. Could you run that block in your Supabase project's SQL Editor (Dashboard → SQL Editor → New query → paste the new block from the end of `supabase/schema.sql` → Run)? Same project as before. I need this live before I can test logo upload end-to-end."

Wait for their confirmation before treating Task 3's live-verification step as unblocked. It's fine to write and build-verify Tasks 2-4's code before this is confirmed.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add tournament-logos Storage bucket and owner-scoped write policies"
```

---

### Task 2: Color extraction + contrast helpers

**Files:**
- Modify: `ArcheryScorecard.jsx` — add five new pure/near-pure functions near `uidT()` (`ArcheryScorecard.jsx:2918`), after its closing line.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `loadImageFromFile(file)` → `Promise<HTMLImageElement>`
  - `resizeToCanvas(img, maxEdge)` → `HTMLCanvasElement`, downscaled so its longer edge is at most `maxEdge`
  - `extractAccentColor(canvas)` → `string | null` (a `#rrggbb` hex string, or `null` if every pixel got filtered out — e.g. a fully transparent or perfectly neutral-gray image)
  - `contrastRatio(hexA, hexB)` → `number`, the WCAG contrast ratio between two `#rrggbb` colors
  - `accentColorContrastOk(hex)` → `boolean`, `contrastRatio(hex, T.bg) >= 3`

  Task 3's `LogoUpload` calls all five of these directly.

- [ ] **Step 1: Sanity-check the contrast math in isolation**

This part has no DOM dependency, so it can be checked with plain Node before it's embedded in the file. Red against this app's near-black background should clear the 3:1 threshold comfortably; a dark slate blue close to the background's own darkness should not:

```bash
node -e "
function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA) + 0.05;
  const lB = relativeLuminance(hexB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}
console.log('red vs bg:', contrastRatio('#FF0000', '#14161A'));
console.log('dark slate vs bg:', contrastRatio('#1A1F2E', '#14161A'));
"
```

Expected output: the first ratio is comfortably above `3` (around `4.5`–`4.7`), the second is close to `1` (well below `3`) — confirming a bright, distinct color passes and a color close in darkness to the background correctly fails.

- [ ] **Step 2: Add the five functions to `ArcheryScorecard.jsx`**

Insert after `uidT()`'s line (`ArcheryScorecard.jsx:2918`, `function uidT() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }`):

```js
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function resizeToCanvas(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Averages only the "colorful" pixels — filters out near-white, near-black,
// and low-saturation ones a plain average would get dragged toward (usually
// a logo's background, not its actual mark) — so the result reads as
// roughly "the logo's color" instead of a washed-out gray.
function extractAccentColor(canvas) {
  const { width, height } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const lightness = (max + min) / 2;
    const delta = max - min;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < 0.15 || lightness < 0.12 || lightness > 0.9) continue;
    rSum += r; gSum += g; bSum += b; count++;
  }
  if (count === 0) return null;
  const toHex = v => Math.round(v / count).toString(16).padStart(2, '0');
  return `#${toHex(rSum)}${toHex(gSum)}${toHex(bSum)}`;
}

function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA) + 0.05;
  const lB = relativeLuminance(hexB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

function accentColorContrastOk(hex) {
  return contrastRatio(hex, T.bg) >= 3;
}
```

- [ ] **Step 3: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)`.

- [ ] **Step 4: Verify `extractAccentColor` against a known image, in the browser**

Start the preview server (name `static`, port 8934) if not already running, navigate to `http://localhost:8934`, and run this in the browser console (via the project's browser tooling) — it builds a small solid-red canvas in memory and checks extraction against it, independent of any app UI:

```js
(function() {
  const canvas = document.createElement('canvas');
  canvas.width = 20; canvas.height = 20;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#CC2222';
  ctx.fillRect(0, 0, 20, 20);
  return extractAccentColor(canvas);
})();
```

Expected: a hex string close to `#cc2222` (exact channel values may drift by a few units from anti-aliasing/rounding, but it must read as a clearly red color, not gray or black). Note: this only works if `extractAccentColor` is reachable from the console — since the app bundles everything into one closure, run this check right after Step 2 by temporarily calling it from a throwaway `window.__test = extractAccentColor` line near the top-level module scope, execute the check, then remove that line before committing (never leave debug globals in the shipped file).

- [ ] **Step 5: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add logo color extraction and WCAG contrast helpers"
```

---

### Task 3: `LogoUpload` control + organizer-side display

**Files:**
- Modify: `ArcheryScorecard.jsx`:
  - Add a new `LogoUpload` component, placed directly after `ShareTournamentControl`'s closing `}` (currently ends at `ArcheryScorecard.jsx:3758`, right before `function BracketScreen(...)`).
  - Wire it into `BracketScreen`: new `userId`/`onSetLogo` props, a logo image + the `LogoUpload` control rendered near the header.
  - Wire the root-component call site (`ArcheryScorecard.jsx:4782`) to pass `userId={userId}` and `onSetLogo={(logo) => updateTournament(activeTournament.id, t => ({ ...t, ...logo }))}`.

**Interfaces:**
- Consumes: `loadImageFromFile`, `resizeToCanvas`, `extractAccentColor`, `accentColorContrastOk` (Task 2), `supabase` (module-level client, `ArcheryScorecard.jsx:725`), `T`/`GOLD_TEXT` tokens, `updateTournament(id, updater)` and `userId` (both already in scope in the root component).
- Produces: every tournament object gains optional `logoUrl: string | null` and `accentColor: string | null` fields (inside `data`, no new column) — Task 4 reads `tournament.accentColor` and `tournament.logoUrl` from `SharedTournamentScreen`.

- [ ] **Step 1: Add the `LogoUpload` component**

Insert after `ShareTournamentControl`'s closing `}` (`ArcheryScorecard.jsx:3758`), before `function BracketScreen`:

```jsx
// Same collapsed-button-expands-to-panel idiom as ShareTournamentControl
// right above. Resizes and re-extracts the accent color client-side before
// ever touching the network — the upload itself is always a small PNG,
// regardless of what the organizer's phone camera originally produced.
function LogoUpload({ tournament, userId, onSetLogo }) {
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Formato non valido — usa PNG, JPG o WebP.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const img = await loadImageFromFile(file);
      const canvas = resizeToCanvas(img, 512);
      const extracted = extractAccentColor(canvas);
      const accentColor = extracted && accentColorContrastOk(extracted) ? extracted : null;
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const path = `${userId}/${tournament.id}.png`;
      const { error: uploadError } = await supabase.storage.from('tournament-logos').upload(path, blob, { upsert: true, contentType: 'image/png' });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('tournament-logos').getPublicUrl(path);
      // Cache-bust: the path is fixed per tournament, so re-uploading at the
      // same URL needs a changing query string or a stale cached image could
      // keep being served after a real change.
      onSetLogo({ logoUrl: `${publicUrl}?v=${Date.now()}`, accentColor });
    } catch (err) {
      console.error('Errore caricamento logo', err);
      setError('Caricamento non riuscito. Riprova.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      await supabase.storage.from('tournament-logos').remove([`${userId}/${tournament.id}.png`]);
    } catch (err) {
      console.error('Errore rimozione logo', err);
    }
    onSetLogo({ logoUrl: null, accentColor: null });
    setBusy(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-2xl py-3 font-semibold flex items-center justify-center gap-2 min-h-11"
        style={{ background: T.surface, color: T.textDim, border: `1px solid ${T.border}` }}>
        <Target size={16} /> {tournament.logoUrl ? 'Cambia logo' : 'Carica logo'}
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-3" style={{ background: T.surfaceAlt, border: `1px dashed ${T.border}` }}>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFile} />
      {error && <div className="text-xs" style={{ color: T.red }}>{error}</div>}
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        className="rounded-xl py-2.5 font-semibold flex items-center justify-center gap-2 min-h-11 disabled:opacity-40"
        style={{ background: T.gold, color: GOLD_TEXT }}>
        <Target size={16} /> {busy ? 'Caricamento…' : (tournament.logoUrl ? 'Sostituisci logo' : 'Scegli immagine')}
      </button>
      {tournament.logoUrl && (
        <button onClick={handleRemove} disabled={busy} className="text-xs self-center py-1 disabled:opacity-40" style={{ color: T.textFaint }}>Rimuovi logo</button>
      )}
      <button onClick={() => setOpen(false)} className="text-xs self-center py-1" style={{ color: T.textFaint }}>Chiudi</button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `BracketScreen`**

Change the function signature (`ArcheryScorecard.jsx:3759`) from:

```jsx
function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetShareToken, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
```

to:

```jsx
function BracketScreen({ tournament, onBack, onOpenMatch, onOpenThreeFinal, onDelete, onEditParticipants, onReset, onSetShareToken, userId, onSetLogo, onSetLancasterWildcard, onClearLancasterWildcard, focusRef }) {
```

Then change (`ArcheryScorecard.jsx:3776-3780`):

```jsx
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>

      <ShareTournamentControl tournament={tournament} onSetShareToken={onSetShareToken} />
```

to:

```jsx
      <div className="text-sm" style={{ color: T.textDim }}>
        {formatDateShort(tournament.date)} · {matchFormatDef(tournament.formatId).label} · {tournament.distanceM}m/{tournament.faceCm}cm · {finalFormatDef(tournament.finalFormat).label}
      </div>

      {tournament.logoUrl && (
        <img src={tournament.logoUrl} alt="Logo del torneo" className="h-16 w-auto self-start rounded-xl" style={{ background: T.surface }} />
      )}
      <LogoUpload tournament={tournament} userId={userId} onSetLogo={onSetLogo} />

      <ShareTournamentControl tournament={tournament} onSetShareToken={onSetShareToken} />
```

- [ ] **Step 3: Wire the call site**

Change (`ArcheryScorecard.jsx:4782-4791`):

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
              userId={userId}
              onSetLogo={(logo) => updateTournament(activeTournament.id, t => ({ ...t, ...logo }))}
              onSetLancasterWildcard={(wildcard) => updateTournament(activeTournament.id, t => ({ ...t, finalStage: setLancasterWildcard(t.finalStage, wildcard) }))}
              onClearLancasterWildcard={() => updateTournament(activeTournament.id, t => ({ ...t, finalStage: clearLancasterWildcard(t.finalStage) }))} />
```

- [ ] **Step 4: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)`.

- [ ] **Step 5: Confirm Task 1's SQL has been applied**

If the user hasn't yet confirmed they ran Task 1's SQL, stop here and ask now — this task's live verification needs it.

- [ ] **Step 6: Live-verify in the browser**

1. Start the preview server (name `static`, port 8934), navigate to `http://localhost:8934`, log in if prompted (ask the user — never enter credentials).
2. Open a tournament's bracket screen.
3. Tap "Carica logo" → "Scegli immagine", pick a real image file.
4. Confirm: the button briefly shows "Caricamento…", then a logo thumbnail appears above the upload control, and the button now reads "Cambia logo".
5. Reload the page and reopen the same tournament — confirm the logo is still there (proves it persisted, not just local state).
6. Tap "Cambia logo" → "Rimuovi logo" — confirm the thumbnail disappears and the button reverts to "Carica logo".
7. Screenshot for the record.

- [ ] **Step 7: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Add LogoUpload control and organizer-side logo display"
```

---

### Task 4: Accent color on the public page

**Files:**
- Modify: `ArcheryScorecard.jsx`:
  - `MatchCard`, `CompactMatchCard`, `BracketTree`, `ThreeWayFinalCard`, `PodiumCard` — add an `accentColor = T.gold` default parameter to each, replace their internal `T.gold` references with `accentColor`.
  - `SharedTournamentScreen` — display the logo, compute `accentColor = tournament.accentColor || T.gold` once, pass it to every one of those five components.

**Interfaces:**
- Consumes: `tournament.logoUrl`/`tournament.accentColor` (Task 3's output, read here for the first time).
- Produces: nothing consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add `accentColor` to `MatchCard`**

Change (`ArcheryScorecard.jsx:3491-3498` and `3510`/`3516`):

```jsx
function MatchCard({ match, onOpen, focused }) {
  const playable = match.status === 'pending' || match.status === 'in_progress' || match.status === 'shootoff';
  const statusLabel = match.status === 'bye' ? 'Bye' : match.status === 'waiting' ? 'In attesa' :
    match.status === 'completed' ? 'Conclusa' : match.status === 'shootoff' ? 'Spareggio' : 'Da giocare';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? T.gold : T.border}`, opacity: match.status === 'waiting' ? 0.6 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
```

to:

```jsx
function MatchCard({ match, onOpen, focused, accentColor = T.gold }) {
  const playable = match.status === 'pending' || match.status === 'in_progress' || match.status === 'shootoff';
  const statusLabel = match.status === 'bye' ? 'Bye' : match.status === 'waiting' ? 'In attesa' :
    match.status === 'completed' ? 'Conclusa' : match.status === 'shootoff' ? 'Spareggio' : 'Da giocare';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? accentColor : T.border}`, opacity: match.status === 'waiting' ? 0.6 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
```

Then change both winner check-mark lines:

```jsx
        {match.winnerSlot === 'A' && <Check size={16} color={T.gold} />}
```
to
```jsx
        {match.winnerSlot === 'A' && <Check size={16} color={accentColor} />}
```

and

```jsx
        {match.winnerSlot === 'B' && <Check size={16} color={T.gold} />}
```
to
```jsx
        {match.winnerSlot === 'B' && <Check size={16} color={accentColor} />}
```

- [ ] **Step 2: Add `accentColor` to `CompactMatchCard`**

Change (`ArcheryScorecard.jsx:3551-3558`):

```jsx
function CompactMatchCard({ match, x, y, onOpen, focused }) {
  const playable = match.status === 'pending' || match.status === 'in_progress' || match.status === 'shootoff';
  const scored = match.status === 'completed' || match.status === 'in_progress' || match.status === 'shootoff';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="absolute rounded-xl px-2.5 py-1.5 flex flex-col justify-center gap-0.5 text-left"
      style={{ left: x, top: y, width: BRACKET_CARD_W, height: BRACKET_CARD_H,
        background: T.surface, border: `1px solid ${playable ? T.gold : T.border}`, opacity: match.status === 'waiting' ? 0.55 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
```

to:

```jsx
function CompactMatchCard({ match, x, y, onOpen, focused, accentColor = T.gold }) {
  const playable = match.status === 'pending' || match.status === 'in_progress' || match.status === 'shootoff';
  const scored = match.status === 'completed' || match.status === 'in_progress' || match.status === 'shootoff';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="absolute rounded-xl px-2.5 py-1.5 flex flex-col justify-center gap-0.5 text-left"
      style={{ left: x, top: y, width: BRACKET_CARD_W, height: BRACKET_CARD_H,
        background: T.surface, border: `1px solid ${playable ? accentColor : T.border}`, opacity: match.status === 'waiting' ? 0.55 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
```

- [ ] **Step 3: Add `accentColor` to `BracketTree`, forwarding it to `CompactMatchCard`**

Change the signature (`ArcheryScorecard.jsx:3571`):

```jsx
function BracketTree({ tournament, onOpenMatch, focusRef }) {
```
to
```jsx
function BracketTree({ tournament, onOpenMatch, focusRef, accentColor = T.gold }) {
```

Then change the `CompactMatchCard` call (`ArcheryScorecard.jsx:3610-3613`):

```jsx
            {round.map((m, i) => (
              <CompactMatchCard key={i} match={m} x={r * colWidth} y={centers[r][i] - BRACKET_CARD_H / 2 + BRACKET_Y_OFFSET}
                onOpen={() => onOpenMatch({ kind: 'round', roundIdx: r, matchIdx: i })}
                focused={refEquals(focusRef, { kind: 'round', roundIdx: r, matchIdx: i })} />
            ))}
```

to:

```jsx
            {round.map((m, i) => (
              <CompactMatchCard key={i} match={m} x={r * colWidth} y={centers[r][i] - BRACKET_CARD_H / 2 + BRACKET_Y_OFFSET}
                onOpen={() => onOpenMatch({ kind: 'round', roundIdx: r, matchIdx: i })}
                focused={refEquals(focusRef, { kind: 'round', roundIdx: r, matchIdx: i })} accentColor={accentColor} />
            ))}
```

- [ ] **Step 4: Add `accentColor` to `ThreeWayFinalCard`**

Change (`ArcheryScorecard.jsx:3625-3633` and `3643`):

```jsx
function ThreeWayFinalCard({ final, onOpen, focused }) {
  const playable = final.status === 'pending' || final.status === 'in_progress' || final.status === 'shootoff3' || final.status === 'runoff';
  const statusLabel = final.status === 'waiting' ? 'In attesa' : final.status === 'pending' ? 'Da giocare'
    : final.status === 'shootoff3' ? 'Spareggio per l’oro' : final.status === 'runoff' ? 'Spareggio 2°/3° posto'
    : final.status === 'completed' ? 'Conclusa' : 'In corso';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? T.gold : T.border}`, opacity: final.status === 'waiting' ? 0.6 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
```

to:

```jsx
function ThreeWayFinalCard({ final, onOpen, focused, accentColor = T.gold }) {
  const playable = final.status === 'pending' || final.status === 'in_progress' || final.status === 'shootoff3' || final.status === 'runoff';
  const statusLabel = final.status === 'waiting' ? 'In attesa' : final.status === 'pending' ? 'Da giocare'
    : final.status === 'shootoff3' ? 'Spareggio per l’oro' : final.status === 'runoff' ? 'Spareggio 2°/3° posto'
    : final.status === 'completed' ? 'Conclusa' : 'In corso';
  return (
    <button onClick={() => playable && onOpen()} disabled={!playable}
      className="w-full text-left rounded-2xl px-4 py-3 flex flex-col gap-2"
      style={{ background: T.surface, border: `1px solid ${playable ? accentColor : T.border}`, opacity: final.status === 'waiting' ? 0.6 : 1,
        boxShadow: focused ? `0 0 0 2px ${T.blue}` : undefined }}>
```

Then change:

```jsx
            {final.goldSlot === i && <Trophy size={14} color={T.gold} />}
```
to
```jsx
            {final.goldSlot === i && <Trophy size={14} color={accentColor} />}
```

- [ ] **Step 5: Add `accentColor` to `PodiumCard`**

Change (`ArcheryScorecard.jsx:3652-3659`):

```jsx
function PodiumCard({ podium }) {
  if (!podium || !podium.gold) return null;
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px solid ${T.gold}` }}>
      <div className="flex items-center gap-3">
        <Trophy color={T.gold} size={28} />
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: T.gold }}>Campione</div>
```

to:

```jsx
function PodiumCard({ podium, accentColor = T.gold }) {
  if (!podium || !podium.gold) return null;
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: T.surfaceAlt, border: `1px solid ${accentColor}` }}>
      <div className="flex items-center gap-3">
        <Trophy color={accentColor} size={28} />
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: accentColor }}>Campione</div>
```

- [ ] **Step 6: Wire `SharedTournamentScreen` to display the logo and pass `accentColor` everywhere**

Change (`ArcheryScorecard.jsx:3903-3922`, the top of the "ready" render through the `BracketTree` call):

```jsx
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
```

to:

```jsx
  const accentColor = tournament.accentColor || T.gold;

  return (
    <div className="min-h-screen w-full mx-auto px-4 pt-4 pb-12 flex flex-col gap-4" style={{ background: T.bg, color: T.text }}>
      <div className="flex items-center gap-2">
        {tournament.logoUrl && (
          <img src={tournament.logoUrl} alt="Logo del torneo" className="h-10 w-auto rounded-lg" style={{ background: T.surface }} />
        )}
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

      <PodiumCard podium={podium} accentColor={accentColor} />

      {tournament.rounds.length > 0 && <BracketTree tournament={tournament} onOpenMatch={() => {}} focusRef={null} accentColor={accentColor} />}
```

Then change the rest of the same render (`ArcheryScorecard.jsx:3924-3952`, every remaining `MatchCard`/`ThreeWayFinalCard` call in this component):

```jsx
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
```

to:

```jsx
      {tournament.finalFormat === 'standard' && tournament.thirdPlaceMatch && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold" style={{ color: T.textDim }}>Finale 3°/4° posto</div>
          <MatchCard match={tournament.thirdPlaceMatch} onOpen={() => {}} focused={false} accentColor={accentColor} />
        </div>
      )}

      {tournament.finalFormat === 'threeway' && fs && (
        <>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Preliminare 3°/4° posto</div>
            <MatchCard match={fs.prelim} onOpen={() => {}} focused={false} accentColor={accentColor} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm font-semibold" style={{ color: T.textDim }}>Finale a 3 — oro/argento/bronzo</div>
            <ThreeWayFinalCard final={fs.final} onOpen={() => {}} focused={false} accentColor={accentColor} />
          </div>
        </>
      )}

      {tournament.finalFormat === 'lancaster' && fs && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold" style={{ color: T.textDim }}>Finale Lancaster (per punteggio di qualifica)</div>
          <div className="flex flex-col gap-2">
            {fs.playIn && <MatchCard match={fs.playIn} onOpen={() => {}} focused={false} accentColor={accentColor} />}
            <MatchCard match={fs.match1} onOpen={() => {}} focused={false} accentColor={accentColor} />
            <MatchCard match={fs.match2} onOpen={() => {}} focused={false} accentColor={accentColor} />
            <MatchCard match={fs.match3} onOpen={() => {}} focused={false} accentColor={accentColor} />
          </div>
        </div>
      )}
```

- [ ] **Step 7: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully, ends with `Built site/dist/index.html (...)`.

- [ ] **Step 8: Live-verify in the browser**

1. In the authenticated tab, upload a colorful, high-contrast logo to a tournament that has at least one playable match (reuse Task 3's upload flow).
2. Confirm the organizer's own `BracketScreen` still shows plain gold everywhere except the new logo thumbnail — no accent change there.
3. Open that tournament's public spectator link (same technique as the sharing feature's own verification: read `activeTournament.shareToken` via the React fiber, or generate a fresh one if this tournament was never shared, then navigate to `?share=<token>` in a separate/incognito tab).
4. Confirm on the public page: the logo appears in the header, and gold accents (podium border/trophy, playable match card borders, winner checkmarks) now show the extracted color instead.
5. Screenshot both views side by side for the record.

- [ ] **Step 9: Commit**

```bash
git add ArcheryScorecard.jsx
git commit -m "Thread accentColor through bracket components for the public page"
```

---

### Task 5: Document in README and push

**Files:**
- Modify: `README.md` — append a new `## v1.13 additions` section after the existing `## v1.12 additions` section (end of file).

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (final task).

- [ ] **Step 1: Add the README section**

Append to the end of `README.md`:

```markdown

## v1.13 additions — Tournament logo + accent color

- **Logo upload**: a "Carica logo" control on the bracket screen lets an
  organizer upload an image for a tournament, shown on both the organizer's
  own bracket screen and the public spectator page. Stored in a new public
  Supabase Storage bucket (`tournament-logos`, `supabase/schema.sql`) at a
  fixed `{user_id}/{tournament_id}.png` path — writes are locked to the
  owner's own folder via a Storage RLS policy, reads are public (a plain
  URL, no auth check), which is appropriate here since a logo isn't
  sensitive the way bracket/score data is. Resized client-side (canvas,
  max 512px edge) before upload, so every stored file stays small
  regardless of the original.
- **Public-page accent color**: uploading a logo extracts a representative
  color from it (`extractAccentColor()` — averages only the "colorful"
  pixels, filtering out near-white/near-black/low-saturation ones a plain
  average would get dragged toward) and, if that color clears a WCAG 3:1
  contrast check against the page's dark background, swaps it in for gold
  across the public spectator page's podium, match cards, and winner
  markers (`MatchCard`/`CompactMatchCard`/`BracketTree`/
  `ThreeWayFinalCard`/`PodiumCard` all gained an optional `accentColor`
  prop, defaulting to the normal gold — the organizer's own screen never
  passes it, so it looks exactly as it always has). A logo whose color
  fails the contrast check, or that has none, falls back to gold rather
  than rendering something unreadable.
```

- [ ] **Step 2: Verify the build stays clean**

Run: `npm run build`
Expected: exits successfully (README changes don't affect the build, but this confirms nothing else broke since Task 4).

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "Document v1.13 tournament logo + accent color in README"
git push
```

- [ ] **Step 4: Confirm the push landed**

Run: `git log --oneline -8` and `git status`
Expected: the commits from this plan appear at the top of the log, and `git status` reports the branch is up to date with its remote (no unpushed commits).
