// The ticker across the top, on phones.
//
// This began as a single static line inside .content, which put it 84px down
// the page -- far enough in to compete with the bio for attention while being
// too small to win. It is chrome, not content, so it now lives at the top of
// <body> and is pinned to the top of the viewport: the page scrolls under it,
// the way the strip across a trading terminal does.
//
// It also never moved. The old version borrowed the corner's marquee, which
// only drifts when the text overflows its box -- one track name in a 139px
// window measured 128px, so the drift class was never applied and the line just
// sat there. A ticker is a different thing from a drifting label, so it has its
// own mechanism here and js/listening/marquee.js is left alone for the corner,
// where park-and-return is still the right motion for a single title.
//
// The belt carries the run TWICE and translates by exactly -50%, which is what
// makes the wrap seamless: at the moment the animation restarts, the second
// copy is sitting precisely where the first one began. The duplicate is
// aria-hidden so the line is not announced twice.
//
// It hides itself when there is nothing TRUE to say -- Edwin has gone dark, his
// listening is private, or the fetch failed. Not merely when nothing is
// playing: in that case there is still a most recent track, and it says so with
// an honest relative time.

import { isLive, timeAgoShort, esc } from './format.js';

// How many recent tracks ride behind the lede. Enough that the belt is
// comfortably longer than a phone screen, so the loop reads as continuous
// rather than as one line being dragged past.
const ITEMS = 8;

// Pixels per second. Slow enough to read a title as it goes by.
const SPEED = 45;

// Last.fm hands /api/lately the 300x300 image, which is 14KB for a square drawn
// at 20. The CDN serves a 64s variant of the same hash at 1.6KB -- verified
// against the live host, not assumed -- so nine thumbnails cost about 15KB
// rather than 126KB. If the path ever stops matching, the original URL is
// returned untouched and the bar degrades to heavy images rather than broken
// ones.
function thumb(url) {
	return String(url || '').replace(/\/i\/u\/\d+x\d+\//, '/i/u/64s/');
}

function art(track) {
	// A track with no artwork still gets a box of the same size. Collapsing it
	// would break the image-text-image rhythm that makes the belt scannable,
	// which is the entire reason the artwork is here.
	if (!track.art) return `<span class="ticker-art is-empty" aria-hidden="true"></span>`;
	return `<img class="ticker-art" src="${esc(thumb(track.art))}" alt="" width="20" height="20">`;
}

function item(track, cls = '') {
	const when = track.playedAt ? `<span class="ticker-when">${esc(timeAgoShort(track.playedAt))}</span>` : '';
	return `<span class="ticker-item ${cls}">${art(track)}
		<span class="ticker-artist">${esc(track.artist)}</span>
		<span class="ticker-track">${esc(track.track)}</span>${when}
	</span>`;
}

function run(payload, live, head, rest) {
	const lede = live
		? `<span class="ticker-item ticker-lede"><span class="live-dot is-live"></span>listening now</span>`
		: `<span class="ticker-item ticker-lede">last played${head.playedAt ? ` ${esc(timeAgoShort(head.playedAt))}` : ''}</span>`;
	return lede + item(head, 'is-head') + rest.map(t => item(t)).join('');
}

export function renderTicker(payload) {
	const host = document.querySelector('[data-ticker]');
	if (!host) return;

	const hide = () => {
		host.hidden = true;
		host.innerHTML = '';
	};

	// The Lounge is the room itself, and a ticker there would say in one moving
	// line what the page already shows in full. The host sits at <body> level
	// and so survives a soft navigation into the Lounge, which means it has to
	// be actively hidden rather than merely absent from that page.
	if (document.body.classList.contains('page-lounge')) return hide();

	if (payload?.paused || payload?.private) return hide(); // nothing true to say
	const live = isLive(payload);
	const head = payload?.nowPlaying ?? payload?.recent?.[0];
	if (!head) return hide();

	// The head track is the lede's subject, so the tail starts after it.
	const recent = payload?.recent ?? [];
	const rest = (payload?.nowPlaying ? recent : recent.slice(1)).slice(0, ITEMS);
	const belt = run(payload, live, head, rest);

	host.innerHTML = `<a class="ticker" href="lounge.html"
			aria-label="${live ? 'Listening now' : 'Last played'}: ${esc(head.artist)} &mdash; ${esc(head.track)}. Open the Lounge.">
			<span class="ticker-viewport">
				<span class="ticker-belt">
					<span class="ticker-run">${belt}</span>
					<span class="ticker-run" aria-hidden="true">${belt}</span>
				</span>
			</span>
		</a>`;
	host.hidden = false;

	return host.querySelector('.ticker-belt');
}

// Duration is measured rather than guessed, so the belt travels at one speed no
// matter how many items are on it or how wide the phone is. Same approach as
// js/listening/marquee.js, which measures its shift instead of assuming one.
export function startTicker(belt) {
	if (!belt) return;
	const first = belt.querySelector('.ticker-run');
	if (!first) return;

	const measure = () => {
		const width = first.scrollWidth;
		if (!width) return;
		belt.style.animationDuration = `${Math.max(12, width / SPEED)}s`;
	};

	measure();
	// The items arrive asynchronously and the viewport changes with rotation.
	if (typeof ResizeObserver === 'function') {
		const ro = new ResizeObserver(measure);
		ro.observe(first);
	}
	return measure;
}
