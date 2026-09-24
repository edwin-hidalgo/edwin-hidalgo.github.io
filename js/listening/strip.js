// The strip at the top of the About page, on phones only.
//
// On a narrow screen the Lounge is the last thing on the page, several
// screenfuls down, and nothing above the fold suggests the site has a room in
// it at all. This puts one line at the very top: what Edwin is hearing, or
// last heard, and a way in.
//
// One line, not a carousel and not a nav bar. It earns the top of the page by
// being the only thing on it that changes -- the moment it carries Portfolio
// and contact too it becomes a second menu competing with the real one at the
// bottom, and the live track stops being special.
//
// It hides itself when there is nothing TRUE to say -- Edwin has gone dark,
// his listening is private, or the fetch failed. Not merely when nothing is
// playing: in that case there is still a most recent track, and it says so
// with an honest relative time.

import { isLive, timeAgo, esc } from './format.js';
import { icon } from '../icons.js';

export function renderStrip(payload) {
	const host = document.querySelector('[data-strip]');
	if (!host) return;

	if (payload?.paused || payload?.private) return; // nothing true to say
	const live = isLive(payload);
	const track = payload?.nowPlaying ?? payload?.recent?.[0];
	if (!track) return;

	const lede = live
		? '<span class="live-dot is-live"></span><span class="strip-now">listening now</span>'
		: `<span class="strip-now">last played${track.playedAt ? ` ${esc(timeAgo(track.playedAt))}` : ''}</span>`;

	host.innerHTML = `<a class="strip" href="lounge.html">
			<span class="strip-lede">${lede}</span>
			<span class="strip-track"><span class="marquee"><span class="marquee-inner">${esc(track.artist)} &mdash; ${esc(track.track)}</span></span></span>
			<span class="strip-go" aria-hidden="true">${icon.play(10)}</span>
		</a>`;
	host.hidden = false;
	return host.querySelector('.marquee');
}
