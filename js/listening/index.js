// The listening section, booted.
//
// Two shapes. The About page has only the corner -- a title, Play, Enter, and a
// live track name. The Lounge has the whole room. Both read from one
// /api/lately call.
//
// Everything is additive: without JavaScript the pages are exactly the site
// they were before, because the markup these fill is empty in the HTML.
//
// The quiet toggle is gone. It came from the brief, which asked for a mode with
// no sound controls at all -- written before there was a player. Pause, the
// close button, and simply not pressing play now all do that job, and it was
// occupying the top-right of the room.

import { render as renderLately, playAll, firstTrack, LABEL } from './lately.js';
import { render as renderAnchor } from './anchor.js';
import { renderStanding } from './standing.js';
import { playFrom } from './track.js';
import { startMarquee } from './marquee.js';
import { renderTicker, startTicker } from './ticker.js';
import { renderQueue, applyMarks } from './queue.js';
import { mountLeave } from './leave.js';
import { icon } from '../icons.js';
import { mountPlayerBar } from '../player/bar.js';
import * as player from '../player/engine.js';

// The queue is a second endpoint rather than a field on /api/lately, because
// the two have different lifetimes and different honesty rules -- see the
// header of api/queue.js.
async function fetchQueue() {
	try {
		const res = await fetch('/api/queue');
		return res.ok ? await res.json() : { off: true, songs: [], marks: [] };
	} catch {
		return { off: true, songs: [], marks: [] };
	}
}

async function fetchLately() {
	try {
		const res = await fetch('/api/lately');
		return res.ok ? await res.json() : { recent: [] };
	} catch {
		return { recent: [] };
	}
}

function syncPlayLabel(btn, iconSel, textSel, size) {
	const mark = () => {
		const playing = player.playState() === 'playing';
		btn.querySelector(iconSel).innerHTML = playing ? icon.pause(size) : icon.play(size);
		const t = btn.querySelector(textSel);
		if (t) t.textContent = playing ? 'Pause' : 'Play';
	};
	player.subscribe(reason => { if (reason !== 'progress') mark(); });
	mark();
}

// The corner on the About page. Play starts the track the corner NAMES -- it
// used to open with the pinned song while the label beside it showed the most
// recent listen, so pressing play started something other than what it said.
function bootCorner(standing, payload) {
	renderStanding(standing, payload);
	startMarquee(standing.querySelector('.marquee'));

	const btn = document.querySelector('[data-play]');
	if (!btn) return;

	btn.addEventListener('click', () => {
		if (player.playState() !== 'idle') return player.togglePlay();
		const items = [payload.nowPlaying, ...(payload.recent ?? [])].filter(Boolean);
		if (items.length) playFrom(items, 0, LABEL);
	});

	btn.querySelector('.corner-icon').innerHTML = icon.play(10);
	syncPlayLabel(btn, '.corner-icon', '.corner-label', 10);
	// Named so it is obvious what pressing it starts.
	btn.title = firstTrack(payload)
		? `Play ${firstTrack(payload).artist} — ${firstTrack(payload).track}`
		: 'Play';
}

export async function boot() {
	const root = document.querySelector('[data-listening]');
	const standing = document.querySelector('.standing-listening');
	const ticker = document.querySelector('[data-ticker]');
	if (!root && !standing && !ticker) return;

	// Portfolio has neither the room nor the corner, only the ticker, and the
	// early return used to send it away empty-handed.
	if (!root) {
		const payload = await fetchLately();
		startTicker(renderTicker(payload));
		if (standing) bootCorner(standing, payload);
		return;
	}

	root.innerHTML = `<div class="room">
			<div class="room-main">
				<div class="room-head">
					<h1>Recent listens</h1>
					<button class="play-all" type="button">
						<span class="play-all-icon">${icon.play(16)}</span><span class="play-all-text">Play</span>
					</button>
				</div>
				<div class="lately"><p class="listening-empty">Finding out&hellip;</p></div>
			</div>
			<aside class="room-side">
				<div class="pin" hidden></div>
				<section class="queue" hidden></section>
				<div class="leave-host" hidden></div>
			</aside>
		</div>`;

	const playAllBtn = root.querySelector('.play-all');
	const latelyEl = root.querySelector('.lately');
	let payload = null;

	playAllBtn.addEventListener('click', () => {
		if (player.playState() !== 'idle') return player.togglePlay();
		if (payload) playAll(payload);
	});
	syncPlayLabel(playAllBtn, '.play-all-icon', '.play-all-text', 16);

	renderAnchor(root.querySelector('.pin'));

	const queueEl = root.querySelector('.queue');
	const leaveHost = root.querySelector('.leave-host');

	// Both lists come from one round of fetching. The queue's GET also
	// reconciles plays against Edwin's scrobbles, so it has to land before the
	// log is marked up.
	const [lately, queue] = await Promise.all([fetchLately(), fetchQueue()]);
	payload = lately;
	renderLately(latelyEl, payload);

	const paintQueue = q => {
		renderQueue(queueEl, q);
		applyMarks(latelyEl, q?.marks);
		const toggle = mountLeave(leaveHost, q?.emoji, async () => {
			// Re-read rather than splicing the new song in locally: the server
			// decides ordering, and a page that guessed would disagree with the
			// next visitor's view of the same queue.
			paintQueue(await fetchQueue());
		});
		queueEl.querySelector('[data-leave]')?.addEventListener('click', () => toggle?.());
	};
	paintQueue(queue);
	// Called on the Lounge too, where it hides itself: the host lives at <body>
	// level and therefore survives the soft navigation that brought us here.
	startTicker(renderTicker(payload));
	mountPlayerBar();
}
