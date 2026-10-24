// What each part of a video depends on. render.js runs pagePrints() inside the loaded page (it is turned into a
// string, so it must not use anything from this module) and builds a fingerprint per part from the result.
//
// The page's own HTML is split into its top-level clips (scenes) and everything else (shared: the page around the
// scenes, every script and style). Inside a clip, some elements get a print of their own ("late" elements) together
// with the time T before which they cannot change a single pixel; a part only depends on them if it ends after T.
// So in one long scene (a whiteboard, a camera world) an edit to something that appears at 40 s keeps 0-40 s.
//
// An element is late only when all of this holds (anything else stays part of its clip, as before):
//  - it is hidden until T and takes no room before T: either it is a nested clip (data-start/data-duration, or a child
//    of a data-sequence: display:none before its start), or its own entrance (data-enter with a delay, or another
//    animation) holds it at opacity 0 or visibility hidden until T and it is out of the flow (position absolute/fixed),
//    or it is an SVG shape/group. Checked in the page at load, where that state can be seen.
//  - nothing else can look at it: no script string, selector or data attribute names it, its ids or classes (camera
//    targets, mw.connect ends, timeline targets, cursor targets, url(#id) references), no SVG group around it is named
//    (its box grows with it), no CSS sibling/:has()/counter/anchor rules exist, no script walks the DOM (children,
//    textContent reads, scrollWidth...), and every script is a local file.
//  - it holds no video, canvas, iframe, morph pair, blend mode or will-change, and no loop/freeze/speed remaps its time.
// Each print also covers the element's live HTML after the runtime set it up (sketch seeds, marks, fitted text), so an
// edit that changes anything around it at load (for example the seeds of later sketched shapes) redoes those parts too.
export async function pagePrints() {
  const out = { clips: [], shared: '', resources: [], fine: null };
  out.resources = performance.getEntriesByType('resource').map((e) => e.name).sort();
  let src = null;
  try { const res = await fetch(location.pathname + '?raw=1'); if (res.ok && /html/.test(res.headers.get('content-type') || '')) src = await res.text(); } catch (e) {}
  if (!src) { out.shared = document.documentElement.outerHTML; out.fine = 'no HTML source'; return out; }
  const doc = new DOMParser().parseFromString(src, 'text/html');
  const SKIP = /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|TITLE|BASE)$/;
  const hash = async (s) => {
    try { const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return s; }
  };
  // HTML as a print: tags, attributes and text; `cuts` turns elements into placeholders (scripts and styles of the
  // source are in the shared print already)
  const ser = (root, cuts, live) => {
    const o = [];
    const visit = (n, top) => {
      if (n.nodeType === 3) { o.push(JSON.stringify(n.data)); return; }
      if (n.nodeType !== 1) return;
      if (!top && cuts.has(n)) { o.push(cuts.get(n)); return; }
      if (!live && (n.tagName === 'SCRIPT' || n.tagName === 'STYLE')) return;
      let s = '<' + n.tagName;
      for (const a of n.attributes) s += ' ' + a.name + '=' + JSON.stringify(a.value);
      o.push(s + '>');
      if (n.tagName === 'TEMPLATE') o.push(JSON.stringify(n.innerHTML));
      if (n.shadowRoot) { o.push('<#shadow>'); for (const c of n.shadowRoot.childNodes) visit(c, false); }
      for (const c of n.childNodes) visit(c, false);
      o.push('</>');
    };
    visit(root, true);
    const s = o.join('');
    return live ? s.split(location.origin).join('').replace(/blob:[^"\\\s)]+/g, 'blob:') : s;
  };

  const timed = (e) => e.hasAttribute('data-start') || e.hasAttribute('data-duration') || e.hasAttribute('data-end') || (e.parentElement && e.parentElement.hasAttribute('data-sequence'));
  const code = [];
  for (const e of doc.querySelectorAll('script, style')) code.push(e.outerHTML);
  const tops = [];
  const walk = (el, path) => { [...el.children].forEach((c, i) => { if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE') return; if (timed(c)) tops.push({ el: c, path: path.concat(i) }); else walk(c, path.concat(i)); }); };
  walk(doc.body, []);

  const fine = await setupFine(doc, SKIP);
  out.fine = fine.ok ? null : fine.why;
  for (const t of tops) {
    // the same element in the live page; if it moved, the whole page counts as shared
    let live = fine.ok ? fine.liveOf(t.el) : null;
    if (!live) { live = document.body; for (const i of t.path) live = live && live.children[i]; }
    if (!live || live.tagName !== t.el.tagName || (live.id || '') !== (t.el.id || '')) { out.shared = src; out.clips = []; out.fine = 'the page was rearranged while loading'; return out; }
    t.live = live;
  }
  const cutSrc = new Map(), cutLive = new Map();
  for (const t of tops) {
    const tm = mw.timing(t.live);
    t.units = [];
    if (fine.ok) fine.findUnits(t.el, t.live, tm.start, t.units);
    t.units.forEach((u, k) => { const ph = `<mw-late ${k} ${u.s.tagName}>`; cutSrc.set(u.s, ph); cutLive.set(u.l, ph); });
    t.timing = tm;
  }
  for (const t of tops) {
    const units = [];
    for (const u of t.units) units.push({ print: await hash(ser(u.s, cutSrc, false) + '\n' + ser(u.l, cutLive, true)), t: u.t, end: u.end, name: mw.__selector(u.l) });
    out.clips.push({ print: await hash(ser(t.el, cutSrc, false) + '\n' + ser(t.live, cutLive, true)), start: t.timing.start, end: t.timing.end, name: mw.__selector(t.live), units });
  }
  const topSrc = new Map(), topLive = new Map();
  for (const t of tops) { topSrc.set(t.el, '<mw-clip>'); topLive.set(t.live, '<mw-clip>'); }
  // the source around the scenes, every script and style, the live page around the scenes, and what cameras measured
  out.shared = ser(doc.documentElement, topSrc, false) + '\n' + code.join('\n') + '\n' + ser(document.documentElement, topLive, true) + '\n' + JSON.stringify(mw.__cameraContent ? mw.__cameraContent() : null);
  return out;

  // Everything the late-element rule needs to know about the page; { ok: false, why } turns it off.
  async function setupFine(doc, SKIP) {
    const no = (why) => ({ ok: false, why });
    const I = mw.__internal;
    const snap = mw.__sourceEls ? mw.__sourceEls() : null;
    if (!I || !snap) return no('old runtime');
    // the page's elements as the runtime found them, matched to the HTML file element by element; where a script
    // added, removed or replaced children while the page loaded, nothing below that element is matched
    const kidsOf = new Map();
    snap.els.forEach((e, i) => { if (SKIP.test(e.tagName)) return; const p = snap.parents[i]; let k = kidsOf.get(p); if (!k) kidsOf.set(p, (k = [])); k.push(e); });
    const toLive = new Map(), toSrc = new Map();
    const match = (s, l) => {
      const sk = [...s.children].filter((e) => !SKIP.test(e.tagName)), lk = kidsOf.get(l) || [];
      if (sk.length !== lk.length || sk.some((e, i) => e.tagName !== lk[i].tagName || (e.id || '') !== (lk[i].id || ''))) return;
      sk.forEach((e, i) => { toLive.set(e, lk[i]); match(e, lk[i]); });
    };
    match(doc.body, document.body);
    const liveOf = (s) => { let l = toLive.get(s); if (l && !l.isConnected && I.replaced) l = I.replaced.get(l) || l; return l && l.isConnected ? l : null; };
    for (const s of toLive.keys()) { const l = liveOf(s); if (l) toSrc.set(l, s); }

    // CSS: rules where one element's content or classes can change another element's style or place
    const cssIds = new Set();
    let cssWhy = null;
    const visitRules = (rules) => {
      for (const r of rules) {
        if (r.selectorText != null) {
          const sel = r.selectorText;
          if (/:nth-[\w-]*\([^)]*\bof\b/.test(sel)) cssWhy = 'a CSS :nth-child(… of …) rule';
          const bare = sel.replace(/\[[^\]]*\]/g, '[]').replace(/(:nth-[\w-]*)\([^)]*\)/g, '$1()');
          if (/[~+]/.test(bare)) cssWhy = 'a CSS sibling rule (~ or +)';
          if (/:has\(/.test(bare)) cssWhy = 'a CSS :has() rule';
        }
        const txt = r.cssText || '';
        if (/counter-(increment|set|reset)|anchor-name|position-anchor|\banchor\(/.test(txt)) cssWhy = 'CSS counters or anchor positioning';
        for (const m of txt.matchAll(/url\(\s*['"]?#([\w-]+)/g)) cssIds.add(m[1]);
        if (r.styleSheet) { try { visitRules(r.styleSheet.cssRules); } catch (e) { cssWhy = 'a stylesheet from another site'; } }
        if (r.cssRules) visitRules(r.cssRules);
      }
    };
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { return no('a stylesheet from another site'); } visitRules(rules); }
    if (cssWhy) return no(cssWhy);
    // fit: 'content' measures everything in the world (late things too) once at load; that box is in the shared print
    if (mw.__cameraContent && mw.__cameraContent().some((b) => !b)) return no("a camera's fit: 'content' was not measured at load");

    // Scripts (inline, local files, loaded JSON): every string in them could be a selector, an id or a class
    const texts = [], urls = new Set();
    for (const s of document.scripts) {
      const a = s.getAttribute('src');
      if (a) {
        const u = new URL(a, location.href);
        if (u.origin !== location.origin) return no('a script from another site');
        if (!u.pathname.startsWith('/__mw/')) urls.add(u.href);
      } else {
        // data (the injected config with --data, JSON scripts) can hold selectors too, but is not code
        const type = (s.getAttribute('type') || '').trim().toLowerCase();
        const data = /^\s*window\.__MW_CONFIG\b/.test(s.textContent) || !!(type && !/^(module|(text|application)\/(java|ecma)script)$/.test(type));
        texts.push({ text: s.textContent, el: s, data });
      }
    }
    for (const r of performance.getEntriesByType('resource')) {
      let u; try { u = new URL(r.name); } catch (e) { continue; }
      if (u.pathname.startsWith('/__mw/')) continue;
      if (/\.(m?js|cjs|jsx|tsx?|json)$/i.test(u.pathname)) { if (u.origin !== location.origin) return no('a script from another site'); urls.add(u.href); }
    }
    for (const u of urls) {
      try { const r = await fetch(u); if (!r.ok) return no('a script could not be read'); texts.push({ text: await r.text(), el: null, data: /\.json$/i.test(new URL(u).pathname) }); } catch (e) { return no('a script could not be read'); }
    }
    // A block's script that reaches the page only through its own root (document.currentScript.previousElementSibling)
    // may walk that root as it likes: nothing inside the root can be late. Any other script that walks the page
    // (children, siblings, text reads, getBBox, scrollWidth…) turns late elements off.
    const lits = [], walked = new Set();
    let raw = '';
    for (const { text, el, data } of texts) {
      const r = scanStrings(text);
      if (data) { lits.push(...(r ? r.lits : [{ s: text, pre: false, post: false, chunk: true }])); continue; }
      if (!r) return no('a script could not be read');
      lits.push(...r.lits);
      const rest = r.code.replace(/document\s*\.\s*currentScript\s*\.\s*previousElementSibling/g, '').replace(/document\s*\.\s*(create\w*|fonts)\b/g, '');
      const root = el && /document\s*\.\s*currentScript\s*\.\s*previousElementSibling/.test(r.code) && el.previousElementSibling;
      if (root && !/\b(document|window|globalThis|self|top|parent|frames|parentElement|parentNode|closest|ownerDocument|getRootNode|offsetParent|prototype|eval|Function)\b/.test(rest)) { walked.add(root); for (const e of root.querySelectorAll('*')) walked.add(e); }
      else raw += text + '\n;\n';
    }
    if (/\b(children|childNodes|firstChild|firstElementChild|lastChild|lastElementChild|nextSibling|nextElementSibling|previousSibling|previousElementSibling|getElementsByTagName|getElementsByClassName|getElementsByName|createTreeWalker|createNodeIterator|elementFromPoint|elementsFromPoint|scrollWidth|scrollHeight|getBBox)\b/.test(raw)) return no('a script walks the page (children, getBBox, scrollWidth…)');
    if (/\b(innerHTML|outerHTML|innerText|textContent)\b(?!\s*(=[^=]|:))/.test(raw)) return no('a script reads text or HTML of elements');
    raw = texts.map((t) => t.text).join('\n;\n');
    const words = new Set(raw.match(/[\w$-]+/g) || []);
    const whole = new Set(), prefixes = [], suffixes = [];
    const refSrc = new Set(), refLive = new Set();
    for (const { s, pre, post, chunk } of lits) {
      const tk = s.match(/[\w-]+/g) || [];
      for (const x of tk) whole.add(x);
      if (tk.length && pre) suffixes.push(tk[0]);
      if (tk.length && post) prefixes.push(tk[tk.length - 1]);
      const q = s.trim();
      if (!chunk && q && q.length < 300 && !/\n/.test(q)) {
        try { for (const e of document.querySelectorAll(q)) refLive.add(e); for (const e of doc.querySelectorAll(q)) refSrc.add(e); } catch (e) {}
      }
    }
    const litHit = (n) => whole.has(n) || prefixes.some((p) => n.startsWith(p)) || suffixes.some((p) => n.endsWith(p));
    // attributes that name things (data-target="#btn", href="#arrow", fill="url(#grad)"): token → elements
    const attrTok = new Map(), owners = new Map();
    const add = (m, k, e) => { let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(e); };
    const tokensOf = (e) => {
      const r = [];
      for (const a of e.attributes) {
        if (a.name === 'id' || a.name === 'class') continue;
        if (a.name === 'style') { for (const m of a.value.matchAll(/url\(\s*['"]?#([\w-]+)/g)) r.push(m[1]); continue; }
        for (const x of a.value.match(/[\w-]+/g) || []) r.push(x);
      }
      return r;
    };
    for (const e of doc.querySelectorAll('*')) {
      if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
      for (const x of tokensOf(e)) add(attrTok, x, e);
      if (e.id) add(owners, e.id, e);
      for (const c of e.classList) add(owners, c, e);
    }
    const namesOf = (e) => { const r = []; if (e.id) r.push(e.id); for (const c of e.classList) r.push(c); return r; };
    // is this one element named anywhere (s: in the HTML file, l: in the live page)?
    const named = (s, l, inside) => {
      if ((s && refSrc.has(s)) || (l && refLive.has(l))) return true;
      for (const e of [s, l]) {
        if (!e) continue;
        if (e.id && (words.has(e.id) || cssIds.has(e.id))) return true;
        for (const n of namesOf(e)) {
          if (litHit(n)) return true;
          if ((attrTok.get(n) || []).some((o) => !inside(o))) return true;
        }
      }
      return false;
    };
    const clipOf = new Map(I.clips().map((c) => [c.el, c]));
    const morphs = (I.morphPairs ? I.morphPairs() : []).flatMap((p) => [p.from, p.to]).filter(Boolean);
    const NOPE = new Set(['video', 'audio', 'iframe', 'object', 'embed', 'canvas', 'foreignobject', 'mw-include']);
    const SVG_DEFS = new Set(['defs', 'clippath', 'mask', 'marker', 'pattern', 'symbol', 'lineargradient', 'radialgradient', 'filter', 'text']);

    // when an element can first change a pixel (null: treat it as part of what holds it)
    function unitTime(s, l, parentT) {
      if (walked.has(l)) return null;
      const subS = [s, ...s.querySelectorAll('*')], subL = [l, ...l.querySelectorAll('*')];
      if (subS.some((e) => NOPE.has(e.localName.toLowerCase()) || e.hasAttribute('data-morph')) || subL.some((e) => NOPE.has(e.localName.toLowerCase()))) return null;
      if (morphs.some((m) => l.contains(m))) return null;
      const nc = I.nearestClip(l);
      if (nc && ((nc.chain && nc.chain.length) || (nc.outer && nc.outer.length))) return null;
      const svgChild = l instanceof SVGElement && !!l.ownerSVGElement;
      if (svgChild) {
        // an SVG group's box, filter or mask region grows with what is inside it
        for (let a = l.parentElement; a; a = a.parentElement) {
          if (SVG_DEFS.has(a.localName.toLowerCase())) return null;
          const cs = getComputedStyle(a);
          if (cs.filter !== 'none' || cs.clipPath !== 'none' || cs.maskImage !== 'none') return null;
          if (a.getAnimations().some((x) => x.effect && x.effect.getKeyframes().some((k) => k.filter != null || k.clipPath != null || k.maskImage != null || k.mask != null))) return null;
          if (a === l.ownerSVGElement) break; // (the outer <svg> box is its CSS box, whatever is inside)
          if (named(toSrc.get(a), a, () => false)) return null;
        }
        if (SVG_DEFS.has(l.localName.toLowerCase())) return null;
      }
      let t = null, end = null;
      const c = clipOf.get(l);
      if (c && c.start > parentT + 1e-6) { t = c.start; end = c.end; }
      if (t == null) {
        const h = hiddenUntil(l, subL);
        if (h != null && h > parentT + 1e-6) {
          if (!svgChild && !/^(absolute|fixed)$/.test(getComputedStyle(l).position)) return null;
          // invisible boxes still make a scroll container scroll
          for (let a = l.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) return null; }
          t = h;
        }
      }
      if (t == null) return null;
      // named by a script, a selector, an attribute or url(#id), or names something outside itself
      const inside = (o) => s.contains(o);
      for (let i = 0; i < subS.length; i++) if (named(subS[i], null, inside)) return null;
      for (const e of subL) if (named(null, e, inside)) return null;
      for (const e of subS) for (const x of tokensOf(e)) if ((owners.get(x) || []).some((o) => !inside(o))) return null;
      return { t, end };
    }
    // the time an element's own animation keeps it fully invisible until (opacity 0 or visibility hidden, held by
    // fill: backwards), checked against the page as it is now (at load, before any of these animations started)
    function hiddenUntil(l, subL) {
      const anims = l.getAnimations().filter((a) => a.effect && a.effect.target === l && !a.effect.pseudoElement);
      const base = mw.timing(l).start;
      const best = { opacity: null, visibility: null }, hiders = new Set();
      anims.forEach((a, i) => {
        const kf = a.effect.getKeyframes(), tm = a.effect.getTiming();
        if (!kf.length || (kf[0].offset || 0) !== 0) return;
        const prop = kf[0].opacity != null && parseFloat(kf[0].opacity) === 0 ? 'opacity' : kf[0].visibility === 'hidden' ? 'visibility' : null;
        if (!prop) return;
        // (only animations the runtime already drives: a CSS animation it has not taken over yet still runs on Chrome's
        //  own clock here, so what it shows now says nothing)
        if (a.playState !== 'paused' || !(tm.fill === 'backwards' || tm.fill === 'both') || !(tm.direction === 'normal' || tm.direction === 'alternate') || tm.iterationStart || a.playbackRate !== 1 || a.effect.composite !== 'replace') return;
        if (!(a.currentTime != null && a.currentTime < tm.delay)) return;
        const start = base + tm.delay / 1000;
        // an animation later in the stack that also sets this property and may act before `start` would show it
        for (const b of anims.slice(i + 1)) {
          if (!b.effect.getKeyframes().some((k) => k[prop] != null)) continue;
          const bt = b.effect.getTiming();
          if (bt.fill === 'backwards' || bt.fill === 'both' || base + bt.delay / 1000 < start) return;
        }
        hiders.add(a);
        if (best[prop] == null || start > best[prop]) best[prop] = start;
      });
      if (best.opacity == null && best.visibility == null) return null;
      if (subL.some((e) => getComputedStyle(e).willChange !== 'auto')) return null;
      let t = best.opacity != null && getComputedStyle(l).opacity === '0' ? best.opacity : null;
      if (best.visibility == null || (t != null && t >= best.visibility)) return t;
      // visibility hides only what does not set its own (descendants and ::before/::after too; their own reveals that
      // only ever say "hidden" are fine); blend modes and backdrop filters reach outside an element that is not its own group
      if (l.getAnimations({ subtree: true }).some((a) => !hiders.has(a) && a.effect && a.effect.getKeyframes().some((k) => k.visibility != null && k.visibility !== 'hidden'))) return t;
      for (const e of subL) {
        const cs = getComputedStyle(e);
        if (cs.visibility !== 'hidden' || cs.mixBlendMode !== 'normal' || cs.backdropFilter !== 'none') return t;
        if (!(e instanceof SVGElement)) for (const p of ['::before', '::after']) { const ps = getComputedStyle(e, p); if (ps.content !== 'none' && ps.content !== 'normal' && ps.visibility !== 'hidden') return t; }
      }
      return best.visibility;
    }
    function findUnits(sParent, lTop, parentT, units) {
      for (const s of sParent.children) {
        if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(s.tagName)) continue;
        const l = liveOf(s);
        const u = l && lTop.contains(l) && l !== lTop ? unitTime(s, l, parentT) : null;
        if (u) { units.push({ s, l, t: u.t, end: u.end }); findUnits(s, lTop, u.t, units); }
        else findUnits(s, lTop, parentT, units);
      }
    }
    return { ok: true, liveOf, findUnits };
  }

  // The string literals of a script ({ s, pre: joined to what is before it with +, post: joined to what follows,
  // chunk: a piece of a template string }) and its code without comments and strings. Regular expressions are
  // skipped (best effort). null when the script cannot be read this way.
  function scanStrings(t) {
    const lits = [];
    let code = '', i = 0, last = '', last2 = '';
    const n = t.length;
    const nextPlus = (j) => { while (j < n && /\s/.test(t[j])) j++; return t[j] === '+' && t[j + 1] !== '+'; };
    const quoted = (q) => {
      let j = i + 1, s = '';
      while (j < n && t[j] !== q) { if (t[j] === '\\') { s += t[j + 1] || ''; j += 2; continue; } if (t[j] === '\n') return -1; s += t[j++]; }
      if (j >= n) return -1;
      lits.push({ s, pre: last === '+', post: nextPlus(j + 1), chunk: false });
      return j + 1;
    };
    const template = () => {
      let j = i + 1, s = '', first = true;
      const pre = last === '+';
      while (j < n && t[j] !== '`') {
        if (t[j] === '\\') { s += t[j + 1] || ''; j += 2; continue; }
        if (t[j] === '$' && t[j + 1] === '{') {
          lits.push({ s, pre: first ? pre : true, post: true, chunk: true }); s = ''; first = false;
          let depth = 1, k = j + 2;
          const start = k;
          while (k < n && depth) { const ch = t[k]; if (ch === '{') depth++; else if (ch === '}') depth--; else if (ch === '"' || ch === "'" || ch === '`') { const q = ch; k++; while (k < n && t[k] !== q) { if (t[k] === '\\') k++; k++; } } k++; }
          if (depth) return -1;
          const inner = scanStrings(t.slice(start, k - 1));
          if (!inner) return -1;
          lits.push(...inner.lits);
          code += ' (' + inner.code + ') ';
          j = k;
          continue;
        }
        s += t[j++];
      }
      if (j >= n) return -1;
      lits.push({ s, pre: first ? pre : true, post: nextPlus(j + 1), chunk: !first });
      return j + 1;
    };
    while (i < n) {
      const c = t[i];
      if (c === '/' && t[i + 1] === '/') { const j = t.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && t[i + 1] === '*') { const j = t.indexOf('*/', i + 2); if (j < 0) return null; i = j + 2; code += ' '; continue; }
      if (c === '"' || c === "'") { const j = quoted(c); if (j < 0) return null; i = j; last = '"'; code += ' "" '; continue; }
      if (c === '`') { const j = template(); if (j < 0) return null; i = j; last = '"'; code += ' "" '; continue; }
      const incdec = (last === '+' || last === '-') && last2 === last;
      if (c === '/' && !incdec && (last === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(t.slice(Math.max(0, i - 8), i).trimEnd()))) {
        // a regular expression literal
        let j = i + 1, cls = false;
        while (j < n && (cls || t[j] !== '/')) { if (t[j] === '\\') j++; else if (t[j] === '[') cls = true; else if (t[j] === ']') cls = false; else if (t[j] === '\n') return null; j++; }
        if (j >= n) return null;
        i = j + 1; last = '"'; code += ' /r/ ';
        continue;
      }
      if (!/\s/.test(c)) { last2 = last; last = c; }
      code += c;
      i++;
    }
    return { lits, code };
  }
}
