// The listening section, booted.
//
// Two shapes. The About page has only the corner -- a title, Play, Enter, and a
// live track name. The Lounge has the whole room. Both read from one
// /api/lately call.
//
// Everything is additive: without JavaScript the pages are exactly the site
// they were before, because the markup these fill is empty in the HTML.
//
// There is deliberately no "enter with sound" gate. The brief asked for one,
// but the same brief says the professional layer must never sit behind sound,
// and a curtain in front of a portfolio breaks that. Quiet is a toggle inside
// the room instead, and nothing ever plays unasked either way.

import { render as renderLately, playAll } from './lately.js';
import { render as renderAnchor, loadAnchor } from './anchor.js';
import { renderStanding } from './standing.js';
import { playFrom } from './track.js';
import { startMarquee } from './marquee.js';
import { mountPlayerBar, unmountPlayerBar } from '../player/bar.js';
import * as player from '../player/engine.js';

const QUIET_KEY = 'eh.quiet';

// Per session, not forever. A preference this small should not outlive the
// visit, and sessionStorage throws in some privacy modes -- hence the guards.
function readQuiet() {
	try { return sessionStorage.getItem(QUIET_KEY) === '1'; } catch { return false; }
}
function writeQuiet(on) {
	try { sessionStorage.setItem(QUIET_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

async function fetchLately() {
	try {
		const res = await fetch('/api/lately');
		return res.ok ? await res.json() : { recent: [] };
	} catch {
		return { recent: [] };
	}
}

function syncPlayLabel(btn, iconSel, textSel) {
	const mark = () => {
		const playing = player.playState() === 'playing';
		btn.querySelector(iconSel).innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
		btn.querySelector(textSel).textContent = playing ? 'Pause' : 'Play';
	};
	player.subscribe(reason => { if (reason !== 'progress') mark(); });
	mark();
}

// The corner on the About page. Play opens with the anthem and then rolls into
// recent listens, so the button always starts with the track Edwin chose rather
// than whatever happened to be on last night.
async function bootCorner(standing) {
	const payload = await fetchLately();
	renderStanding(standing, payload);
	startMarquee(standing.querySelector('.marquee'));

	const btn = document.querySelector('[data-play]');
	if (!btn) return;

	btn.addEventListener('click', async () => {
		if (player.playState() !== 'idle') return player.togglePlay();
		const anchor = await loadAnchor();
		const items = [anchor, payload.nowPlaying, ...(payload.recent ?? [])].filter(Boolean);
		if (items.length) playFrom(items, 0, 'Lately');
	});

	syncPlayLabel(btn, '.corner-icon', '.corner-label');
}

export async function boot() {
	const root = document.querySelector('[data-listening]');
	const standing = document.querySelector('.standing-listening');
	if (!root && !standing) return;
	if (!root) return bootCorner(standing);

	let quiet = readQuiet();
	const getQuiet = () => quiet;

	root.innerHTML = `<div class="listening-head">
			<h1>Lately</h1>
			<button class="quiet-toggle" type="button"></button>
		</div>
		<div class="listening">
			<button class="play-all" type="button"><span class="play-all-icon" aria-hidden="true">&#9654;</span><span class="play-all-text">Play</span></button>
			<div class="anchor" hidden></div>
			<div class="lately"><p class="listening-empty">Finding out&hellip;</p></div>
		</div>`;

	const toggle = root.querySelector('.quiet-toggle');
	const playAllBtn = root.querySelector('.play-all');
	const latelyEl = root.querySelector('.lately');
	const anchorEl = root.querySelector('.anchor');

	let payload = null;

	function paint() {
		toggle.textContent = quiet ? 'sound off' : 'quiet';
		toggle.setAttribute('aria-label', quiet ? 'Turn sound controls back on' : 'Hide all sound controls');
		playAllBtn.hidden = quiet;
		if (payload) renderLately(latelyEl, payload, getQuiet);
		renderAnchor(anchorEl, getQuiet);
	}

	toggle.addEventListener('click', () => {
		quiet = !quiet;
		writeQuiet(quiet);
		// Quiet means no transport at all, and it stops what is playing.
		if (quiet) unmountPlayerBar();
		else mountPlayerBar();
		paint();
	});

	playAllBtn.addEventListener('click', () => {
		if (player.playState() !== 'idle') return player.togglePlay();
		if (payload) playAll(payload);
	});
	syncPlayLabel(playAllBtn, '.play-all-icon', '.play-all-text');

	paint();
	payload = await fetchLately();
	renderLately(latelyEl, payload, getQuiet);
}
