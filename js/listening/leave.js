// Leaving a song.
//
// The whole form is two text fields, three optional letters and an emoji you
// tap. That narrowness is the feature's safety model rather than a limitation:
// a visitor never authors anything, they name a song and Apple's catalogue
// decides whether it exists. Nothing free-form reaches the page.
//
// The emoji are a fixed set sent by the server, not an input. One emoji is
// often two UTF-16 code units and a ZWJ sequence is eleven, so no length cap on
// a free field is both safe and correct; combining marks render outside their
// row, and bidi controls reverse the text around them. Tapping from a list has
// none of those problems, and the server checks the choice again anyway --
// every rule here is re-applied there, because a caller can skip this file.

import { esc } from './format.js';

// Why a submission was refused, in words a visitor can act on. "not_found" is
// the interesting one: Apple's search genuinely misses real songs -- its top
// results for "Bon Iver Holocene" are all covers and string quartets -- so the
// honest message is that the catalogue came up empty, not that they typed
// something wrong.
const REASONS = {
  incomplete: 'Needs both an artist and a song.',
  too_long: 'That is longer than it needs to be.',
  bad_initials: 'Initials are up to three letters.',
  bad_emoji: 'Pick one of the offered emoji.',
  not_found: 'Could not find that one on Apple Music. Try another spelling?',
  explicit: 'That one is marked explicit, so it stays off the page.',
  rate_limited: 'One song per day. Come back tomorrow?',
  duplicate: 'That one is already waiting.',
  busy: 'Something else was writing just then. Try again?',
  off: 'Not taking songs right now.',
};

let open = false;

function markup(emoji) {
  return `<form class="leave" novalidate>
    <p class="leave-lede">Leave a song for Edwin.</p>
    <label class="leave-field">
      <span>Artist</span>
      <input name="artist" type="text" autocomplete="off" maxlength="200" required>
    </label>
    <label class="leave-field">
      <span>Song</span>
      <input name="track" type="text" autocomplete="off" maxlength="300" required>
    </label>
    <label class="leave-field leave-initials">
      <span>Your initials <em>optional</em></span>
      <input name="initials" type="text" autocomplete="off" maxlength="3"
             pattern="[A-Za-z]{1,3}" inputmode="text">
    </label>
    <fieldset class="leave-emoji">
      <legend>Pick a mark <em>optional</em></legend>
      <div class="leave-emoji-grid">
        ${emoji.map(e => `<button type="button" class="leave-emoji-btn" data-emoji="${esc(e)}"
            aria-label="${esc(e)}">${esc(e)}</button>`).join('')}
      </div>
    </fieldset>
    <p class="leave-note" role="status" aria-live="polite"></p>
    <div class="leave-actions">
      <button type="button" class="leave-cancel" data-cancel>Cancel</button>
      <button type="submit" class="leave-send">Leave it</button>
    </div>
  </form>`;
}

export function mountLeave(host, emoji, onDone) {
  if (!host) return;

  const close = () => { open = false; host.innerHTML = ''; host.hidden = true; };

  const show = () => {
    if (open) return close();
    open = true;
    host.hidden = false;
    host.innerHTML = markup(emoji ?? []);

    const form = host.querySelector('.leave');
    const note = host.querySelector('.leave-note');
    const send = host.querySelector('.leave-send');
    let chosen = '';

    host.querySelectorAll('.leave-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Tapping the chosen one again clears it, so "no mark" stays reachable
        // without a separate control.
        chosen = chosen === btn.dataset.emoji ? '' : btn.dataset.emoji;
        host.querySelectorAll('.leave-emoji-btn').forEach(b =>
          b.classList.toggle('is-chosen', b.dataset.emoji === chosen));
      });
    });

    host.querySelector('[data-cancel]').addEventListener('click', close);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = {
        artist: form.artist.value.trim(),
        track: form.track.value.trim(),
        initials: form.initials.value.trim(),
        emoji: chosen,
      };
      if (!body.artist || !body.track) {
        note.textContent = REASONS.incomplete;
        return;
      }

      send.disabled = true;
      note.textContent = 'Looking it up…';
      try {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data?.ok) {
          close();
          // Hand the song back so the caller can show it at once. The queue's
          // read view is CDN-cached for thirty seconds, so re-fetching would
          // leave the visitor staring at a list that does not yet contain what
          // they just left.
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

    form.artist.focus();
  };

  return show;
}
