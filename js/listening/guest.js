// A song someone left behind.
//
// The sentence leads and the track hides behind the tap. That ordering is the
// whole point: "left for you by M. -- for walking home late" is a gift, the
// same row with the title first is a playlist entry.
//
// This one is a mock. Submissions are not open yet, and the copy says so rather
// than showing a form that goes nowhere.

import { esc } from './format.js';
import { playFrom, rowKey } from './track.js';
import * as player from '../player/engine.js';

const MOCK = {
	from: 'M.',
	occasion: 'for walking home late',
	artist: 'Grouper',
	track: 'Heavy Water / I would Foolishly Like Silver',
};

export function render(el, getQuiet) {
	el.innerHTML = `<div class="listening-head"><h1>Left here</h1></div>
		<p class="guest-lede">Left for you by ${esc(MOCK.from)} &mdash; ${esc(MOCK.occasion)}.</p>
		<div class="row">
			<button class="row-open" type="button" aria-expanded="false">
				<span class="row-body"><span class="row-title">Hear what they left</span></span>
			</button>
			</div>
		<p class="guest-soon">A place to leave one of your own is coming.</p>`;

	const btn = el.querySelector('.row-open');
	btn.addEventListener('click', () => {
		if (getQuiet()) return;
		// The reveal: only on the press does the title appear, under the
		// sentence. Leading with the note is what makes it a gift rather than a
		// playlist entry.
		btn.querySelector('.row-title').textContent = `${MOCK.artist} \u2014 ${MOCK.track}`;
		if (player.currentOwner() === rowKey(MOCK, 0)) return player.togglePlay();
		playFrom([MOCK], 0, 'Left here');
	});
}
