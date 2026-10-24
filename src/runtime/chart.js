/* motionwright live charts: mw.chart.line(el, opts). MIT License.
 * A line chart that draws itself over time. Its head is a real element (a camera can follow it, labels can ride it),
 * callouts are pinned to data points and appear when the line reaches them, the y axis can grow with the highest value
 * so far, segments can take their own color and the line can pause at chosen points.
 * Everything is a pure function of the time: the chart is measured once, then each frame is computed from t.
 */
(function () {
  'use strict';
  const mw = window.mw;
  if (!mw || !mw.__internal || mw.chart) return;
  const I = mw.__internal;
  const PX = I.PX;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const r2 = (x) => Math.round(x * 100) / 100;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const charts = [];

  const CSS = `
.mw-chart{--chart-line:#5eead4}
.mw-chart-svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.mw-chart-line,.mw-chart-seg{fill:none;stroke:var(--chart-line);stroke-width:calc(var(--px,1px)*7);stroke-linecap:round;stroke-linejoin:round}
.mw-chart-area-stop{stop-color:var(--chart-line)}
.mw-chart-grid line{stroke:currentColor;stroke-opacity:.13;stroke-width:calc(var(--px,1px)*2)}
.mw-chart-base{stroke:currentColor;stroke-opacity:.32;stroke-width:calc(var(--px,1px)*2.5)}
.mw-chart-tick{position:absolute;font-size:calc(var(--px,1px)*32);font-weight:600;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;color:color-mix(in srgb,currentColor 58%,transparent)}
.mw-chart-label{position:absolute;font-size:calc(var(--px,1px)*34);font-weight:700;line-height:1;white-space:nowrap;color:color-mix(in srgb,currentColor 42%,transparent)}
.mw-chart-label[data-reached]{color:currentColor}
.mw-chart-dot{position:absolute;box-sizing:border-box;width:calc(var(--px,1px)*22);height:calc(var(--px,1px)*22);margin:calc(var(--px,1px)*-11) 0 0 calc(var(--px,1px)*-11);border-radius:50%;background:var(--chart-bg,#0b0d12);border:calc(var(--px,1px)*5) solid var(--chart-line)}
.mw-chart-head{position:absolute;width:calc(var(--px,1px)*32);height:calc(var(--px,1px)*32);margin:calc(var(--px,1px)*-16) 0 0 calc(var(--px,1px)*-16);border-radius:50%;background:var(--chart-color,var(--chart-line));
  box-shadow:0 0 0 calc(var(--px,1px)*10) color-mix(in oklab,var(--chart-color,var(--chart-line)),transparent 72%),0 0 calc(var(--px,1px)*48) calc(var(--px,1px)*6) color-mix(in oklab,var(--chart-color,var(--chart-line)),transparent 50%)}
`;
  function addCSS() {
    if (document.getElementById('mw-chart-css')) return;
    const s = document.createElement('style');
    s.id = 'mw-chart-css';
    s.textContent = CSS;
    // first in <head>: the page's own CSS overrides it
    const h = document.head || document.documentElement;
    h.insertBefore(s, h.firstChild);
  }

  // ---------------------------------------------------------------------------
  // Options: forgiving parsing (arrays, comma strings from {{data.x}}, "2:1.2 Mar:0.8" maps)
  // ---------------------------------------------------------------------------
  const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(','));
  // {2: 1.2} | [[2, 1.2]] | [null, null, '#f00'] (one per point) | "2:1.2 Mar:0.8, last:#fff"
  function pairs(v) {
    if (v == null || v === '' || v === false) return [];
    if (typeof v === 'string') { const out = []; const re = /([^\s,:]+)\s*:\s*((?:\([^)]*\)|[^\s,()])+)/g; let m; while ((m = re.exec(v))) out.push([m[1], m[2]]); return out; }
    if (Array.isArray(v)) return v.every((x) => Array.isArray(x)) ? v.map((x) => [x[0], x[1]]) : v.map((x, i) => [i, x]).filter((x) => x[1] != null && x[1] !== '' && x[1] !== false);
    if (typeof v === 'object') return Object.entries(v);
    return [];
  }
  function fmtNumber(v, decimals) {
    const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return (v < 0 && Math.abs(v) >= 0.5 * Math.pow(10, -decimals) ? '−' : '') + s;
  }
  function niceStep(span, count) {
    const raw = span / Math.max(1, count), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function compact(v) {
    const a = Math.abs(v);
    const s = a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'k'] : [1, ''];
    const x = v / s[0];
    return (Math.round(x * 100) / 100).toString().replace('-', '−') + s[1];
  }

  // ---------------------------------------------------------------------------
  // The chart
  // ---------------------------------------------------------------------------
  class LineChart {
    constructor(target, opts = {}) {
      this.opts = opts;
      let el = typeof target === 'string' ? document.querySelector(target) : target;
      if (!el) {
        I.report('error', 'chart-no-element', `mw.chart.line: "${target}" matched nothing.`, null, 'Give it a selector of an element with a width and a height, e.g. <div id="growth" style="position:absolute;left:0;top:0;width:3600px;height:1000px">.');
        el = document.createElement('div'); // (not in the page: the chart's methods still answer, nothing is drawn)
      }
      this.el = el;
      const vals = list(opts.values ?? el.getAttribute('data-values')).map((x) => (typeof x === 'number' ? x : parseFloat(String(x).replace(/[^\d.eE+-]/g, ''))));
      this.vals = vals.filter((x) => isFinite(x));
      if (this.vals.length !== vals.length || this.vals.length < 2) {
        I.report('error', 'chart-no-values', `mw.chart.line: needs at least 2 numbers in values (got ${JSON.stringify(opts.values ?? null).slice(0, 80)}).`, el, 'Pass values: [1200, 1850, 1700] or values: mw.data.values.');
        if (this.vals.length < 2) this.vals = [0, 0];
      }
      const n = (this.n = this.vals.length);
      this.labels = list(opts.labels).map((x) => String(x).trim());
      const dec = opts.decimals ?? Math.min(2, Math.max(0, ...this.vals.map((v) => { const s = String(v); return s.includes('.') && !/e/i.test(s) ? s.split('.')[1].length : 0; })));
      this.format = typeof opts.format === 'function' ? opts.format : (v) => (opts.prefix || '') + fmtNumber(v, dec) + (opts.suffix || '');
      this.tickFormat = (v) => (opts.prefix || '') + compact(v) + (opts.suffix || '');
      this.curve();
      // segment colors: the segment that ends at point i
      this.colors = new Array(n).fill(null);
      for (const [k, c] of pairs(opts.colors)) { const i = this.index(k); if (i > 0) this.colors[i] = String(c); }
      this.timing();
      this.build();
      charts.push(this);
      el.__mwChart = this;
    }
    // a point given as 2, -1, 'last', 'first', 'max', 'min' or one of the labels ('Mar')
    index(k) {
      const n = this.n;
      if (typeof k === 'number') return Math.round(k < 0 ? n + k : k);
      const s = String(k).trim();
      if (/^-?\d+$/.test(s)) { const i = parseInt(s, 10); return i < 0 ? n + i : i; }
      const low = s.toLowerCase();
      if (low === 'last' || low === 'end') return n - 1;
      if (low === 'first' || low === 'start') return 0;
      if (low === 'max') return this.vals.indexOf(Math.max(...this.vals));
      if (low === 'min') return this.vals.indexOf(Math.min(...this.vals));
      const li = this.labels.findIndex((l) => l.toLowerCase() === low);
      if (li >= 0) return li;
      I.report('warning', 'chart-bad-point', `mw.chart.line: point "${s}" is not an index, first/last/max/min or one of the labels.`, this.el, 'Use a 0-based index (2 = the third point), -1 for the last, or a label from labels.');
      return NaN;
    }
    // monotone cubic through the points (no bumps past the data), in (index, value) space
    curve() {
      const v = this.vals, n = this.n, m = new Array(n).fill(0);
      const d = []; for (let k = 0; k < n - 1; k++) d.push(v[k + 1] - v[k]);
      if (this.opts.smooth === false) { this.tan = null; return; }
      m[0] = d[0]; m[n - 1] = d[n - 2];
      for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
      for (let k = 0; k < n - 1; k++) {
        if (d[k] === 0) { m[k] = m[k + 1] = 0; continue; }
        const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
        if (s > 9) { const tau = 3 / Math.sqrt(s); m[k] = tau * a * d[k]; m[k + 1] = tau * b * d[k]; }
      }
      this.tan = m;
    }
    // the 4 values of segment k's cubic (from point k to k+1)
    seg(k) {
      const v = this.vals, a = v[k], b = v[k + 1];
      if (!this.tan) return [a, a + (b - a) / 3, a + (2 * (b - a)) / 3, b];
      return [a, a + this.tan[k] / 3, b - this.tan[k + 1] / 3, b];
    }
    // value on the curve at a fractional point index
    valueAtIndex(p) {
      const n = this.n;
      p = clamp(p, 0, n - 1);
      const k = Math.min(n - 2, Math.floor(p)), f = p - k, [a, b, c, d] = this.seg(k), u = 1 - f;
      return u * u * u * a + 3 * u * u * f * b + 3 * u * f * f * c + f * f * f * d;
    }
    // when the line reaches each point: stops [[time, index], …] like mw.path.travel, eased between stops
    timing() {
      const o = this.opts, n = this.n;
      this.ease = mw.easing(o.ease || 'in-out-sine');
      let stops;
      if (Array.isArray(o.stops) && o.stops.length) {
        stops = o.stops.map((s) => [I.parseTime(s[0], this.el, 'mw.chart.line stops') ?? NaN, this.index(s[1])]).filter((s) => isFinite(s[0]) && isFinite(s[1])).sort((a, b) => a[0] - b[0]);
      }
      if (!stops || !stops.length) {
        const holds = new Array(n).fill(0);
        for (const [k, h] of pairs(o.holds)) { const i = this.index(k), s = I.parseTime(h, this.el, 'mw.chart.line holds'); if (i >= 0 && i < n - 1 && s > 0) holds[i] += s; }
        const start = I.parseTime(o.delay ?? o.at, this.el, 'mw.chart.line delay') ?? 0.3;
        const holdSum = holds.reduce((a, b) => a + b, 0);
        const dur = I.parseTime(o.duration, this.el, 'mw.chart.line duration') ?? Math.max(1.8, 0.45 * (n - 1)) + holdSum;
        const per = Math.max(0.02, (dur - holdSum) / (n - 1));
        let t = start;
        stops = [[t, 0]];
        if (holds[0]) { t += holds[0]; stops.push([t, 0]); }
        for (let i = 1; i < n; i++) {
          t += per;
          if (holds[i] || i === n - 1) stops.push([t, i]);
          if (holds[i]) { t += holds[i]; stops.push([t, i]); }
        }
      }
      this.stops = stops;
      this.reach = [];
      for (let i = 0; i < n; i++) this.reach.push(this.solveTime(i));
      // overview: after the line is drawn, the chart narrows to about the frame's width, so a camera shot that fits it
      // shows the whole year with labels at full size (instead of zooming out until they are specks)
      this.ov = null;
      if (o.overview) {
        const ov = typeof o.overview === 'object' ? o.overview : typeof o.overview === 'number' ? { width: o.overview } : {};
        this.ov = { at: I.parseTime(ov.at, this.el, 'mw.chart.line overview.at') ?? this.reach[n - 1] + 0.2, duration: I.parseTime(ov.duration, this.el, 'mw.chart.line overview.duration') ?? 1.4, width: +ov.width || 0, ease: mw.easing(ov.ease || 'in-out-cubic') };
      }
    }
    // fractional point index the head is at, at time t (seconds in the chart's clip)
    progress(t) {
      const st = this.stops;
      if (t <= st[0][0]) return st[0][1];
      for (let i = 1; i < st.length; i++) {
        if (t <= st[i][0]) { const p = (t - st[i - 1][0]) / Math.max(1e-6, st[i][0] - st[i - 1][0]); return st[i - 1][1] + (st[i][1] - st[i - 1][1]) * this.ease(p); }
      }
      return st[st.length - 1][1];
    }
    solveTime(i) {
      const st = this.stops;
      if (i <= st[0][1]) return st[0][0];
      for (let k = 1; k < st.length; k++) {
        const a = st[k - 1], b = st[k];
        if (b[1] >= i - 1e-9 && b[1] > a[1]) {
          if (a[1] >= i) return a[0];
          let lo = a[0], hi = b[0];
          for (let j = 0; j < 40; j++) { const mid = (lo + hi) / 2; if (this.progress(mid) < i - 1e-9) lo = mid; else hi = mid; }
          return Math.round(hi * 10000) / 10000;
        }
      }
      return st[st.length - 1][0];
    }
    timeOf(i) { const k = this.index(i); return isFinite(k) ? this.reach[clamp(k, 0, this.n - 1)] : NaN; }
    valueAt(t) { return this.valueAtIndex(this.progress(t)); }
    labelAt(t) { return this.labels[Math.round(this.progress(t))] ?? ''; }
    changeAt(t) {
      const i = Math.round(this.progress(t));
      if (i < 1 || !this.vals[i - 1]) return '';
      const pct = Math.round((this.vals[i] / this.vals[i - 1] - 1) * 100);
      return (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct) + '%';
    }
    // y range at time t: fixed, or growing with the highest value seen so far (with a little lag, so the head
    // rises into the headroom and then the axis catches up)
    range(t) {
      const o = this.opts, v = this.vals;
      const lo = o.min != null ? +o.min : Math.min(0, ...v);
      if (!o.rescale) {
        const top = Math.max(...v);
        return [lo, o.max != null ? +o.max : top + (top - lo) * 0.12 || 1];
      }
      const head = typeof o.rescale === 'number' && o.rescale > 1 ? o.rescale : 1.3;
      const runMax = (p) => { let m = this.valueAtIndex(p); for (let i = 0; i <= Math.floor(p); i++) m = Math.max(m, v[i]); return m; };
      const now = this.valueAtIndex(this.progress(t)), seen = runMax(this.progress(t - 0.35));
      let hi = Math.max(lo + (seen - lo) * head, lo + (now - lo) * 1.06);
      if (!(hi > lo)) hi = lo + 1;
      return [lo, hi];
    }

    // ---------------------------------------------------------------------------
    // DOM: made right away (so data-anchor and camera shots can name the head), measured later
    // ---------------------------------------------------------------------------
    build() {
      addCSS();
      const el = this.el, n = this.n, o = this.opts;
      el.classList.add('mw-chart');
      if (o.color) el.style.setProperty('--chart-line', o.color);
      const id = 'mw-chart-' + charts.length;
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'mw-chart-svg');
      svg.innerHTML = `<defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1" gradientUnits="userSpaceOnUse"><stop class="mw-chart-area-stop" offset="0" stop-opacity="${o.area === false ? 0 : 0.3}"/><stop class="mw-chart-area-stop" offset="1" stop-opacity="0"/></linearGradient></defs>
<g class="mw-chart-grid"></g><line class="mw-chart-base"/><path class="mw-chart-area" fill="url(#${id}-fill)"/><path class="mw-chart-line"/><g class="mw-chart-segs"></g>`;
      this.svg = svg;
      this.grad = svg.querySelector('linearGradient');
      this.gridG = svg.querySelector('.mw-chart-grid');
      this.base = svg.querySelector('.mw-chart-base');
      this.area = svg.querySelector('.mw-chart-area');
      this.line = svg.querySelector('.mw-chart-line');
      this.segs = [];
      this.colors.forEach((c, i) => { if (!c) return; const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', 'mw-chart-seg'); p.style.stroke = c; svg.querySelector('.mw-chart-segs').appendChild(p); this.segs.push({ i, p }); });
      const div = (cls, parent) => { const d = document.createElement('div'); d.className = cls; if (parent) parent.appendChild(d); return d; };
      const frag = document.createDocumentFragment();
      frag.appendChild(svg);
      this.tickBox = div('mw-chart-ticks', frag);
      this.tickBox.setAttribute('aria-hidden', 'true');
      this.labelEls = this.labels.length ? this.vals.map((_, i) => { const d = div('mw-chart-label', frag); d.textContent = this.labels[i] ?? ''; return d; }) : [];
      this.dots = this.vals.map((_, i) => { const d = div('mw-chart-dot', frag); d.setAttribute('data-i', i); if (this.colors[i]) d.style.borderColor = this.colors[i]; if (o.dots === false) d.style.display = 'none'; return d; });
      this.head = div('mw-chart-head', frag);
      if (o.head === false) this.head.style.display = 'none';
      el.insertBefore(frag, el.firstChild);
      // callouts and riders: <div data-point="2 top 30">, <div data-point="head right 24">
      this.points = [];
      for (const p of el.querySelectorAll('[data-point]')) {
        const tk = p.getAttribute('data-point').trim().split(/\s+/);
        const spec = tk[0] || 'head', side = tk.find((x, j) => j > 0 && /^(top|bottom|left|right|center|top-left|top-right|bottom-left|bottom-right)$/.test(x)) || (spec === 'head' ? 'center' : 'top');
        const gapTok = tk.slice(1).find((x) => /^-?[\d.]+(px)?$/.test(x));
        const gap = gapTok != null ? parseFloat(gapTok) : 20;
        const i = spec === 'head' ? -1 : this.index(spec);
        if (!(spec === 'head' || (i >= 0 && i < n))) continue;
        this.points.push({ el: p, i, side, gap });
        // appears when the line gets there: its data-enter delay counts from that moment
        if (i >= 0) {
          if (!p.hasAttribute('data-enter')) p.setAttribute('data-enter', 'pop 0.5');
          p.__mwEnterAt = this.reach[i];
        }
        p.style.position = 'absolute';
        p.style.margin = '0';
        p.style.right = p.style.bottom = 'auto';
        let wAuto = false; try { wAuto = String(p.computedStyleMap().get('width')) === 'auto'; } catch (e) {}
        if (wAuto) p.style.width = 'max-content';
      }
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    }
    // texts bound to the chart: data-chart-text="value|label|change" inside it, or "#growth value" anywhere
    bindTexts() {
      this.texts = [];
      for (const t of document.querySelectorAll('[data-chart-text]')) {
        const tk = t.getAttribute('data-chart-text').trim().split(/\s+/);
        let owner = null, kind = tk[tk.length - 1];
        if (tk.length > 1) { const r = document.querySelector(tk[0]); owner = r && (r.__mwChart || (r.querySelector('.mw-chart') || {}).__mwChart); }
        else { const r = t.closest('.mw-chart'); owner = r && r.__mwChart; }
        if (owner === this) this.texts.push({ el: t, kind });
      }
    }
    // measured once: the plot box in the chart's own px
    geom() {
      if (this.g !== undefined) return this.g;
      const el = this.el, hidden = [];
      for (let a = el; a; a = a.parentElement) if (a.hasAttribute && a.hasAttribute('data-mw-hidden')) { hidden.push(a); a.removeAttribute('data-mw-hidden'); }
      try {
        const W = el.offsetWidth, H = el.offsetHeight;
        if (!W || !H) { I.report('warning', 'chart-no-size', 'mw.chart.line: the chart element has no size, so nothing is drawn.', el, 'Give it a width and a height in CSS (e.g. width: 3600px; height: 1000px).'); return (this.g = null); }
        const o = this.opts, P = PX(), ax = String(o.axis ?? 'left').trim().split(/\s+/), axis = o.axis === false ? 'none' : ax[0];
        const pad = Array.isArray(o.padding) ? o.padding : o.padding != null ? [o.padding, o.padding, o.padding, o.padding] : [40, axis === 'right' ? 150 : 40, this.labels.length ? 80 : 30, axis === 'left' ? 150 : 40];
        const [pt, pr, pb, pl] = [0, 1, 2, 3].map((k) => (pad[k] ?? pad[k % 2] ?? 40) * P);
        this.g = { W, H, l: pl, t: pt, r: W - pr, b: H - pb, axis, axisGap: (parseFloat(ax[1]) || 70) * P };
        this.W0 = W; this.wStyle = el.style.width;
        if (this.ov && !this.ov.width) this.ov.width = Math.round(I.comp.width * 0.9);
        this.grad.setAttribute('y1', r2(pt)); this.grad.setAttribute('y2', r2(H - pb));
        this.makeTicks();
        // labels: every k-th one when they would touch
        if (this.labelEls.length) {
          const minW = this.ov ? Math.min(W, this.ov.width) : W;
          const step = (minW - pl - pr) / Math.max(1, this.n - 1);
          const widest = Math.max(...this.labelEls.map((d) => d.offsetWidth));
          const every = Math.max(1, Math.ceil((widest + 16 * P) / Math.max(1, step)));
          this.labelEls.forEach((d, i) => { if (i % every) d.style.display = 'none'; else d.__mwW = d.offsetWidth; });
        }
        this.bindTexts();
        return this.g;
      } finally { for (const a of hidden) a.setAttribute('data-mw-hidden', ''); }
    }
    // the plot box at time t (it only changes during the overview)
    // (extra: room the overview leaves on the right for labels that ride the head)
    box(t, extra = 0) {
      const g = this.g, ov = this.ov;
      if (!ov || t <= ov.at) return g;
      const k = ov.ease(clamp((t - ov.at) / Math.max(0.001, ov.duration)));
      const W = r2(this.W0 + (ov.width - this.W0) * k);
      return { ...g, W, r: r2(g.r - this.W0 + W - extra * k) };
    }
    X(p, g = this.g) { return g.l + (p * (g.r - g.l)) / Math.max(1, this.n - 1); }
    // grid values: fixed nice steps, or (rescaling) every 1-2-5 value that fits, fading in and out as the axis grows
    makeTicks() {
      const v = this.vals, lo = this.range(0)[0];
      const vals = [];
      if (!this.opts.rescale) {
        const [a, b] = this.range(0), step = niceStep(b - a, 4);
        for (let x = Math.ceil(a / step) * step; x <= b + 1e-9; x += step) if (Math.abs(x - lo) > step * 0.01) vals.push(Math.round(x / step) * step);
      } else {
        const top = (Math.max(...v) - lo) * 1.5 + lo, small = Math.max(1e-9, (Math.max(...v.map(Math.abs)) || 1) / 1e4);
        for (let e = Math.floor(Math.log10(small)); Math.pow(10, e) <= top * 2; e++) for (const m of [1, 2, 5]) { const x = m * Math.pow(10, e); if (x > lo && x <= top * 1.2) vals.push(x); }
      }
      this.ticks = vals.map((x) => {
        const line = document.createElementNS(SVGNS, 'line');
        this.gridG.appendChild(line);
        const lab = document.createElement('div');
        lab.className = 'mw-chart-tick';
        lab.textContent = this.tickFormat(x);
        this.tickBox.appendChild(lab);
        return { v: x, line, lab };
      });
      if (this.opts.axis === 'none' || this.opts.axis === false) this.tickBox.style.display = 'none';
    }
    point(i, t) {
      if (!this.geom()) return null;
      const g = this.box(t), [lo, hi] = this.range(t);
      return { x: r2(this.X(i, g)), y: r2(g.b - ((this.vals[i] - lo) / (hi - lo)) * (g.b - g.t)) };
    }
    // x, y (in the chart element's px), value, label and time of point i; y at time t (default: when the line gets there)
    pointAt(i, t) {
      const k = this.index(i);
      if (!isFinite(k) || k < 0 || k >= this.n) return null;
      const time = t ?? this.reach[k], p = this.point(k, time);
      return p && { ...p, value: this.vals[k], label: this.labels[k] ?? '', time: this.reach[k] };
    }

    // ---------------------------------------------------------------------------
    // One frame
    // ---------------------------------------------------------------------------
    frame(t) {
      if (!this.geom()) return false;
      let changed = false;
      const set = (el, k, v, attr) => {
        const c = el.__mwc || (el.__mwc = {});
        if (c[k] === v) return;
        c[k] = v;
        if (attr) { if (v == null) el.removeAttribute(k); else el.setAttribute(k, v); }
        else if (k.startsWith('--')) el.style.setProperty(k, v);
        else el.style[k] = v;
        changed = true;
      };
      const n = this.n, p = this.progress(t), [lo, hi] = this.range(t), P = PX(), hv = this.valueAtIndex(p);
      // bound texts first (they change sizes), then the overview's room for what rides on the right of the head
      for (const tx of this.texts) {
        const s = tx.kind === 'label' ? this.labelAt(t) : tx.kind === 'change' ? this.changeAt(t) : this.format(hv);
        if (tx.el.textContent !== s) { tx.el.textContent = s; changed = true; }
      }
      let extra = 0;
      if (this.ov && t > this.ov.at) for (const q of this.points) if (q.i < 0 && /right/.test(q.side) && q.el.offsetParent) extra = Math.max(extra, (q.gap + 12) * P * (q.side === 'right' ? 1 : 0.72) + q.el.offsetWidth);
      const g = this.box(t, extra);
      const Y = (v) => g.b - ((v - lo) / (hi - lo)) * (g.b - g.t);
      const pt = (x, v) => r2(x) + ',' + r2(Y(v));
      // the line up to p: whole segments, then the first part of the current one (de Casteljau)
      const segPath = (k, f, move) => {
        let [a, b, c, d] = this.seg(k);
        if (f < 1) { const ab = a + (b - a) * f, bc = b + (c - b) * f, cd = c + (d - c) * f, abc = ab + (bc - ab) * f, bcd = bc + (cd - bc) * f; [b, c, d] = [ab, abc, abc + (bcd - abc) * f]; }
        const x0 = this.X(k, g), dx = this.X(k + f, g) - x0;
        return (move ? 'M' + pt(x0, a) : '') + 'C' + pt(x0 + dx / 3, b) + ' ' + pt(x0 + (2 * dx) / 3, c) + ' ' + pt(x0 + dx, d);
      };
      let d = '';
      if (p > 1e-6) for (let k = 0; k < n - 1 && k < p; k++) d += segPath(k, Math.min(1, p - k), k === 0);
      set(this.line, 'd', d || null, true);
      set(this.area, 'd', d ? d + `L${r2(this.X(p, g))},${r2(g.b)}L${r2(this.X(0, g))},${r2(g.b)}Z` : null, true);
      for (const s of this.segs) { const f = clamp(p - (s.i - 1)); set(s.p, 'd', f > 1e-6 ? segPath(s.i - 1, f, true) : null, true); }
      // the chart's own size (it narrows during the overview) and the drawing's coordinates
      if (this.ov) set(this.el, 'width', g.W === this.W0 ? this.wStyle : g.W + 'px');
      set(this.svg, 'viewBox', `0 0 ${g.W} ${g.H}`, true);
      set(this.grad, 'y1', r2(g.t), true); set(this.grad, 'y2', r2(g.b), true);
      const by = r2(Y(lo));
      set(this.base, 'x1', r2(g.l), true); set(this.base, 'x2', r2(g.r), true); set(this.base, 'y1', by, true); set(this.base, 'y2', by, true);
      // grid and axis labels
      const hx = this.X(p, g), hy = Y(hv);
      for (const tk of this.ticks) {
        const f = (tk.v - lo) / (hi - lo);
        const op = this.opts.rescale ? r2(clamp((f - 0.1) / 0.08) * clamp((1.04 - f) / 0.08)) : f <= 1.0001 ? 1 : 0;
        const y = r2(Y(tk.v));
        set(tk.line, 'display', op > 0 ? '' : 'none');
        set(tk.lab, 'display', op > 0 ? '' : 'none');
        if (op <= 0) continue;
        set(tk.line, 'x1', r2(g.l), true); set(tk.line, 'x2', r2(g.r), true); set(tk.line, 'y1', y, true); set(tk.line, 'y2', y, true);
        set(tk.line, 'opacity', op === 1 ? null : String(op), true);
        set(tk.lab, 'opacity', op === 1 ? '' : String(op));
        if (g.axis === 'head') { set(tk.lab, 'left', r2(hx + g.axisGap) + 'px'); set(tk.lab, 'top', r2(y - 10 * P) + 'px'); set(tk.lab, 'translate', '0 -100%'); }
        else if (g.axis === 'right') { set(tk.lab, 'left', r2(g.r + 20 * P) + 'px'); set(tk.lab, 'top', y + 'px'); set(tk.lab, 'translate', '0 -50%'); }
        else { set(tk.lab, 'left', r2(g.l - 20 * P) + 'px'); set(tk.lab, 'top', y + 'px'); set(tk.lab, 'translate', '-100% -50%'); }
      }
      // labels and dots of the points reached so far
      for (let i = 0; i < n; i++) {
        const on = p >= i - 1e-6;
        const lab = this.labelEls[i];
        if (lab && lab.__mwW != null) { set(lab, 'data-reached', on ? '' : null, true); set(lab, 'left', r2(this.X(i, g) - lab.__mwW / 2) + 'px'); set(lab, 'top', r2(g.b + 22 * P) + 'px'); }
        const dot = this.dots[i];
        set(dot, 'data-reached', on ? '' : null, true);
        set(dot, 'left', r2(this.X(i, g)) + 'px'); set(dot, 'top', r2(Y(this.vals[i])) + 'px');
        const age = t - this.reach[i];
        const s = !on ? 0 : age >= 0.4 ? 1 : r2(mw.easing('out-back')(clamp(age / 0.4)));
        set(dot, 'scale', s === 1 ? '' : String(s));
        set(dot, 'visibility', on ? '' : 'hidden');
      }
      // the head (pops in just before the line starts) and the color of the segment it is on
      set(this.head, 'left', r2(hx) + 'px'); set(this.head, 'top', r2(hy) + 'px');
      const t0 = this.stops[0][0], hs = t0 < 0.35 ? 1 : r2(mw.easing('out-back')(clamp((t - (t0 - 0.35)) / 0.35)));
      set(this.head, 'scale', hs === 1 ? '' : String(hs));
      const ci = Math.min(n - 1, Math.ceil(p - 1e-6));
      set(this.el, '--chart-color', this.colors[ci] || 'var(--chart-line)');
      // measure and place the callouts and riders
      const plan = [];
      for (const q of this.points) {
        const e = q.el;
        if (!e.isConnected || !e.offsetParent) continue;
        let ox = 0, oy = 0;
        for (let a = e.offsetParent; a && a !== this.el; a = a.offsetParent) { ox += a.offsetLeft; oy += a.offsetTop; }
        const x = q.i < 0 ? hx : this.X(q.i, g), y = q.i < 0 ? hy : Y(this.vals[q.i]);
        const w = e.offsetWidth, h = e.offsetHeight, G = (q.gap + 12) * P, D = G * 0.72;
        const at = { top: [x - w / 2, y - G - h], bottom: [x - w / 2, y + G], left: [x - G - w, y - h / 2], right: [x + G, y - h / 2], center: [x - w / 2, y - h / 2],
          'top-right': [x + D, y - D - h], 'top-left': [x - D - w, y - D - h], 'bottom-right': [x + D, y + D], 'bottom-left': [x - D - w, y + D] }[q.side];
        plan.push([e, r2(at[0] - ox) + 'px', r2(at[1] - oy) + 'px']);
      }
      for (const [e, L, T] of plan) { set(e, 'left', L); set(e, 'top', T); }
      return changed;
    }
  }

  function update(T) {
    let changed = false;
    for (const ch of charts) {
      const el = ch.el;
      if (!el || !el.isConnected) continue;
      const c = I.nearestClip(el);
      if (c) { const vt = I.mapT(c.parent || null, T); if (vt < c.start - 1e-9 || vt >= c.end - 1e-9) continue; }
      if (ch.frame(I.mapT(el, T) - I.clipStartOf(el))) changed = true;
    }
    return changed;
  }
  // placed once at load (the state at time 0), before labels anchored to the head and camera shots measure it
  I.hooks.init.unshift(() => { for (const ch of charts) { if (!ch.el.isConnected) continue; try { ch.geom(); ch.frame(0); } catch (e) { I.pageError(e); } } });
  I.hooks.seek.push(update);

  function line(target, opts) { return new LineChart(target, opts); }
  // the chart drawn in (or inside) an element: mw.chart.get('#growth') for a chart made by the line-chart block
  function get(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    if (el.__mwChart) return el.__mwChart;
    const inner = el.querySelector && el.querySelector('.mw-chart');
    if (inner && inner.__mwChart) return inner.__mwChart;
    const outer = el.closest && el.closest('.mw-chart');
    return (outer && outer.__mwChart) || null;
  }
  mw.chart = { line, get };
})();
