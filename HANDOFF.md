# edwinhidalgo.com — handoff

Read this first, then `git status`, `git log -20`, and `node test/run.mjs`.
This repo is **public**: nothing secret or private goes in this file or any commit.
It is excluded from deploys by `.vercelignore`, so it is never served from the domain.

Edwin works one step at a time and authorizes each with a literal **"go"**. Use judgment
inside a step; never chain steps; flag a decision you think is wrong rather than quietly
redoing it.

## OPEN ITEMS

Every ask gets a row when it arrives; every round ends by reconciling this table,
including asks that are deliberately not being done.

| # | Item | Raised | Status |
|---|---|---|---|
| 1 | Projects tab: update the ekos card exactly per `~/Documents/verified-fan-app/PORTFOLIO-EKOS-CARD.md`, **draft A**; do not edit the ekos repo | 2026-10-01 | **done 2026-10-01**: archive link, "· World Build 3 hackathon", draft A verbatim (string-compared against the doc). The ekos repo is untouched; report back via Edwin |
| 2 | Projects tab: add **app34** (app34.app) **below MyMusicMemory, above Glue**. Role "Making apps out of memes"; summary approved 2026-10-01 | 2026-10-01 | **done 2026-10-01**: logo is app34's own `icon.png` as `img/portfolio/logo-app34.png`. First shipped after Glue (misread); Edwin corrected the placement the same day |
| 3 | A local tool to hide a visitor song (`tools/song.mjs list / hide / unhide`), using the `hidden` flag `api/queue.js` already honours | 2026-10-01 | **done 2026-10-01**: 13 tests plus a sabotage check, and a live end-to-end cycle on production with a throwaway song. Edwin says "hide the song by X"; the agent runs `list`, then `hide <id>` |
| 10 | `api/queue.js` reconcile rewrote **every** played song whenever a new play matched, using whatever `listSongs()` had just read. A song hidden in the last ~minute could read back stale and be saved un-hidden, and every new match cost a Blob write per played song | 2026-10-01 | **done 2026-10-01**: `newlyPlayed()` saves only the songs `reconcile` changed (identity test). 4 tests plus a sabotage check. The live write path runs only when Edwin plays a song someone left, so it is first exercised by a real play. Residual: a song hidden within a minute AND played by Edwin in that same minute could still read stale |
| 11 | A link-preview (OG) card with Edwin's main picture | 2026-10-01 | **done 2026-10-01**: option B (the photo is the card; the name sits on the wall; edwinhidalgo.com in petrol; his own bio line). Chosen over text-left/photo-right because square-cropping apps cut that one at the seam. No live data on it, since previews are cached for days. `img/og.jpg` (181 KB) is made by `tools/og/card.html`; every page carries og:/twitter: tags with its own title and description |
| 12 | Five unused photos from the old site were still served from the domain; `img/edwin.jpg` (2019) carried a **GPS location** | 2026-10-01 | **done 2026-10-01**: deleted from `listening-room` (`edwin.jpg`, `edwin2.jpeg`, `blueno.jpg`, `winter.jpg`, `hi.jpg`). A test now fails if any JPEG in the repo carries GPS |
| 13 | Those photos, `edwin.jpg` with its GPS included, remain in the **public repo's git history** and on `master` (reachable via raw.githubusercontent.com) | 2026-10-01 | **Edwin's call.** Removing them fully means rewriting history and force-pushing every branch; the domain no longer serves them |
| 4 | Group recent listens by day ("Today · 44 tracks · 8:18am–8:06pm") | 2026-09-25 | optional, not started. Session grouping was rejected: labels repeat ("This evening" twice) |
| 5 | Vendor `particles.min.js` instead of jsDelivr | 2026-09-24 | offered, undecided. Edwin saw the dots vanish on his phone once; not reproducible |
| 6 | Move DNS to Vercel's newer records (two apex A records + a project-specific CNAME) | 2026-09-24 | optional, Edwin's. Current records work |
| 7 | Dependabot alert #5 (jQuery 3.2.1) | 2026-09-24 | stale: the file is gone from every branch. Dismiss on GitHub |
| 8 | Delete the abandoned duplicate scaffold at `~/Documents/edwinhidalgo-com` (outside this repo; it holds a local `.env`) | 2026-09-23 | Edwin hasn't answered |
| 9 | Photos joined to listening (EXIF), and "hear this image" via everything hums | 2026-09-21 | **backlogged by Edwin** 2026-09-25 |

Closed recently:

- Vercel's production branch was the orphan `main`; Edwin switched it to `listening-room`
  on 2026-10-01.
- Colourway taste test dropped: deep petrol stays (2026-10-01).
- The 138px mobile player bar stays (2026-10-01).
- No notes on visitor songs for now (2026-10-01).
- The unused downloads (ONUS screenshots, elephant, Sleeping Shaq) are ignored (2026-10-01).

## What this is

Edwin's personal site, extended into a listening room. Three pages:

