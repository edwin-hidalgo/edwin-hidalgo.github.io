// Three real pages that behave like one while the music is on.
//
// index.html, portfolio.html and lounge.html are ordinary files with ordinary
// URLs -- with JavaScript off, or if any of this fails, they are three static
// pages and every link works. What this adds is interception: a click on an
// internal link fetches the target, swaps the contents of .content, and pushes
// history. The document is never torn down, so the <audio> element inside
// js/player/engine.js keeps playing across the move.
//
// That is the entire reason this file exists. A full navigation stops audio,
// and no amount of state saving brings a playhead back convincingly.
//
// #particles-js sits outside .content and is therefore untouched by the swap,
// which is why the background never restarts between pages.

// Classes owned by the running session rather than by any one page.
const RUNTIME_CLASSES = ['has-player', 'has-ticker'];

const PAGES = /(^|\/)(index|portfolio|lounge)\.html$|\/$/;

let afterSwap = () => {};

function samePage(href) {
	try {
		const url = new URL(href, location.href);
		return url.origin === location.origin && PAGES.test(url.pathname);
	} catch {
		return false;
	}
}

async function swap(url, push) {
	let doc;
	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(String(res.status));
		doc = new DOMParser().parseFromString(await res.text(), 'text/html');
	} catch {
		// Any failure hands the navigation back to the browser, which will do
		// it properly. Losing the audio beats losing the page.
		location.href = url;
		return;
	}

	const next = doc.querySelector('.content');
	const here = document.querySelector('.content');
	if (!next || !here) {
		location.href = url;
		return;
	}

	here.replaceWith(next);
	document.title = doc.title;

	// Copy the incoming page's body classes, but keep the ones the running page
	// put there. has-player is set by the player bar to reserve space for
	// itself; clobbering it on every navigation left the footer links sitting
	// underneath the bar.
	const runtime = RUNTIME_CLASSES.filter(c => document.body.classList.contains(c));
	document.body.className = doc.body.className;
	for (const c of runtime) document.body.classList.add(c);

	if (push) history.pushState({}, '', url);
	window.scrollTo(0, 0);
	afterSwap();
}

export function initNav(onSwap) {
	afterSwap = onSwap || (() => {});

	document.addEventListener('click', e => {
		// Leave modified clicks alone: cmd-click still opens a new tab.
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = e.target.closest('a[href]');
		if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
		if (!samePage(a.getAttribute('href'))) return;

		e.preventDefault();
		const url = new URL(a.getAttribute('href'), location.href);
		if (url.pathname === location.pathname) {
			// Same page, different hash -- let the anchor behave normally.
			if (url.hash) location.hash = url.hash;
			return;
		}
		swap(url.pathname + url.search + url.hash, true);
	});

	addEventListener('popstate', () => swap(location.pathname + location.search, false));
}
