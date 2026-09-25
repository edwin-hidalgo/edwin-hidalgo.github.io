// What Edwin listens to most.
//
// The recent list answers "what just happened"; this answers "what does he
// actually listen to", and neither can be derived from the other -- a hundred
// scrobbles say nothing about a year. It sits under the queue, in the column of
// things that are about Edwin rather than about the last few hours, and it
// fills the space that column had been carrying empty since the swap.
//
// The windows are Last.fm's own period buckets. The API supports no arbitrary
// range, so offering "last 7 days / last 30 days / all time" is offering
// exactly what the upstream can answer rather than a control that would have
// to approximate.
//
// Top TRACKS are playable -- they are artist/title pairs, which is all
// playFrom() needs, since makeResolver() looks up a preview on demand. Top
// ARTISTS are not a thing you can play, so those rows link to Last.fm instead.
// One list, two honest behaviours, rather than one pretend one.

import { esc } from './format.js';
import { playFrom, rowKey } from './track.js';
import * as player from '../player/engine.js';

const SCOPE = 'top';
const DEFAULT_KIND = 'artists';
const DEFAULT_PERIOD = '7day';

// Switching back and forth should not re-ask Last.fm. Keyed by kind+period,
// and only ever holds the handful of combinations the controls can produce.
const cache = new Map();

async function fetchTop(kind, period) {
	const key = `${kind}:${period}`;
	if (cache.has(key)) return cache.get(key);
	const promise = (async () => {
		try {
			const res = await fetch(`/api/top?kind=${kind}&period=${period}`);
			return res.ok ? await res.json() : { items: [] };
		} catch {
			return { items: [] };
		}
	})();
	cache.set(key, promise);
	return promise;
}

const pill = (label, value, current, group) =>
	`<button type="button" class="top-pill${value === current ? ' is-on' : ''}"
		data-${group}="${esc(value)}" aria-pressed="${value === current}">${esc(label)}</button>`;

function row(item, i, kind) {
	const plays = `<span class="top-plays">${item.plays.toLocaleString()}</span>`;
	const main = kind === 'tracks'
		? `<span class="top-main"><span class="top-name">${esc(item.name)}</span>
		     <span class="top-by">${esc(item.artist ?? '')}</span></span>`
		: `<span class="top-main"><span class="top-name">${esc(item.name)}</span></span>`;

	// A track can be played; an artist can only be looked up.
	if (kind === 'tracks') {
		return `<li class="top-row" data-key="${esc(rowKey(item, i, SCOPE))}" data-i="${i}">
			<button class="top-btn" type="button">
				<span class="top-rank">${i + 1}</span>${main}${plays}
			</button>
		</li>`;
	}
	return `<li class="top-row">
		<a class="top-btn" href="${esc(item.url ?? '#')}" target="_blank" rel="noopener noreferrer">
			<span class="top-rank">${i + 1}</span>${main}${plays}
		</a>
	</li>`;
}

export function mountTop(el) {
	if (!el) return;
	let kind = DEFAULT_KIND;
	let period = DEFAULT_PERIOD;
	// Responses can land out of order when the controls are tapped quickly.
	// Only the newest request may paint.
	let runId = 0;

	const paint = async () => {
		const mine = ++runId;
		const data = await fetchTop(kind, period);
		if (mine !== runId) return;

		const items = data?.items ?? [];
		const periods = data?.periods ?? {
			'7day': 'last 7 days', '1month': 'last 30 days', overall: 'all time',
		};

		el.hidden = false;
		el.innerHTML = `<div class="top-head">
				<p class="top-label">Top</p>
				<span class="top-kinds">
					${pill('Artists', 'artists', kind, 'kind')}${pill('Tracks', 'tracks', kind, 'kind')}
				</span>
			</div>
			<div class="top-windows">
				${Object.entries(periods).map(([v, l]) => pill(l, v, period, 'period')).join('')}
			</div>
			${items.length
				? `<ol class="top-list">${items.map((it, i) => row(it, i, kind)).join('')}</ol>`
				: `<p class="top-empty">${data?.private ? 'Kept private.' : 'Nothing here yet.'}</p>`}`;

		el.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
			if (b.dataset.kind === kind) return;
			kind = b.dataset.kind;
			paint();
		}));
		el.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => {
			if (b.dataset.period === period) return;
			period = b.dataset.period;
			paint();
		}));

		// Only tracks are playable.
		if (kind === 'tracks') {
			el.querySelectorAll('.top-btn').forEach(btn => {
				const li = btn.closest('.top-row');
				btn.addEventListener('click', () => {
					if (player.currentOwner() === li.dataset.key) return player.togglePlay();
					playFrom(items.map(i => ({ artist: i.artist, track: i.name })),
						Number(li.dataset.i), `Top tracks · ${periods[period]}`, SCOPE);
				});
			});
		}
		marks();
	};

	const marks = () => {
		const owner = player.currentOwner();
		el.querySelectorAll('.top-row').forEach(li =>
			li.classList.toggle('is-playing', Boolean(li.dataset.key) && li.dataset.key === owner));
	};
	player.subscribe(reason => { if (reason !== 'progress') marks(); });

	paint();
}
