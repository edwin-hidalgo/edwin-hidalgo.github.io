// Saying when something happened, without overclaiming.
//
// Last.fm's `nowplaying` flag is not on its own a licence to say "listening
// now": /api/lately sits on a CDN for up to 30 seconds, so the flag can outlive
// the truth. `isLive` requires the flag AND a fresh response. Everything else
// gets a relative time that degrades honestly as it ages -- minutes, then
// hours, then the day, then the date.

const FRESH_MS = 60_000;

export function isLive(payload) {
	if (!payload?.nowPlaying) return false;
	const age = Date.now() - (payload.fetchedAt ?? 0);
	return age >= 0 && age < FRESH_MS;
}

export function timeAgo(ms) {
	if (!ms) return '';
	const mins = Math.round((Date.now() - ms) / 60_000);
	if (mins < 1) return 'just now';
	if (mins === 1) return 'a minute ago';
	if (mins < 60) return `${mins} minutes ago`;
	const hours = Math.round(mins / 60);
	if (hours === 1) return 'an hour ago';
	if (hours < 24) return `${hours} hours ago`;
	const days = Math.round(hours / 24);
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Titles arrive from Last.fm, which takes them from whatever client scrobbled
// them. Treat every one as untrusted text.
export function esc(value) {
	const node = document.createElement('span');
	node.textContent = value ?? '';
	return node.innerHTML;
}
