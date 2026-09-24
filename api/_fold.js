// Comparing two spellings of the same song.
//
// This lived inside api/resolve.js, where it decided whether Apple's top hit
// was really the track being asked for. The queue needs the same judgement for
// a different question -- has Edwin since listened to a song someone left? --
// and a second copy would have been the wrong move: this function carries a
// regression worth remembering. An earlier version treated "with" as a
// featuring marker and ate "With Love, Pt. 7" down to an empty string, then
// refused a match Apple was happily returning. test/run.mjs guards it.
//
// Underscore-prefixed so Vercel treats it as a module rather than a route.

// "Song (feat. X) - 2011 Remaster" and "Song" are the same song for our
// purposes. Strip the furniture before comparing so a good match is not thrown
// away over a parenthetical.
export function fold(s) {
  const raw = String(s || '').toLowerCase();
  const stripped = raw
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    // A featuring credit only counts mid-title, and "with" is not one of its
    // markers. "With Love, Pt. 7" and "Dancing With Myself" are titles; an
    // earlier version of this ate them to an empty string and then refused a
    // match Apple was happily returning.
    .replace(/\s+\b(feat|ft|featuring)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, '');
  // Tidying must never erase the whole title. If it did, compare the letters.
  return stripped || raw.replace(/[^a-z0-9]+/g, '');
}

// Containment in either direction, because fold() does NOT strip a trailing
// "- 2011 Remaster": the dash survives the bracket pass and is then squashed
// into the letters, so "pinkmoon" and "pinkmoon2011remaster" are not equal but
// are the same song.
//
// The looseness that buys has a cost at short lengths -- three or four letters
// land inside longer unrelated words easily -- so below MIN_LOOSE the test
// tightens to equality. Claiming Edwin played something he did not is a worse
// failure here than missing a match, since the site would be putting words in
// his mouth.
const MIN_LOOSE = 6;

export function sameish(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < MIN_LOOSE || b.length < MIN_LOOSE) return false;
  return a.includes(b) || b.includes(a);
}

// Both halves have to agree. One matching half is how you end up offering a
// cover, a remix, or an entirely different song with a common title.
export function sameTrack(foldedA, foldedT, artist, track) {
  return sameish(foldedA, fold(artist)) && sameish(foldedT, fold(track));
}
