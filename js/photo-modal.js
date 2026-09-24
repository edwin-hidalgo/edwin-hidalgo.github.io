// The photographs, on touch.
//
// They were desktop-only because the interaction was hover, and a phone has no
// hover. That was the wrong conclusion: the interaction had to change, not
// disappear. Tap a word and the photograph opens over the page; tap again --
// the image, the backdrop, anywhere -- and it closes.
//
// Five of the eight words are links to real places, so a tap has to mean one
// thing. It means "show me the photograph", and the link comes with it inside
// the modal, so nothing is lost and the rule is the same for every underlined
// word on the page.
//
// Desktop keeps hover and never mounts this.

const TOUCH = () => window.matchMedia('(max-width: 1350px)').matches;

let overlay = null;
let lastFocus = null;

function close() {
	if (!overlay) return;
	overlay.remove();
	overlay = null;
	document.body.classList.remove('has-modal');
	lastFocus?.focus?.();
	lastFocus = null;
}

function open(trigger, img) {
	close();
	lastFocus = trigger;

	const label = trigger.textContent.trim();
	// The word's own link, carried into the modal rather than lost to the tap.
	const href = trigger.tagName === 'A' ? trigger.getAttribute('href') : null;

	overlay = document.createElement('div');
	overlay.className = 'photo-modal';
	overlay.setAttribute('role', 'dialog');
	overlay.setAttribute('aria-modal', 'true');
	overlay.setAttribute('aria-label', label);
	overlay.innerHTML = `
		<figure class="photo-modal-inner">
			<img src="${img.dataset.src || img.src}" alt="">
			<figcaption>
				<span>${label}</span>
				${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">Visit &rarr;</a>` : ''}
			</figcaption>
		</figure>`;

	// Anywhere but the link closes it -- the image included, which is where a
	// thumb naturally lands.
	overlay.addEventListener('click', e => {
		if (e.target.closest('a')) return;
		close();
	});

	document.body.appendChild(overlay);
	document.body.classList.add('has-modal');
	overlay.focus?.();
}

function onKey(e) {
	if (e.key === 'Escape') close();
}

export function initPhotoModal() {
	close();
	if (!TOUCH()) return;

	const photos = {};
	document.querySelectorAll('img[data-photo]').forEach(i => { photos[i.dataset.photo] = i; });
	if (!Object.keys(photos).length) return;

	document.querySelectorAll('[data-photo]:not(img)').forEach(trigger => {
		const img = photos[trigger.dataset.photo];
		if (!img) return;
		trigger.addEventListener('click', e => {
			e.preventDefault(); // the link lives in the modal instead
			open(trigger, img);
		});
	});

	document.removeEventListener('keydown', onKey);
	document.addEventListener('keydown', onKey);
}
