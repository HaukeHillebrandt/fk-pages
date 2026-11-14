/* Rainbow text selection.
 *
 * CSS can give ::selection only one flat colour. So the browser's own highlight is made
 * transparent, and a bar is drawn over every selected line instead. One rainbow runs through
 * all the bars in reading order, from the first selected character to the last, and blends
 * into the page (multiply on light, screen on dark), so the text keeps its colour.
 *
 * The script stays out of the way on touch-first devices (they draw their own handles, and
 * iOS ignores ::selection styling) and in forced-colours mode. There, and without JavaScript,
 * the stylesheet's flat ::selection colour shows.
 */
(function () {
  'use strict';

  var win = window, doc = document, root = doc.documentElement;
  if (!win.getSelection || !doc.createRange || !doc.createTreeWalker || !win.requestAnimationFrame) return;

  function media(query) { return !!win.matchMedia && win.matchMedia(query).matches; }
  if (media('(forced-colors: active)') || media('(hover: none) and (pointer: coarse)')) return;

  var RAINBOW = 'linear-gradient(90deg,#5b6cff 0%,#2f9bff 14%,#14c8c4 28%,#4fd66b 42%,' +
    '#f2d530 57%,#ff9a3c 71%,#ff5f7e 86%,#c86bff 100%)';
  var LAYER = 'rainbow-selection';       // class of the overlay; <html> gets LAYER + '-on'
  var NATIVE = LAYER + '-native';        // class for boxes that keep the browser's own highlight

  var css =
    ':root.' + LAYER + '-on ::selection{background-color:transparent}' +
    // text typed into fields, and text in boxes that don't scroll with the page, can't be
    // followed by the bars, so it keeps a plain highlight
    ':root.' + LAYER + '-on input::selection,:root.' + LAYER + '-on textarea::selection,' +
    ':root.' + LAYER + '-on .' + NATIVE + '::selection,:root.' + LAYER + '-on .' + NATIVE + ' ::selection' +
    '{background-color:Highlight;color:HighlightText}' +
    // unselectable: Select All must not pull the bars into what gets copied
    '.' + LAYER + '{position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;' +
    '-webkit-user-select:none;user-select:none}' +
    // z-index sits above the text but below the sticky header (20), so bars slide under it
    '.' + LAYER + ' i{position:absolute;z-index:5;border-radius:3px;background-image:' + RAINBOW +
    ';background-repeat:no-repeat;mix-blend-mode:multiply;opacity:.42}' +
    // .32 keeps dim text (dates, footnote markers) readable under the brightest stops
    '@media (prefers-color-scheme:dark){.' + LAYER + ' i{mix-blend-mode:screen;opacity:.32}}' +
    '@media print{.' + LAYER + '{display:none}}';

  var layer = null, bars = [], scheduled = false, showing = false;
  var NO_CONTEXT = { skip: false, clips: [] };

  // What an element means for the text inside it: can it be highlighted at all, and which
  // scrolling boxes cut it off? Looked up once per element per repaint.
  function context(el, memo) {
    if (!el || el === doc.body || el === root) return NO_CONTEXT;
    var known = memo.get(el);
    if (known) return known;
    var above = context(el.parentElement, memo), style = win.getComputedStyle(el);
    var ctx = { skip: above.skip, clips: above.clips };
    if (style.userSelect === 'none' || style.webkitUserSelect === 'none') ctx.skip = true;
    if (style.position === 'fixed' || style.position === 'sticky') {
      el.classList.add(NATIVE);
      ctx.skip = true;
    }
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      ctx.clips = above.clips.concat([el.getBoundingClientRect()]);
    }
    memo.set(el, ctx);
    return ctx;
  }

  function addRects(list, el, memo, out) {
    var ctx = context(el, memo);
    if (ctx.skip || win.getComputedStyle(el).visibility !== 'visible') return;
    for (var i = 0; i < list.length; i++) {
      var left = list[i].left, top = list[i].top, right = list[i].right, bottom = list[i].bottom;
      for (var c = 0; c < ctx.clips.length; c++) {
        left = Math.max(left, ctx.clips[c].left);
        right = Math.min(right, ctx.clips[c].right);
        top = Math.max(top, ctx.clips[c].top);
        bottom = Math.min(bottom, ctx.clips[c].bottom);
      }
      if (right - left > 0.5 && bottom - top > 0.5) out.push({ left: left, top: top, right: right, bottom: bottom });
    }
  }

  // Every piece of selected text (and every selected image) as a rectangle, in reading order.
  function selectedRects(range, memo, out) {
    var top = range.commonAncestorContainer;
    var scope = top.nodeType === 3 ? top.parentNode : top;   // an element, or the document itself
    if (!scope) return;
    var walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var node = range.startContainer, piece = doc.createRange();
    walker.currentNode = node;
    for (; node; node = walker.nextNode()) {
      if (!range.intersectsNode(node)) {
        if (range.comparePoint(node, 0) > 0) break;   // past the end of the selection
        continue;
      }
      if (node.nodeType === 3) {
        if (!node.parentElement) continue;
        piece.setStart(node, node === range.startContainer ? range.startOffset : 0);
        piece.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
        addRects(piece.getClientRects(), node.parentElement, memo, out);
      } else if (node.nodeName === 'IMG' && node !== range.startContainer && node !== range.endContainer) {
        addRects([node.getBoundingClientRect()], node, memo, out);
      }
    }
  }

  // Rectangles -> one bar per unbroken run of text on a line.
  function toBars(rects) {
    var lines = [], out = [], i, j;
    rects.forEach(function (r) {
      var line = lines[lines.length - 1];
      var overlap = line ? Math.min(line.bottom, r.bottom) - Math.max(line.top, r.top) : 0;
      if (line && overlap > 0.5 * Math.min(line.bottom - line.top, r.bottom - r.top)) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
        line.pieces.push(r);
      } else {
        lines.push({ top: r.top, bottom: r.bottom, pieces: [r] });
      }
    });
    // tight leading makes the boxes of neighbouring lines overlap: meet in the middle,
    // so no strip is tinted twice
    for (i = 1; i < lines.length; i++) {
      var a = lines[i - 1], b = lines[i];
      if (b.top < a.bottom && b.top > a.top) a.bottom = b.top = (a.bottom + b.top) / 2;
    }
    lines.forEach(function (line) {
      var run = null;
      line.pieces.sort(function (p, q) { return p.left - q.left; });
      for (j = 0; j < line.pieces.length; j++) {
        var p = line.pieces[j];
        if (run && p.left - run.right <= 1) run.right = Math.max(run.right, p.right);
        else out.push(run = { left: p.left, right: p.right, top: line.top, bottom: line.bottom });
      }
    });
    return out;
  }

  function paint() {
    scheduled = false;
    var selection = win.getSelection(), rects = [], memo = new Map(), i;
    if (selection && !selection.isCollapsed) {
      for (i = 0; i < selection.rangeCount; i++) selectedRects(selection.getRangeAt(i), memo, rects);
    }
    var list = toBars(rects);
    // "is there a selection", not "are bars visible": text scrolled out of a table comes back
    showing = !!selection && !selection.isCollapsed;
    if (!layer) {
      if (!list.length) return;
      layer = doc.createElement('div');
      layer.className = LAYER;
      layer.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(layer);
    }
    var origin = layer.getBoundingClientRect(), total = 0, done = 0;
    for (i = 0; i < list.length; i++) total += list[i].right - list[i].left;
    for (i = 0; i < list.length; i++) {
      var bar = bars[i] || (bars[i] = layer.appendChild(doc.createElement('i')));
      var width = list[i].right - list[i].left;
      bar.style.cssText = 'left:' + (list[i].left - origin.left).toFixed(2) + 'px;top:' +
        (list[i].top - origin.top).toFixed(2) + 'px;width:' + width.toFixed(2) + 'px;height:' +
        (list[i].bottom - list[i].top).toFixed(2) + 'px;background-size:' + total.toFixed(2) +
        'px 100%;background-position:' + (-done).toFixed(2) + 'px 0';
      done += width;
    }
    while (bars.length > list.length) layer.removeChild(bars.pop());
  }

  // If painting ever fails, give the browser its own highlight back rather than leave the
  // selection invisible.
  function paintOrGiveUp() {
    try { paint(); } catch (e) {
      root.classList.remove(LAYER + '-on');
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      doc.removeEventListener('selectionchange', repaint);
      showing = false;
    }
  }
  function repaint() {
    if (!scheduled) { scheduled = true; win.requestAnimationFrame(paintOrGiveUp); }
  }
  function repaintIfShowing() { if (showing) repaint(); }

  var style = doc.createElement('style');
  style.textContent = css;
  doc.head.appendChild(style);
  root.classList.add(LAYER + '-on');

  doc.addEventListener('selectionchange', repaint);
  win.addEventListener('resize', repaintIfShowing);
  // The bars scroll with the page by themselves; only a box scrolling inside it moves text under them.
  doc.addEventListener('scroll', function (e) { if (e.target !== doc) repaintIfShowing(); }, { capture: true, passive: true });
  if (win.ResizeObserver && doc.body) new win.ResizeObserver(repaintIfShowing).observe(doc.body);   // late images, reflow
  if (doc.fonts && doc.fonts.addEventListener) doc.fonts.addEventListener('loadingdone', repaintIfShowing);
  repaint();
})();
