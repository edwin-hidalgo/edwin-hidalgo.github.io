// The bar at the bottom of every page.
//
// Mounted once, outside the content js/nav.js swaps, so it survives moving
// between About, Portfolio and the Lounge. It appears when there is something
// to say and stays after a run ends -- because the most obvious control on the
// page doing nothing is worse than not having it. Pressing play on a finished
// run restarts it.
//
// The constraint that shapes the code: emit() fires on every animation frame
// while audio runs. Rebuilding innerHTML at that rate would kill pointer
// capture on the scrubber and thrash layout, so the frame path patches exactly
// two values and everything else redraws only when the track changes.

import * as player from './engine.js';
import { esc } from '../listening/format.js';
import { renderLinks } from '../listening/links.js';
import { icon } from '../icons.js';

let bar = null;
let els = null;
let lastUrl = null;
// Pressing the close button is not the same as a run ending. A run that ends
// leaves the bar up offering to replay itself -- that is deliberate. But the
// X has to mean gone, and stopAll() alone did not do that, because stop()
// preserves lastQueue and the bar takes that as a reason to stay.
let dismissed = false;

const clock = s => {
	if (!Number.isFinite(s) || s < 0) s = 0;
	return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function build() {
	bar = document.createElement('div');
	bar.className = 'player';
	bar.hidden = true;
	bar.innerHTML = `
		<div class="player-inner">
			<img class="player-art" alt="" width="40" height="40">
			<div class="player-body">
				<p class="player-title"></p>
				<p class="player-meta"><span class="player-label"></span></p>
			</div>
			<div class="player-transport">
				<button class="player-btn" type="button" data-act="prev" aria-label="Previous track">${icon.prev(16)}</button>
				<button class="player-play" type="button" data-act="toggle" aria-label="Play"></button>
				<button class="player-btn" type="button" data-act="next" aria-label="Next track">${icon.next(16)}</button>
			</div>
			<div class="player-seek" role="slider" tabindex="0"
			     aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
				<div class="player-track"><div class="player-fill"></div></div>
			</div>
			<span class="player-time"></span>
			<span class="player-links"></span>
			<button class="player-btn player-close" type="button" data-act="stop" aria-label="Stop and close the player">${icon.close(15)}</button>
		</div>`;
	document.body.appendChild(bar);

	els = {
		art: bar.querySelector('.player-art'),
		title: bar.querySelector('.player-title'),
		label: bar.querySelector('.player-label'),
		play: bar.querySelector('.player-play'),
		fill: bar.querySelector('.player-fill'),
		seek: bar.querySelector('.player-seek'),
		time: bar.querySelector('.player-time'),
		links: bar.querySelector('.player-links'),
	};

	bar.addEventListener('click', e => {
		const act = e.target.closest('[data-act]')?.dataset.act;
		if (act === 'prev') player.skipBack();
		else if (act === 'next') player.skipNext();
		else if (act === 'stop') {
			dismissed = true;
			player.stopAll();
			paintTrack();
		}
		else if (act === 'toggle') player.togglePlay();
	});

	// Pointer capture rather than <input type=range>, so a drag that leaves the
	// bar still seeks and the fill needs no vendor pseudo-elements.
	let scrubbing = false;
	const at = e => {
		const r = els.seek.getBoundingClientRect();
		return (e.clientX - r.left) / r.width;
	};
	els.seek.addEventListener('pointerdown', e => {
		scrubbing = true;
		els.seek.setPointerCapture(e.pointerId);
		player.seek(at(e));
	});
	els.seek.addEventListener('pointermove', e => { if (scrubbing) player.seek(at(e)); });
	els.seek.addEventListener('pointerup', e => {
		scrubbing = false;
		els.seek.releasePointerCapture(e.pointerId);
	});
	els.seek.addEventListener('keydown', e => {
		const d = player.duration();
		if (!d) return;
		if (e.key === 'ArrowRight') { player.seek((player.elapsed() + 2) / d); e.preventDefault(); }
		if (e.key === 'ArrowLeft') { player.seek((player.elapsed() - 2) / d); e.preventDefault(); }
	});
}

// Every frame. Two values, neither structural.
function paintProgress() {
	if (!els) return;
	const pct = Math.round(player.progressNow() * 100);
	els.fill.style.width = `${pct}%`;
	els.seek.setAttribute('aria-valuenow', String(pct));
	els.time.textContent = `${clock(player.elapsed())} / ${clock(player.duration())}`;
}

function paintTrack() {
	const np = player.nowPlaying();
	const state = player.playState();

	// Anything newly playing un-dismisses: pressing play anywhere brings it back.
	if (np) dismissed = false;

	// Nothing playing and nothing to replay -- or dismissed by hand.
	if (dismissed || (!np && !player.hasLastQueue())) {
		bar.hidden = true;
		document.body.classList.remove('has-player');
		lastUrl = null;
		return;
	}
	bar.hidden = false;
	// The bar is fixed and overlays the page; this lets CSS reserve room for it
	// only while it is actually up.
	document.body.classList.add('has-player');

	if (np && np.url !== lastUrl) {
		lastUrl = np.url;
		els.title.innerHTML = `${esc(np.artist || '')} &mdash; ${esc(np.track || '')}`;
		els.links.innerHTML = renderLinks(np.links);
		if (np.art) {
			els.art.src = np.art;
			els.art.hidden = false;
		} else {
			els.art.removeAttribute('src');
			els.art.hidden = true;
		}
	}

	els.label.textContent = state === 'idle'
		? `${player.queueLabel() || ''} · ended`.trim().replace(/^·\s*/, '')
		: player.queueLabel() || '';

	// Idle with a remembered run: the button offers to start it again.
	const playing = state === 'playing';
	els.play.innerHTML = playing ? icon.pause(18) : icon.play(18);
	els.play.setAttribute('aria-label', playing ? 'Pause' : state === 'idle' ? 'Play again' : 'Play');
}

export function mountPlayerBar() {
	if (bar) return;
	build();
	player.subscribe(reason => {
		if (reason === 'progress') paintProgress();
		else { paintTrack(); paintProgress(); }
	});
	paintTrack();
}

// Quiet mode means no transport at all: the bar goes and anything playing
// stops. A hidden player still sounding would be its own small lie.
export function unmountPlayerBar() {
	player.stopAll();
	document.body.classList.remove('has-player');
	if (bar) bar.remove();
	bar = null;
	els = null;
	lastUrl = null;
}
