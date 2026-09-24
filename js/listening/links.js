// How a resolved track offers itself.
//
// api/resolve.js marks every link `exact` or not. An exact link opens the
// track; a search link opens a search box with the title typed in. Saying
// "Open in Spotify" when it is really a search is a small lie, and this section
// is built on not telling those.
//
// Repeating "Find on" three times wrapped onto two lines and read like
// boilerplate, so the searches share one verb:
//
//   Open in Apple Music - or find it on Spotify, YouTube Music, Last.fm

import { esc } from './format.js';

const NAME = {
	appleMusic: 'Apple Music',
	spotify: 'Spotify',
	youtube: 'YouTube Music',
	lastfm: 'Last.fm',
};

// Exact first: the link that actually plays should not sit behind three that
// only open a search box.
const ORDER = ['appleMusic', 'spotify', 'youtube', 'lastfm'];

const anchor = (url, label) =>
	`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

export function renderLinks(links) {
	const exact = [];
	const search = [];
	for (const key of ORDER) {
		const link = links?.[key];
		if (!link?.url || !NAME[key]) continue;
		(link.exact ? exact : search).push(anchor(link.url, NAME[key]));
	}

	const parts = [];
	if (exact.length) parts.push(`Open in ${exact.join(', ')}`);
	// Lower-case "or find it on" only when it follows an exact link, so the line
	// reads as one sentence rather than two fragments.
	if (search.length) {
		parts.push(`${exact.length ? 'or find it on' : 'Find it on'} ${search.join(', ')}`);
	}
	if (!parts.length) return '';
	return `<p class="links">${parts.join(' &mdash; ')}</p>`;
}
