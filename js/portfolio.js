// The Portfolio page: tab switching and video autoplay.
//
// This was an inline IIFE at the bottom of portfolio.html, bound once on page
// load. That was fine while every navigation was a full reload -- but js/nav.js
// now swaps .content in place so audio survives moving between pages, and the
// replacement .tab nodes came back with no listeners. Arriving at Portfolio
// from the home page left the tabs dead: Career showed, Advisory and Projects
// did nothing.
//
// Exported instead, and called from initPage() in js/site.js, which runs on
// first load and again after every swap. Same treatment as initHover().
//
// The particles initialiser stays inline in the page: #particles-js sits
// outside .content, so the swap never touches it and it must not restart.

let observer = null;
let timer = null;

function switchTab(tabId) {
	document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
	document.querySelectorAll('.tab-content').forEach(c => {
		c.classList.remove('active');
		c.querySelectorAll('video').forEach(v => v.pause());
	});

	const tab = document.querySelector(`.tab[data-tab="${tabId}"]`);
	const content = document.getElementById(tabId);
	if (tab) tab.classList.add('active');
	if (content) {
		content.classList.add('active');
		content.querySelectorAll('video[autoplay]').forEach(v => v.play().catch(() => {}));
	}
}

export function initPortfolio() {
	const tabs = document.querySelectorAll('.tab');
	if (!tabs.length) return; // not the Portfolio page

	// A previous page's observer and timer would otherwise keep running against
	// detached nodes after a swap.
	observer?.disconnect();
	clearTimeout(timer);

	tabs.forEach(tab => {
		tab.addEventListener('click', () => {
			const id = tab.getAttribute('data-tab');
			switchTab(id);
			history.replaceState(null, '', '#' + id);
		});
	});

	// Arriving on #advisory or #projects selects that tab, then drops the hash
	// so a refresh does not re-trigger it.
	const hash = location.hash.replace('#', '');
	if (hash === 'advisory' || hash === 'projects') {
		history.replaceState(null, '', location.pathname);
		switchTab(hash);
	}

	observer = new IntersectionObserver(entries => {
		entries.forEach(entry => {
			if (entry.isIntersecting) entry.target.play().catch(() => {});
			else entry.target.pause();
		});
	}, { threshold: 0.3 });

	document.querySelectorAll('video[autoplay]').forEach(v => observer.observe(v));

	// Some browsers will not start a muted autoplay video until a beat after
	// layout settles.
	timer = setTimeout(() => {
		document.querySelector('.tab-content.active')
			?.querySelectorAll('video[autoplay]')
			.forEach(v => {
				v.muted = true;
				v.play().catch(() => {});
			});
	}, 500);
}
