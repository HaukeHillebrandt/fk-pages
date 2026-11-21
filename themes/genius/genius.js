/* "genius" theme: click a highlighted line, read its annotation.
   The annotations are in the page as a plain list (.notes); this script hides the list and
   shows one annotation at a time: beside its line on wide screens, under it on small ones. */
(function () {
  'use strict';
  var doc = document;
  var lyrics = doc.getElementById('lyrics');
  var rail = doc.getElementById('rail');
  if (!lyrics || !rail || !lyrics.querySelector('.ann[data-ann]')) return;

  var notes = {};
  Array.prototype.forEach.call(lyrics.querySelectorAll('.note[data-ann]'), function (li) {
    notes[li.getAttribute('data-ann')] = li;
  });
  var wide = window.matchMedia('(min-width: 900px)');
  var author = doc.body.getAttribute('data-author') || '';
  var open = null;   // number of the annotation on show
  var card = null;
  var opener = null; // the lyric fragment that opened the card

  doc.documentElement.classList.add('js-ann');
  var hint = doc.getElementById('ann-hint');
  if (hint) hint.hidden = false;
  // with the script on, a highlight is a disclosure button, not a link: a drag on a link
  // starts a link drag, so lyrics could not be selected from inside a highlight
  // (a highlight inside a link of the poem is a <span>: it becomes a button too, and its card names the
  // link; inside a footnote marker it stays part of the marker, which goes on working as a link)
  Array.prototype.forEach.call(lyrics.querySelectorAll('.ann[data-ann]'), function (a) {
    if (a.closest('a[href^="#"]:not(.ann)')) return;
    a.removeAttribute('href');
    a.setAttribute('role', 'button');
    a.tabIndex = 0;
    a.setAttribute('aria-expanded', 'false');
    a.setAttribute('aria-controls', 'ann-card');
  });
  lyrics.addEventListener('keydown', function (e) {
    var a = e.target.closest && e.target.closest('.ann[data-ann][role="button"]');
    if (!a || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    show(a.getAttribute('data-ann'), a, true);
  });

  function fragments(id) {
    return lyrics.querySelectorAll('.ann[data-ann="' + id + '"]');
  }

  // where the keyboard focus is for a fragment: the fragment, or the link of the poem it sits in
  function stopOf(el) {
    return el.closest('[tabindex="0"], a[href]') || el;
  }

  // the address follows the open annotation, so a copied link opens it again
  function setHash(hash) {
    try {
      history.replaceState(null, '', hash || (location.pathname + location.search));
    } catch (e) { /* not allowed here (e.g. a file: page): the page works without it */ }
  }

  function close() {
    var refocus = card && card.contains(doc.activeElement) ? stopOf(opener) : null;
    if (card) { card.remove(); card = null; }
    rail.style.minHeight = '';
    Array.prototype.forEach.call(lyrics.querySelectorAll('.ann.on'), function (a) {
      a.classList.remove('on');
      a.setAttribute('aria-expanded', 'false');
    });
    if (open) setHash('');
    open = null;
    opener = null;
    if (refocus) refocus.focus();
  }

  function place(from) {
    if (!card) return;
    var all = fragments(open);
    if (!all.length) return;
    var focused = card.contains(doc.activeElement) ? doc.activeElement : null;   // moving the card drops the focus
    if (wide.matches) {
      if (card.parentNode !== rail) rail.appendChild(card);
      var at = (from || all[0]).getBoundingClientRect().top - rail.getBoundingClientRect().top;
      card.style.top = Math.max(0, Math.round(at)) + 'px';
      rail.style.minHeight = (card.offsetTop + card.offsetHeight) + 'px';
    } else {
      card.style.top = '';
      rail.style.minHeight = '';
      var last = all[all.length - 1];
      var block = last.closest('p, li, h2, h3, h4, blockquote') || last;
      if (card.previousSibling !== block) block.parentNode.insertBefore(card, block.nextSibling);
    }
    if (focused && doc.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  function reveal() {
    var r = card.getBoundingClientRect(), h = window.innerHeight;
    // the line that was opened stays below the top bar, also when its card is taller than the screen
    var keep = opener ? Math.min(r.top, opener.getBoundingClientRect().top) : r.top;
    if (r.bottom > h) window.scrollBy(0, Math.min(r.bottom - h + 16, keep - 64));
  }

  function show(id, from, byKey) {
    var again = open === id;
    var was = from ? from.getBoundingClientRect().top : null;
    close();
    if (again || !notes[id]) return;
    open = id;
    opener = from || fragments(id)[0];
    Array.prototype.forEach.call(fragments(id), function (a) {
      a.classList.add('on');
      a.setAttribute('aria-expanded', 'true');
    });
    card = doc.createElement('div');
    card.className = 'card';
    card.id = 'ann-card';
    card.tabIndex = -1;
    card.setAttribute('role', 'note');
    var x = doc.createElement('button');
    x.type = 'button';
    x.className = 'card-x';
    x.setAttribute('aria-label', 'Close annotation');
    x.textContent = '×';
    x.addEventListener('click', close);
    var label = doc.createElement('p');
    label.className = 'card-label';
    label.textContent = (author ? author + ' ' : '') + 'Annotation';
    card.appendChild(x);
    card.appendChild(label);
    var by = notes[id].querySelector('.note-by');
    if (by) card.appendChild(by.cloneNode(true));
    var body = notes[id].querySelector('.note-body');
    if (body) card.appendChild(body.cloneNode(true));
    // the highlight sits in a link of the poem: a click on it opens this card, so the card offers the link
    var link = opener.closest('a[href]');
    if (link) {
      var more = doc.createElement('p');
      more.className = 'card-link';
      var go = doc.createElement('a');
      go.href = link.href;
      go.rel = 'nofollow noopener';
      go.textContent = link.getAttribute('href');
      more.appendChild(doc.createTextNode('Link in this line: '));
      more.appendChild(go);
      card.appendChild(more);
    }
    place(from);
    // closing the card of a line further up has moved this line: put it back where it was clicked
    // (a browser with scroll anchoring has done that already, and then nothing is left to do)
    if (was !== null) {
      var moved = from.getBoundingClientRect().top - was;
      if (Math.abs(moved) >= 1) window.scrollBy(0, moved);
    }
    reveal();
    setHash('#ann-' + id);
    if (byKey) card.focus();
  }

  var down = null;   // where the pointer went down
  lyrics.addEventListener('pointerdown', function (e) { down = [e.clientX, e.clientY]; });
  lyrics.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('.ann[data-ann][role="button"]') : null;
    if (!a || !lyrics.contains(a)) return;
    e.preventDefault();
    // a drag that selected words inside the highlight is not a click on it
    var s = window.getSelection && window.getSelection();
    if (e.detail > 0 && s && !s.isCollapsed && down && Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 4) return;
    show(a.getAttribute('data-ann'), a, e.detail === 0);
  });
  lyrics.addEventListener('pointerover', function (e) {
    if (e.pointerType !== 'mouse') return;   // a tap would leave the highlight stuck on
    var a = e.target.closest && e.target.closest('.ann[data-ann]');
    if (a) Array.prototype.forEach.call(fragments(a.getAttribute('data-ann')), function (f) { f.classList.add('hl'); });
  });
  lyrics.addEventListener('pointerout', function (e) {
    var a = e.target.closest && e.target.closest('.ann[data-ann]');
    if (a && !(e.relatedTarget && a.contains(e.relatedTarget)))
      Array.prototype.forEach.call(fragments(a.getAttribute('data-ann')), function (f) { f.classList.remove('hl'); });
  });
  doc.addEventListener('click', function (e) {
    if (!open || !e.target.closest || e.target.closest('.ann, .card')) return;
    var s = window.getSelection && window.getSelection();
    if (s && !s.isCollapsed) return;   // the click only ended a text selection
    close();
  });
  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
  window.addEventListener('resize', function () { place(opener); });

  // Wide screens: the card is in the rail, which comes after all the lyrics in the page's order.
  // Tab treats the card as if it came right after its line, as it does on small screens:
  // ... line, [card], next line ... last line, footer.
  function stops(root) {
    return Array.prototype.filter.call(root.querySelectorAll('a[href], button, [tabindex="0"]'), function (el) {
      return el.getClientRects().length > 0;
    });
  }
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || !card || card.parentNode !== rail || e.ctrlKey || e.metaKey) return;
    var inCard = stops(card), inLyrics = stops(lyrics), everything = stops(doc);
    var home = stopOf(opener), first = inCard[0], last = inCard[inCard.length - 1];
    var next = inLyrics[inLyrics.indexOf(home) + 1], end = inLyrics[inLyrics.length - 1];
    var after = everything[everything.indexOf(last) + 1];   // the first stop below the rail
    var at = doc.activeElement, to = null;
    if (!first || inLyrics.indexOf(home) < 0) return;
    if (!e.shiftKey) {
      if (at === home) to = first;
      else if (at === last) to = next || after;
      else if (at === end && end !== home) to = after;
    } else if (at === card || at === first) to = home;
    else if (next && at === next) to = last;
    else if (after && at === after && end !== home) to = end;
    if (to) { e.preventDefault(); to.focus(); }
  });

  // Copying lyrics: one line per line, a blank line between stanzas. (The browser's own text has
  // a blank line after every line, because each line is its own <p>.)
  var LINES = 'p, li, h1, h2, h3, h4, h5, h6, td, th';
  function lineText(range, block) {
    var r = doc.createRange();
    r.selectNodeContents(block);
    if (block.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
    if (block.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
    var part = r.cloneContents();
    Array.prototype.forEach.call(part.querySelectorAll('br'), function (br) {   // a soft line break ends a line too
      br.parentNode.replaceChild(doc.createTextNode('\n'), br);
    });
    return part.textContent.replace(/\u00a0/g, ' ').split('\n').map(function (t) { return t.trim(); }).join('\n');
  }
  lyrics.addEventListener('copy', function (e) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !e.clipboardData) return;
    var range = sel.getRangeAt(0), out = [], prev = null;
    var top = range.commonAncestorContainer;
    if (top.nodeType !== 1) top = top.parentNode;
    if (!lyrics.contains(top) || top.closest('.card, .footnotes')) return;   // prose only: the browser's text is right
    Array.prototype.forEach.call(lyrics.querySelectorAll(LINES), function (block) {
      if (!range.intersectsNode(block) || block.querySelector(LINES) || !block.getClientRects().length) return;
      // the lines of a stanza follow each other; a footnote or a paragraph of an open card stands apart
      var group = block.closest('.card, .footnotes') ? block : (block.closest('.stanza') || block);
      if (prev && group !== prev) out.push('');
      out.push(lineText(range, block));
      prev = group;
    });
    if (out.length < 2) return;
    e.clipboardData.setData('text/plain', out.join('\n'));
    e.preventDefault();
  });

  // a link to #ann-3 opens that annotation
  function fromHash() {
    var m = /^#ann-(\d+)$/.exec(location.hash);
    if (!m) return;
    var first = fragments(m[1])[0];
    if (!first) return;
    if (open !== m[1]) show(m[1], first);
    first.scrollIntoView({ block: 'center' });
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();
})();
