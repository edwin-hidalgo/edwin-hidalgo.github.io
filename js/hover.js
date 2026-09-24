// Hover a word, see the photograph behind it.
//
// This has been on the site for years; it stopped working when the bio was
// rewritten without the spans it looked for. It is back, generalised, and it no
// longer starts empty: one photo is marked `data-photo-default` and shows on
// load, so the right half of the screen is never blank. Hovering any other word
// swaps to that photo; leaving it restores the default.
//
// Any element with data-photo="x" reveals <img data-photo="x">, so adding one
// is a span and a file, with no JavaScript to edit.
//
// Only above 1300px: css/style.css hides .img outright below that, because the
// photo is positioned over the right half and would land on the text. The same
// breakpoint strips the underline, so a narrow screen is never offered
// something it cannot have.
//
// Exported rather than self-starting: js/nav.js swaps page content without a
// reload, so the bindings have to be re-made against the new DOM.

export function initHover() {
	const photos = {};
	let fallback = null;

	document.querySelectorAll('img[data-photo]').forEach(img => {
		photos[img.dataset.photo] = img;
		if (img.hasAttribute('data-photo-default')) fallback = img.dataset.photo;
	});
	if (!Object.keys(photos).length) return;

	const triggers = [...document.querySelectorAll('[data-photo]:not(img)')];

	function show(key) {
		for (const [name, img] of Object.entries(photos)) {
			const on = name === key;
			// Nothing is fetched until a photo is first needed: eight images
			// behind a bio should not be eight requests on load.
			if (on && !img.src && img.dataset.src) img.src = img.dataset.src;
			img.style.display = on ? 'block' : 'none';
		}
		// The word whose photo is up reads as chosen rather than merely
		// hoverable.
		for (const t of triggers) t.classList.toggle('is-showing', t.dataset.photo === key);
	}

	for (const trigger of triggers) {
		if (!photos[trigger.dataset.photo]) continue;
		const enter = () => show(trigger.dataset.photo);
		const leave = () => show(fallback);
		trigger.addEventListener('mouseover', enter);
		trigger.addEventListener('mouseout', leave);
		// Keyboard users get it too, without hijacking anything.
		trigger.addEventListener('focus', enter);
		trigger.addEventListener('blur', leave);
	}

	show(fallback);
}
