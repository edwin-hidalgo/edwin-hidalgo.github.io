// One entry point for every page.
//
// Mounts the things that outlive a page change (the player bar, the link
// interceptor) once, and re-runs the things bound to page content (hover
// photos, the listening section) after each swap.

import { initHover } from './hover.js';
import { initPortfolio } from './portfolio.js';
import { initNav } from './nav.js';
import { mountPlayerBar } from './player/bar.js';
import { boot as bootListening } from './listening/index.js';

// Anything that binds to nodes inside .content has to run again after nav.js
// replaces it.
function initPage() {
	initHover();
	initPortfolio();
	bootListening();
}

initNav(initPage);
mountPlayerBar();
initPage();