- **About** (`index.html`): bio, hover photographs on desktop, a tap modal on touch.
- **Portfolio** (`portfolio.html`): Career / Advisory / Projects tabs.
- **Lounge** (`lounge.html`):
  - a pinned song with a note
  - recent listens (last 100 scrobbles)
  - top artists and tracks (7 days / 30 days / all time)
  - songs left by visitors

A player bar persists across all three, and a ticker of recent tracks runs across the top.

## Deploying

- **Vercel project `edwinhidalgo`.** The production branch is `listening-room`. **A push to
  `listening-room` is a production deploy.** Other branches get preview URLs.
- Branches:
  - `master` is the pre-September GitHub Pages site. GitHub Pages still builds it, which is
    harmless because DNS points at Vercel. It is the rollback.
  - `main` is an orphan with one empty commit. Never push to it.
- **DNS (Namecheap):** apex `A 76.76.21.21`, `www CNAME cname.vercel-dns.com.`; the apex
  308s to `www`. Email forwarding lives under Mail Settings: never touch it. Rollback is
  putting the four GitHub Pages `185.199.10x.153` A records back.
- **Env var names:**
  - `LASTFM_API_KEY`, `LASTFM_USER`
  - `BLOB_READ_WRITE_TOKEN`
  - kill switches: `LISTENING_PAUSED=1` (site stops talking about listening) and
    `GUEST_SONGS_ENABLED=0` (queue off)
  - locally in `.env` / `.env.local`, both gitignored. Values never go in commits or chat
    output.
- **Local:** `node tools/serve.mjs` serves http://localhost:4321 with `/api/*` routed to the
  handlers.
- **Always verify on production after a ship**, not only on localhost.

## Architecture

Plain ES modules, no build step. The front end has zero dependencies; the only package is
`@vercel/blob`, server-side.

