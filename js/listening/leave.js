// Leaving a song.
//
// Search, see real songs with their artwork, tap one. That is a better question
// to put to a visitor than "type the artist and the title exactly as Apple
// spells them" -- which was the first version, and which failed in the two ways
// blind fields always do: a real song reported as missing because the catalogue
// spells it differently, and a near-miss quietly resolving to some other
// recording.
//
// What travels to the server is the chosen track's id, not the words typed. The
// server looks that id up again rather than trusting it, so what gets stored is
// exactly the recording shown, and a caller who skips this file is held to the
// same rules.
//
// The only thing a visitor authors is up to three letters of a signature.
// Everything else is a choice from a catalogue.

import { esc } from './format.js';

// Why a submission was refused, in words a visitor can act on.
const REASONS = {
  incomplete: 'Something went wrong with that track.',
  bad_initials: 'Initials are up to three letters.',
  not_found: 'That track could not be confirmed. Try picking it again?',
  explicit: 'That one is marked explicit, so it stays off the page.',
  rate_limited: 'One song per day. Come back tomorrow?',
  duplicate: 'That one is already waiting.',
  busy: 'Something else was writing just then. Try again?',
  off: 'Not taking songs right now.',
};

// Long enough that a fast typist does not fire a request per keystroke. Apple
// rate-limits around twenty calls a minute per address, and the endpoint caches
// hard at the edge, but the restraint belongs here too.
const DEBOUNCE_MS = 350;
const MIN_QUERY = 2;

let open = false;

function markup() {
  return `<form class="leave" novalidate>
    <p class="leave-lede">Leave a song for Edwin.</p>

    <label class="leave-field">
      <span>Search for a song</span>
      <input name="q" type="search" autocomplete="off" maxlength="120"
             placeholder="artist or title" enterkeyhint="search">
    </label>

    <div class="leave-results" role="listbox" aria-label="Search results"></div>

    <div class="leave-chosen" hidden></div>

    <label class="leave-field leave-initials">
      <span>Your initials <em>optional</em></span>
      <input name="initials" type="text" autocomplete="off" maxlength="3"
             pattern="[A-Za-z]{1,3}" inputmode="text">
    </label>

    <p class="leave-note" role="status" aria-live="polite"></p>
    <div class="leave-actions">
      <button type="button" class="leave-cancel" data-cancel>Cancel</button>
      <button type="submit" class="leave-send" disabled>Leave it</button>
    </div>
  </form>`;
}

const resultRow = t => `<button type="button" class="leave-result" role="option"
    data-id="${esc(t.id)}" data-artist="${esc(t.artist)}" data-track="${esc(t.track)}"
    data-art="${esc(t.artwork ?? '')}">
    <span class="leave-result-art">${t.artwork
      ? `<img src="${esc(t.artwork)}" alt="" width="36" height="36" loading="lazy">` : ''}</span>
    <span class="leave-result-main">
      <span class="leave-result-track">${esc(t.track)}</span>
      <span class="leave-result-artist">${esc(t.artist)}${t.album ? ` &middot; ${esc(t.album)}` : ''}</span>
    </span>
  </button>`;

export function mountLeave(host, onDone) {
  if (!host) return;

  const close = () => { open = false; host.innerHTML = ''; host.hidden = true; };

  const show = () => {
    if (open) return close();
    open = true;
    host.hidden = false;
    host.innerHTML = markup();

    const form = host.querySelector('.leave');
    const note = host.querySelector('.leave-note');
    const send = host.querySelector('.leave-send');
    const results = host.querySelector('.leave-results');
    const chosenBox = host.querySelector('.leave-chosen');
    let chosen = null;
    let timer = null;
    // Responses can land out of order. Only the newest query may paint.
    let runId = 0;

    const paint = list => {
      results.innerHTML = list.length
        ? list.map(resultRow).join('')
        : `<p class="leave-none">Nothing found. Try fewer words?</p>`;
      results.querySelectorAll('.leave-result').forEach(btn => {
        btn.addEventListener('click', () => {
          chosen = { ...btn.dataset };
          chosenBox.hidden = false;
          chosenBox.innerHTML = `<span class="leave-chosen-art">${chosen.art
            ? `<img src="${esc(chosen.art)}" alt="" width="36" height="36">` : ''}</span>
            <span class="leave-chosen-main">
              <span class="leave-chosen-track">${esc(chosen.track)}</span>
              <span class="leave-chosen-artist">${esc(chosen.artist)}</span>
            </span>
            <button type="button" class="leave-clear" data-clear>Change</button>`;
          chosenBox.querySelector('[data-clear]').addEventListener('click', () => {
            chosen = null;
            chosenBox.hidden = true;
            chosenBox.innerHTML = '';
            send.disabled = true;
            form.q.focus();
          });
          results.innerHTML = '';
          form.q.value = '';
          send.disabled = false;
          note.textContent = '';
        });
      });
    };

    const search = async term => {
      const mine = ++runId;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (mine !== runId) return;
        paint(data?.results ?? []);
      } catch {
        if (mine === runId) results.innerHTML = '';
      }
    };

    form.q.addEventListener('input', () => {
      const term = form.q.value.trim();
      clearTimeout(timer);
      if (term.length < MIN_QUERY) { runId++; results.innerHTML = ''; return; }
      timer = setTimeout(() => search(term), DEBOUNCE_MS);
    });

    // Enter in the search box searches; it must not submit a half-filled form.
    form.q.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(timer);
      const term = form.q.value.trim();
      if (term.length >= MIN_QUERY) search(term);
    });

    host.querySelector('[data-cancel]').addEventListener('click', close);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!chosen) { note.textContent = 'Pick a song first.'; return; }

      send.disabled = true;
      note.textContent = 'Leaving it…';
      try {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            trackId: chosen.id,
            initials: form.initials.value.trim(),
          }),
        });
        const data = await res.json();
        if (data?.ok) {
          close();
          // Hand the song back so the caller can show it at once. The queue's
          // read view is CDN-cached for thirty seconds, so re-fetching alone
          // would leave the visitor staring at a list that does not yet contain
          // what they just left.
          onDone?.(data.song);
          return;
        }
        note.textContent = REASONS[data?.reason] ?? 'That did not work. Try again?';
      } catch {
        // A failed fetch is a network problem, not the visitor's mistake.
        note.textContent = 'Could not reach the site just then. Try again?';
      } finally {
        send.disabled = false;
      }
    });

    form.q.focus();
  };

  return show;
}
