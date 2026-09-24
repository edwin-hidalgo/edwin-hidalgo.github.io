// Transport icons as inline SVG.
//
// These were character glyphs -- U+25B6 for play, U+25C0 for previous. Both
// carry emoji presentation by default, so iOS drew them as boxed colour emoji
// while desktop drew plain triangles. Chasing that with a U+FE0E variation
// selector works in some fonts and not others; SVG simply renders the same
// everywhere and takes a size.
//
// currentColor throughout, so a button's colour rule reaches the icon.

const svg = (body, size = 14) =>
	`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false">${body}</svg>`;

export const icon = {
	play: (s = 14) => svg('<path d="M8 5.5v13a1 1 0 0 0 1.53.85l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5Z"/>', s),
	pause: (s = 14) => svg('<path d="M7 4.5h3.5v15H7zm6.5 0H17v15h-3.5z"/>', s),
	prev: (s = 14) => svg('<path d="M6 5.5v13a1 1 0 0 0 2 0v-4.9l8.47 5.75A1 1 0 0 0 18 18.5v-13a1 1 0 0 0-1.53-.85L8 10.4V5.5a1 1 0 0 0-2 0Z"/>', s),
	next: (s = 14) => svg('<path d="M18 5.5v13a1 1 0 0 1-2 0v-4.9l-8.47 5.75A1 1 0 0 1 6 18.5v-13a1 1 0 0 1 1.53-.85L16 10.4V5.5a1 1 0 0 1 2 0Z"/>', s),
	close: (s = 14) => svg('<path d="M18.3 5.7a1 1 0 0 0-1.4 0L12 10.6 7.1 5.7a1 1 0 1 0-1.4 1.4l4.9 4.9-4.9 4.9a1 1 0 1 0 1.4 1.4l4.9-4.9 4.9 4.9a1 1 0 0 0 1.4-1.4L13.4 12l4.9-4.9a1 1 0 0 0 0-1.4Z"/>', s),
};
