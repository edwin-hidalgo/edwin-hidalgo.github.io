// A label that drifts when it is too long to fit.
//
// Ported from Onus (components/Marquee.tsx + the keyframes in index.css). It
// parks at the start, drifts to reveal the tail, parks again, and returns --
// rather than looping continuously, which is harder to read and never lets you
// see the beginning.
//
// The distance travelled is measured, not guessed, and handed to CSS as
// --marquee-shift. Duration scales with distance so long titles travel faster
// instead of taking a minute: Math.min(28, Math.max(12, 7 + shift / 20)).

export function startMarquee(wrap) {
	if (!wrap) return;
	const inner = wrap.querySelector('.marquee-inner');
	if (!inner) return;

	const measure = () => {
		// Clear first so the measurement is of the text, not of a shifted copy.
		wrap.classList.remove('is-drifting');
		inner.style.removeProperty('--marquee-shift');
		const shift = inner.scrollWidth - wrap.clientWidth;
		if (shift <= 2) return;
		inner.style.setProperty('--marquee-shift', `${-shift}px`);
		inner.style.animationDuration = `${Math.min(28, Math.max(12, 7 + shift / 20))}s`;
		wrap.classList.add('is-drifting');
	};

	measure();
	// The text is filled in asynchronously and the column width changes with
	// the viewport, so re-measure on both.
	if (typeof ResizeObserver === 'function') {
		const ro = new ResizeObserver(measure);
		ro.observe(wrap);
		ro.observe(inner);
	}
	return measure;
}
