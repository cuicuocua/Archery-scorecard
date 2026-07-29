# Tournament logo + accent color

Lets a tournament organizer upload a logo image for a tournament. The logo
shows on both the organizer's `BracketScreen` and the public
`SharedTournamentScreen`; on the public page only, a color extracted from
the logo replaces the app's usual gold accent, so a shared link can carry
a little of the club/event's own identity without touching the app's
normal look everywhere else.

---

## Current behavior

Tournaments have no image of any kind. There is no file-upload UI
anywhere in the app (the closest precedent, `ImportButton`, reads a JSON
file via `FileReader.readAsText` — a pattern to follow for the file-picker
interaction, not for image handling). No Supabase Storage bucket exists;
the app only uses two Postgres tables (`sessions`, `tournaments`), both
image-free JSONB blobs.

## New behavior

### Storage — a public bucket, not a token-gated function

A new Supabase Storage bucket, `tournament-logos`, created as **public**
(Storage's built-in "public bucket" flag — objects serve via a plain URL
with no auth check on read, no RLS query involved at all). This is a
simpler security case than the tournament-sharing link's RPC-only design:
a logo isn't sensitive the way bracket/score data is, so there's no need
for that design's token-indirection to prevent enumeration. Write access
is scoped with an ordinary Storage RLS policy: an authenticated user may
insert/update/delete only within a folder path prefixed by their own
`auth.uid()` (`{user_id}/{filename}`), checked via
`storage.foldername(name)`. Anyone can read anything in the bucket —
that's the point, since the public spectator page has no session at all.

### Upload — client-side resize, no server processing

**`LogoUpload` control**, added to `BracketScreen` as a new collapsed
panel (same idiom as `ShareTournamentControl`/`ResetTournamentButton`).
Picking a file:
1. Rejects anything whose MIME type isn't `image/png`, `image/jpeg`, or
   `image/webp` (no SVG — rasterizing an uploaded SVG for color
   extraction is extra complexity, and user-supplied SVG carries its own
   script-injection risk that a public bucket serving it as-is would
   otherwise inherit).
2. Draws the image to an offscreen canvas, downscaled so its longer edge
   is at most 512px (a logo never needs to be bigger than that on
   screen), and re-encodes it as PNG — always PNG, never JPEG, since a
   logo is shown against this app's dark background and needs to keep
   its transparency rather than get flattened onto a solid matte. At
   this resolution, and given logos are typically flat-color rather than
   photographic, PNG output stays small (tens of KB) regardless of the
   source format — the resize step alone handles the "keep uploads small
   on a free-tier project" goal.
3. Runs color extraction (below) against that same downscaled canvas —
   no separate fetch or reprocessing step.
4. Uploads the resulting PNG blob to
   `tournament-logos/{user_id}/{tournament_id}.png` (fixed filename per
   tournament — re-uploading overwrites in place, so there's no
   orphaned-file cleanup to worry about), then saves the
   resulting public URL and extracted color onto the tournament via the
   existing `updateTournament()` path — same as `shareToken`, these are
   just new fields (`logoUrl`, `accentColor`) inside the existing `data`
   JSON blob, no schema migration.
5. A "Rimuovi logo" action (visible once a logo exists) clears both
   fields and deletes the Storage object.

### Color extraction — filtered average, not a library

Against the same downscaled canvas used for the resize: read every
pixel, convert to HSL, discard anything too close to white, black, or
gray (low saturation, or lightness near either extreme — these are the
pixels a plain average would get dragged toward, usually a logo's
background rather than its actual mark), then average the RGB of
whatever's left. No new dependency — this is plain `canvas.getImageData`
and arithmetic, small enough to sit next to `LogoUpload` itself.

The result is checked against **WCAG contrast** for `T.bg` (`#14161A`)
using the standard relative-luminance formula. If the ratio is below 3:1
(the threshold for a large/decorative accent, not body text), the stored
`accentColor` is left `null` and the public page falls back to the
existing `T.gold` — this check runs once at upload time, not on every
page load, so a logo that produces a low-contrast color simply never
gets an `accentColor` written at all rather than silently rendering
something unreadable.

### Rendering

- **`BracketScreen`**: shows the logo (if present) near the header,
  alongside the `LogoUpload` control. No color re-theming here — this
  screen's styling is unchanged, per the earlier decision to keep the
  organizer's own view exactly as it looks today.
- **`SharedTournamentScreen`**: shows the logo in its header. Every
  `T.gold` reference in this component's own JSX (podium trophy, winner
  highlight, focused-match ring, etc. — this screen only, not
  `BracketTree`/`MatchCard`/`PodiumCard`, which are shared with the
  organizer view and must stay visually identical there) becomes
  `tournament.accentColor || T.gold`.

## Edge cases

- **No logo uploaded**: both screens render exactly as they do today —
  no header change, no color change. This is the default/most common
  case and must add zero visual difference.
- **Logo uploaded but extraction fails contrast**: `accentColor` stays
  `null`; the logo still displays, the public page's accents stay gold.
- **Re-uploading a new logo**: overwrites the same Storage path and the
  same `data` fields — no stale copies left in the bucket, no dangling
  reference if upload fails partway (the tournament's `logoUrl` is only
  updated after the Storage upload itself succeeds).
- **Upload fails (network, storage error)**: same "surface it, don't
  fail silently" convention this app already uses for save errors
  (`flagSaveError`) — an inline error message in the `LogoUpload` panel,
  the tournament's existing `logoUrl`/`accentColor` (if any) untouched.
- **Non-image or oversized file selected**: rejected client-side before
  any upload attempt, with an inline message — same spirit as
  `ImportButton`'s "File non valido" handling.
- **Tournament shared before this feature, no logo**: `logoUrl`/
  `accentColor` are simply absent from `data`, exactly like `shareToken`
  on tournaments predating that feature — no migration, every read site
  already treats a missing field as "off."

## Testing notes

No test framework in this repo — manual verification via `npm run build`
and the browser preview. Specifically verify: uploading a real logo image
shows it on both screens, the public page's gold accents visibly change
to a color plausibly drawn from that logo, a solid-color test image
produces a sensible extracted color, a low-contrast (e.g. very light
pastel) logo correctly falls back to gold instead of extraction, removing
a logo clears it from both screens and deletes the Storage object, and a
non-image file is rejected with a clear message instead of attempting an
upload.