| Area | Files |
|---|---|
| Entry | `js/site.js` boots every page. `js/nav.js` intercepts internal links and swaps `.content` (pushState), so audio survives page changes. Anything bound on load must re-run from `initPage()` |
| Player | `js/player/engine.js`: a faithful port of Onus's `previewPlayer.ts` (`playFromList`, `playAllLazy` lookahead pump with a `runId` guard; `ended`, `error` and a rejected `play()` all advance). `js/player/bar.js`: the bar; `×` dismisses for real. `js/icons.js`: SVG transport icons |
| Listening | `js/listening/`: `index.js` (boot), `lately.js` (recent list), `track.js` (scrobble → playable; per-row keys), `anchor.js` (pinned song, from `data/anchor.json`), `top.js`, `queue.js` + `leave.js` (visitor songs), `ticker.js`, `standing.js` (live line under the About page's Lounge link), `marquee.js`, `format.js`, `links.js` |
| Photos | `js/hover.js` (desktop ≥1351px, portrait up by default), `js/photo-modal.js` (touch) |
| API | `api/lately.js` (Last.fm recent, 30s cache, key server-side), `api/top.js`, `api/resolve.js` + `api/search.js` (iTunes Search: exact match first, limit 25, explicit dropped), `api/queue.js` (GET reconciles plays; POST leaves a song), shared `_lastfm.js`, `_itunes.js`, `_fold.js`, `_store.js` |
| Store | Vercel Blob, public. `songs/<ts>-<id>.json` is the truth, one blob per song. `queue.json` is a derived view rebuilt only on a write. `throttle/<day>/<hash>` is an atomic one-per-visitor-per-day claim |
| Tools (local only, never deployed) | `tools/serve.mjs`: dev server. `tools/og/card.html` + `portrait.jpg`: the link-preview card, regenerated into `img/og.jpg` with headless Chrome (command in the file). `tools/song.mjs`: `list`, `hide <id>`, `unhide <id>` for visitor songs. It reads `BLOB_READ_WRITE_TOKEN` from `.env.local` and keeps the blob, so hiding is always reversible. It retries the rebuild until the view has seen the change |
| Tests | `test/run.mjs`: API states, the player state machine against a fake audio element, fold matching, hiding a song |

## Invariants (measured; keep them true)

- At 1512×863, About and Lounge fit exactly: `scrollHeight === innerHeight`.
- `.content` top reports **one value** per page across every fresh load and soft
  navigation, at both widths. Offsets come from CSS keyed on the page's own body class,
  never from JS after a fetch.
- The player bar's footprint is reserved permanently, so page height is identical with
  the bar up or down.
- No secret appears in any served file (grep the live HTML and JS).
- No autoplay. Audio starts only on a tap, straight from Apple; nothing is proxied or
  rehosted.
- Every page reads with JS off.
- No U+25B6 / U+25C0 glyphs (they render as emoji on iOS); use `js/icons.js`.
- No horizontal overflow at 390px. Tap targets ≥44px; form inputs 16px (iOS zoom).
- Ticker artwork follows the **pointer** (touch shows it, mouse never), not the width.
  12px type everywhere; only the speed changes (28 px/s desktop, 45 phone).
- Both Lounge lists share `.trk` markup and grid, so their columns line up by construction.
- `node test/run.mjs` passes (82 as of 2026-10-01).
- Every page carries a complete link-preview card (og:title/description/url/image, twitter:card), and
  `img/og.jpg` stays under 300 KB (WhatsApp drops larger ones). Tested.
- No photograph in the repo carries a GPS location. Strip it before adding any photo. Tested.
- A hidden song appears nowhere on the page: not in the queue, and not as a "from" mark in the log.

## Decision record

- **2026-09-21.** Music first, photos later. Last.fm is the only listening source (key
  only, non-commercial terms). Odesli's public API is retired (`401
  PUBLIC_API_ACCESS_DEPRECATED`), so tracks resolve through iTunes Search plus honest
  search links. A link is marked `exact` only when it really is.
- **2026-09-23.** Extend the existing site, not a new one. Three pages; the Lounge reached
  from the About page's bottom-right corner. Accent deep petrol `#2C5A6B` (7.23:1); coral
  failed contrast. Hover photos are GPS-stripped and resized.
- **2026-09-24.**
  - Shipped; DNS moved to Vercel.
  - Play starts from the track the corner names, not the pinned song.
  - "Last played" vs "listening now" decided by the `nowplaying` flag plus freshness.
  - Pinned song: Charli xcx, "No One Lasts Forever", note "Time is precious."
  - The ticker is chrome at body level.
- **2026-09-24, guest songs.**
  - On Vercel Blob instead of Supabase: zero setup for Edwin, one server-side dependency.
  - One read-modify-write `queue.json` lost a real submission (public-store ETags don't
    describe stale reads). Hence a blob per song plus a derived view.
  - Visitors search and pick; the server re-looks-up the Apple ID. Explicit tracks are
    refused, the signature is ≤3 letters, the emoji picker was removed.
  - Unmoderated, rate-limited to one per visitor per day.
  - A played song shows "✓ played" in the queue and "← from XX" in the log.
- **2026-09-25.**
  - Top artists and tracks added.
  - Lounge layout: Pinned + Top on the left, Recent + visitor songs on the right; no
    footer on the Lounge.
  - Session grouping rejected.
  - Photos backlogged.
- **2026-10-01.**
  - Production branch → `listening-room`.
  - app34 added to Projects between MyMusicMemory and Glue; ekos card pointed at the
    hackathon archive.
  - Colours, mobile bar and "no notes" settled.
  - Link-preview card: photo-led (option B), with no live data on it.
  - The five unused old photos are off the domain; scrubbing git history is left to Edwin.

## Traps already paid for

- `css/style.css` sets `h1, h2, p { width: 80%; max-width: 600px }`. Any new heading or
  paragraph outside the text column inherits it (it bit the Lounge corner and `.nav-row`).
- `nav.js` replaces `.content` and copies the body class. Runtime classes must be
  preserved, and listeners re-bound (the portfolio tabs once died this way).
- An `<img>` with `top: 0; bottom: 0; height: auto` resolves to its intrinsic height. Use
  `height: 100%`.
- `vh` ignores browser zoom while `px` text scales.
- Headless Chrome cannot play audio (`error@0.02`). It exercises the error path, not
  `ended`; audible playback needs a human.
- CDP sessions can cache CSS and report stale measurements: disable the cache. Headless
  has a 500px minimum width unless device metrics are overridden.
- Blob `list()` is an Advanced Operation (2,000/month on Hobby). List only on writes, never
  per request.
- An overwritten blob can read back stale from the CDN for up to a minute. Anything that
  writes and then rebuilds must check the rebuild saw the write (see `tools/song.mjs`),
  and nothing should write back a copy it did not change (see `newlyPlayed`, item 10).
- Removing a visitor song in the Vercel dashboard does not take it off the page. The page
  reads `queue.json`, and deleting that too empties the list. Use `tools/song.mjs`.
- Apple search rate-limits around 20 calls a minute per address. The picker debounces
  350ms and caches an hour at the edge.
- A heredoc once wrote literal NUL bytes into source. `grep -P '\x00'` before committing
  generated files.
- The private `CAREER-AND-PORTFOLIO.md` is never a source for public copy. Project text
  comes from Edwin.

## Where history lives

- Original brief: `~/Downloads/WEBSITE-KICKOFF.md`.
- Build transcript (Sep 21–26):
  `~/.claude/projects/-Users-edwinhidalgo-Documents-everything-hums/b32a57cf-5324-450a-98f3-2dcca6f1c431.jsonl`.
  Portfolio chats open from the everything-hums folder.
- Plan files: `~/.claude/plans/read-website-kickoff-md-in-downloads-concurrent-ritchie.md`
  (Lounge layout) and `~/.claude/plans/i-m-picking-up-my-elegant-wand.md` (2026-10-01
  steps).
