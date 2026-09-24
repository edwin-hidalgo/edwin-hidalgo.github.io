// The live line under the Lounge link.
//
// It sits in the bottom-right corner, in the same label-and-content shape as
// Elsewhere and Portfolio beside it, and it is the only thing on the About page
// that moves. Two states, and the difference is doing real work:
//
//   playing now  -> a dot, then the track. The dot is the present-tense claim.
//   played then  -> the track and how long ago, which reads as past on its own.
//
// Never "listening now" over a scrobble from this morning. The dot only appears
// when the nowplaying flag is set AND the response it came in is fresh -- see
// isLive() in format.js, which exists because /api/lately is cached for 30s and
// the flag can outlive the truth.
//
// With nothing true to say the whole line is removed, leaving just "Lounge".
// A blank second line would be worse than none.

import { isLive, timeAgo, esc } from './format.js';

export function renderStanding(row, payload) {
	if (!row) return;
	const slot = row.querySelector('[data-standing]');
	if (!slot) return;

	const live = isLive(payload);
	const track = payload?.nowPlaying ?? payload?.recent?.[0];

	if (payload?.paused || payload?.private || !track) {
		row.hidden = true;
		return;
	}

	// Two states, and the difference does real work: a pulsing dot and the words
	// "listening now" when it is genuinely live, versus the track and how long
	// ago when it is not. A single static dot was too quiet to carry that.
	const label = `${esc(track.artist)} &mdash; ${esc(track.track)}`;
	slot.innerHTML = live
		? `<span class="live-dot is-live"></span><span class="now-word">listening now</span> ${label}`
		: `${label}${track.playedAt ? `, ${timeAgo(track.playedAt)}` : ''}`;
	row.hidden = false;
}
