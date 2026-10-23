/* motionwright audio analysis: mw.audio(src) gives loudness, frequency bands, beats and
 * waveform for any moment, so visuals can react to music and voice. MIT License.
 */
(function () {
  'use strict';
  const mw = window.mw;
  if (!mw || !mw.__internal || mw.audio) return;
  const I = mw.__internal;
  const SR = 22050;
  const N = 2048; // FFT size
  const BANDS = 32;

  // ---- FFT (iterative radix-2, real input) ----
  const rev = new Uint32Array(N);
  for (let i = 0, j = 0; i < N; i++) { rev[i] = j; let bit = N >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; }
  const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N);
  function fftMag(pcm, center, out) {
    const s0 = center - N / 2;
    for (let i = 0; i < N; i++) { const k = s0 + i; re[rev[i]] = (k >= 0 && k < pcm.length ? pcm[k] : 0) * hann[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half, w = j * step;
          const tr = re[b] * cos[w] - im[b] * sin[w], ti = re[b] * sin[w] + im[b] * cos[w];
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < N / 2; i++) out[i] = Math.hypot(re[i], im[i]);
  }
  // log-spaced band edges, 40 Hz .. 10 kHz
  const edges = [];
  for (let b = 0; b <= BANDS; b++) edges.push(Math.max(1, Math.round((40 * Math.pow(10000 / 40, b / BANDS)) / (SR / N))));
  function pct(arr, p) { const a = Float32Array.from(arr).sort(); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))]; }

  function analyze(pcm, fps) {
    const hop = SR / fps;
    const frames = Math.max(1, Math.ceil(pcm.length / hop));
    const mag = new Float32Array(N / 2);
    const bandsDb = new Float32Array(frames * BANDS);
    const rmsDb = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const c = Math.round(f * hop);
      fftMag(pcm, c, mag);
      for (let b = 0; b < BANDS; b++) {
        let s = 0, n = 0;
        for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) { s += mag[k] * mag[k]; n++; }
        bandsDb[f * BANDS + b] = 10 * Math.log10(s / Math.max(1, n) + 1e-12);
      }
      let e = 0;
      const a = Math.max(0, Math.round(c - hop / 2)), z = Math.min(pcm.length, Math.round(c + hop / 2));
      for (let i = a; i < z; i++) e += pcm[i] * pcm[i];
      rmsDb[f] = 10 * Math.log10(e / Math.max(1, z - a) + 1e-12);
    }
    // Normalize: each band to its own loud level, all against a common floor (lively but honest)
    const floor = pct(bandsDb, 0.1);
    const bands = new Float32Array(frames * BANDS);
    for (let b = 0; b < BANDS; b++) {
      const col = new Float32Array(frames);
      for (let f = 0; f < frames; f++) col[f] = bandsDb[f * BANDS + b];
      const ceil = Math.max(pct(col, 0.97), floor + 12);
      for (let f = 0; f < frames; f++) bands[f * BANDS + b] = Math.max(0, Math.min(1, (bandsDb[f * BANDS + b] - floor) / (ceil - floor)));
    }
    const rTop = pct(rmsDb, 0.99), rFloor = Math.max(pct(rmsDb, 0.05), rTop - 50);
    const level = new Float32Array(frames);
    for (let f = 0; f < frames; f++) level[f] = Math.max(0, Math.min(1, (rmsDb[f] - rFloor) / Math.max(1, rTop - rFloor)));
    // Smoothed versions: fast attack, slower release (how meters move)
    const smooth = (src, stride = 1, off = 0, rel = 0.18) => {
      const out = new Float32Array(frames);
      const k = Math.exp(-1 / (rel * fps));
      let v = 0;
      for (let f = 0; f < frames; f++) { const x = src[f * stride + off]; v = x > v ? x : v * k + x * (1 - k); out[f] = v; }
      return out;
    };
    const levelS = smooth(level);
    const group = (b0, b1) => { const g = new Float32Array(frames); for (let f = 0; f < frames; f++) { let s = 0; for (let b = b0; b < b1; b++) s += bands[f * BANDS + b]; g[f] = s / (b1 - b0); } return smooth(g, 1, 0, 0.15); };
    const bass = group(0, 8), mid = group(8, 22), treble = group(22, BANDS);
    // Onsets from spectral flux (low bands count more: kicks and snares drive edits)
    const flux = new Float32Array(frames);
    for (let f = 1; f < frames; f++) {
      let s = 0;
      for (let b = 0; b < BANDS; b++) { const d = bands[f * BANDS + b] - bands[(f - 1) * BANDS + b]; if (d > 0) s += d * (b < 8 ? 2 : 1); }
      flux[f] = s;
    }
    const fmax = Math.max(1e-6, pct(flux, 0.995));
    for (let f = 0; f < frames; f++) flux[f] = Math.min(1, flux[f] / fmax);
    const onsets = [];
    const W = Math.max(2, Math.round(fps * 0.25)), minGap = Math.round(fps * 0.1);
    let lastOn = -1e9;
    for (let f = 1; f < frames - 1; f++) {
      let m = 0, n = 0;
      for (let k = Math.max(0, f - W); k <= Math.min(frames - 1, f + W); k++) { m += flux[k]; n++; }
      const thr = (m / n) * 1.5 + 0.08;
      if (flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1] && f - lastOn >= minGap) { onsets.push({ time: f / fps, strength: flux[f] }); lastOn = f; }
    }
    // Tempo: autocorrelation of the flux, 70-180 BPM, gently preferring ~120
    let bestLag = 0, bestScore = -1;
    const lo = Math.round((fps * 60) / 180), hi = Math.round((fps * 60) / 70);
    for (let lag = lo; lag <= hi; lag++) {
      let s = 0;
      for (let f = lag; f < frames; f++) s += flux[f] * flux[f - lag];
      const bpm = (60 * fps) / lag;
      s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    let bpm = 0, beats = [];
    if (bestLag && onsets.length >= 4) {
      // refine the period with sub-frame precision from onset spacing
      const period = bestLag / fps;
      let bestPh = 0, bestPs = -1;
      for (let ph = 0; ph < bestLag; ph++) { let s = 0; for (let f = ph; f < frames; f += bestLag) s += flux[f]; if (s > bestPs) { bestPs = s; bestPh = ph; } }
      bpm = Math.round((60 / period) * 10) / 10;
      for (let t = bestPh / fps; t < frames / fps; t += period) beats.push(Math.round(t * 1000) / 1000);
    }
    return { fps, frames, duration: pcm.length / SR, level, levelS, bands, bass, mid, treble, onsets, beats, bpm };
  }

  async function loadPCM(src) {
    const u = new URL(src, location.href);
    try {
      const r = await fetch('/__mw/pcm?sr=' + SR + '&src=' + encodeURIComponent(u.pathname + u.search));
      if (r.ok) return new Float32Array(await r.arrayBuffer());
    } catch (e) {}
    // No motionwright server (standalone page): decode in the browser
    const buf = await (await fetch(u.href)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, SR, SR);
    const ab = await ctx.decodeAudioData(buf);
    const len = Math.ceil(ab.duration * SR);
    const off = new OfflineAudioContext(1, len, SR);
    const s = off.createBufferSource(); s.buffer = ab; s.connect(off.destination); s.start();
    return (await off.startRendering()).getChannelData(0);
  }

  const handles = new Map();
  function audio(spec, opts = {}) {
    let el = null, src = spec;
    if (spec instanceof Element) el = spec;
    else if (typeof spec === 'string' && /^[#.\[]|^audio|^video/.test(spec)) el = document.querySelector(spec);
    if (el) src = el.currentSrc || el.getAttribute('src') || (el.querySelector('source') && el.querySelector('source').getAttribute('src'));
    const key = (el ? 'el:' : 'src:') + src;
    if (handles.has(key)) return handles.get(key);
    const h = {
      src, el, ready: false, data: null, pcm: null,
      // composition time → seconds into the audio file (null when it is not playing)
      fileTime(T) {
        T = T ?? I.now;
        if (!h.el) return T - (opts.start || 0);
        const c = I.nearestClip(h.el);
        const start = c ? c.start : 0, end = c ? c.end : I.comp.duration;
        if (T < start || T >= end) return null;
        const from = I.parseTime(h.el.getAttribute('data-from') ?? h.el.getAttribute('data-trim'), h.el, 'data-from') || 0;
        const rate = parseFloat(h.el.getAttribute('data-rate') || '1') || 1;
        let ft = (T - start) * rate + from;
        if (h.el.hasAttribute('loop') && h.data && h.data.duration > from) ft = from + ((ft - from) % (h.data.duration - from));
        return ft;
      },
      _frame(T) { const ft = h.fileTime(T); if (ft == null || !h.data || ft < 0) return -1; const f = Math.round(ft * h.data.fps); return f < h.data.frames ? f : -1; },
      /** Loudness 0..1 (smoothed like a meter; {raw:true} for the instant value). */
      level(T, o = {}) { const f = h._frame(T); return f < 0 ? 0 : (o.raw ? h.data.level : h.data.levelS)[f]; },
      bass(T) { const f = h._frame(T); return f < 0 ? 0 : h.data.bass[f]; },
      mid(T) { const f = h._frame(T); return f < 0 ? 0 : h.data.mid[f]; },
      treble(T) { const f = h._frame(T); return f < 0 ? 0 : h.data.treble[f]; },
      /** Frequency bands 0..1, low to high. n = how many (default 32). */
      bands(T, n = BANDS) {
        const f = h._frame(T), out = new Array(n).fill(0);
        if (f < 0) return out;
        for (let i = 0; i < n; i++) { const a = Math.floor((i * BANDS) / n), b = Math.max(a + 1, Math.floor(((i + 1) * BANDS) / n)); let s = 0; for (let k = a; k < b; k++) s += h.data.bands[f * BANDS + k]; out[i] = s / (b - a); }
        return out;
      },
      /** n waveform samples (-1..1) around this moment, for oscilloscope lines. */
      wave(T, n = 128, span = 0.04) {
        const ft = h.fileTime(T), out = new Array(n).fill(0);
        if (ft == null || !h.pcm) return out;
        const c = ft * SR, w = span * SR;
        for (let i = 0; i < n; i++) { const k = Math.round(c - w / 2 + (i / (n - 1)) * w); out[i] = k >= 0 && k < h.pcm.length ? h.pcm[k] : 0; }
        return out;
      },
      /** Beat times (seconds, composition time) */
      get beats() { return h._toComp(h.data ? h.data.beats : []); },
      get onsets() { return h._toComp(h.data ? h.data.onsets.map((o) => o.time) : []); },
      get bpm() { return h.data ? h.data.bpm : 0; },
      get duration() { return h.data ? h.data.duration : 0; },
      _toComp(list) {
        if (!h.el) return list.map((t) => t + (opts.start || 0));
        const c = I.nearestClip(h.el); const start = c ? c.start : 0, end = c ? c.end : I.comp.duration;
        const from = I.parseTime(h.el.getAttribute('data-from'), h.el, 'data-from') || 0, rate = parseFloat(h.el.getAttribute('data-rate') || '1') || 1;
        return list.map((t) => start + (t - from) / rate).filter((t) => t >= start && t < end);
      },
      /** 1 right on a beat, falling to 0 (decay seconds). Great for pulses: scale = 1 + 0.1 * music.beat(t) */
      beat(T, decay = 0.25, which = 'beats') {
        T = T ?? I.now;
        const list = which === 'onsets' ? h.onsets : h.beats;
        let lo = 0, hi = list.length - 1, last = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= T + 1e-6) { last = m; lo = m + 1; } else hi = m - 1; }
        if (last < 0) return 0;
        return Math.exp(-(T - list[last]) / Math.max(0.01, decay));
      },
      onset(T, decay = 0.2) { return h.beat(T, decay, 'onsets'); },
      /** index of the current beat (for cutting on the beat) */
      beatIndex(T) { const list = h.beats; let i = -1; for (const b of list) { if (b <= T + 1e-6) i++; else break; } return i; },
    };
    h.loaded = (async () => {
      try {
        h.pcm = await loadPCM(src);
        h.data = analyze(h.pcm, I.comp.fps);
        h.ready = true;
      } catch (e) { I.report('error', 'audio-analysis', `Could not analyze audio ${src}: ${e && e.message || e}`, el, 'Check the file path. Any format ffmpeg can read works.'); }
    })();
    mw.wait(h.loaded);
    handles.set(key, h);
    return h;
  }
  mw.audio = audio;
})();
