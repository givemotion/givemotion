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

  // Onsets, tempo and a beat grid fitted to the real hits.
  const NF = 1024, HOP = 256;
  const hannF = new Float32Array(NF);
  for (let i = 0; i < NF; i++) hannF[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NF - 1));
  const revF = new Uint32Array(NF);
  for (let i = 0, j = 0; i < NF; i++) { revF[i] = j; let bit = NF >> 1; while (j & bit) { j ^= bit; bit >>= 1; } j |= bit; }
  const cosF = new Float32Array(NF / 2), sinF = new Float32Array(NF / 2);
  for (let i = 0; i < NF / 2; i++) { cosF[i] = Math.cos((2 * Math.PI * i) / NF); sinF[i] = -Math.sin((2 * Math.PI * i) / NF); }
  function fftSmall(pcm, center, out) {
    const r = new Float32Array(NF), m = new Float32Array(NF);
    const s0 = center - NF / 2;
    for (let i = 0; i < NF; i++) { const k = s0 + i; r[revF[i]] = (k >= 0 && k < pcm.length ? pcm[k] : 0) * hannF[i]; }
    for (let size = 2; size <= NF; size <<= 1) {
      const half = size >> 1, step = NF / size;
      for (let i = 0; i < NF; i += size) for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half, w = j * step;
        const tr = r[b] * cosF[w] - m[b] * sinF[w], ti = r[b] * sinF[w] + m[b] * cosF[w];
        r[b] = r[a] - tr; m[b] = m[a] - ti; r[a] += tr; m[a] += ti;
      }
    }
    for (let i = 0; i < NF / 2; i++) out[i] = Math.log1p(10 * Math.hypot(r[i], m[i]));
  }
  function beatAnalysis(pcm) {
    const n = Math.max(2, Math.ceil(pcm.length / HOP));
    const dt = HOP / SR;
    const flux = new Float32Array(n), low = new Float32Array(n);
    let prev = new Float32Array(NF / 2), cur = new Float32Array(NF / 2);
    const lowBin = Math.round(200 / (SR / NF));
    for (let f = 0; f < n; f++) {
      fftSmall(pcm, f * HOP, cur);
      let s = 0, sl = 0;
      for (let k = 1; k < NF / 2; k++) { const d = cur[k] - prev[k]; if (d > 0) { const w = k <= lowBin ? 3 : 1; s += d * w; if (k <= lowBin) sl += d; } }
      flux[f] = f ? s : 0; low[f] = f ? sl : 0;
      const t = prev; prev = cur; cur = t;
    }
    // onsets: peaks above a local average
    const W = Math.round(0.3 / dt), gap = Math.round(0.08 / dt);
    let fmax = 0; for (const v of flux) if (v > fmax) fmax = v;
    const onsets = [];
    let last = -1e9;
    for (let f = 2; f < n - 2; f++) {
      let m = 0, c = 0;
      for (let k = Math.max(0, f - W); k <= Math.min(n - 1, f + W); k++) { m += flux[k]; c++; }
      const thr = (m / c) * 1.35 + fmax * 0.04;
      if (flux[f] > thr && flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && f - last >= gap) {
        // sub-step accuracy (parabola through the peak); the hit starts a little before the flux peak
        const a = flux[f - 1], b = flux[f], d = flux[f + 1];
        const off = (a - d) / (2 * (a - 2 * b + d) || 1);
        onsets.push({ time: Math.max(0, (f + Math.max(-0.5, Math.min(0.5, off))) * dt - dt * 0.5), strength: flux[f] / (fmax || 1), low: low[f] });
        last = f;
      }
    }
    if (onsets.length < 4) return { onsets, beats: [], bpm: 0, downbeats: [] };
    // tempo from autocorrelation of the flux (70-180 BPM, gentle preference for 90-140)
    const mean = flux.reduce((x, y) => x + y, 0) / n;
    const lo = Math.round(60 / 180 / dt), hi = Math.round(60 / 70 / dt);
    let bestLag = lo, bestScore = -Infinity;
    for (let lag = lo; lag <= hi; lag++) {
      let sc = 0;
      for (let f = lag; f < n; f++) sc += (flux[f] - mean) * (flux[f - lag] - mean);
      const bpmL = 60 / (lag * dt);
      sc *= Math.exp(-0.5 * Math.pow(Math.log2(bpmL / 115) / 0.9, 2));
      if (sc > bestScore) { bestScore = sc; bestLag = lag; }
    }
    // fit period and phase to the strong onsets
    // Beats sit on the kick drum: weight each hit by how much low end it has.
    let lowMax = 0; for (const o of onsets) lowMax = Math.max(lowMax, o.low);
    for (const o of onsets) o.w = o.strength * (0.05 + (lowMax ? o.low / lowMax : 0));
    const strong = onsets.filter((o) => o.strength >= 0.25);
    const fitSet = strong.length >= 4 ? strong : onsets;
    const P0 = bestLag * dt;
    let best = { score: -1, P: P0, ph: 0 };
    for (let P = P0 * 0.97; P <= P0 * 1.03; P += 0.0004) {
      for (let ph = 0; ph < P; ph += 0.002) {
        let sc = 0;
        for (const o of fitSet) { const x = ((((o.time - ph) / P) % 1) + 1) % 1; const d = Math.min(x, 1 - x) * P; sc += o.w * Math.exp(-((d / 0.025) ** 2)); }
        if (sc > best.score) best = { score: sc, P, ph };
      }
    }
    const P = best.P, dur = pcm.length / SR;
    let first = best.ph % P;
    // start the grid at the first real hit near a grid line
    const firstHit = fitSet.find((o) => { const x = ((((o.time - first) / P) % 1) + 1) % 1; return Math.min(x, 1 - x) * P < 0.04 && o.w >= 0.3 * Math.max(...fitSet.map((q) => q.w)); });
    if (firstHit) first = firstHit.time - Math.round((firstHit.time - first) / P) * P;
    while (first - P >= -0.01) first -= P;
    if (first < 0) first += P;
    const beats = [];
    for (let t = first; t < dur; t += P) beats.push(Math.round(t * 1000) / 1000);
    // downbeats: the beat position (of 4) where the low end hits hardest
    const acc = [0, 0, 0, 0];
    beats.forEach((b, i) => { for (const o of onsets) if (Math.abs(o.time - b) < 0.04) acc[i % 4] += o.low; });
    const db = acc.indexOf(Math.max(...acc));
    const downbeats = beats.filter((_, i) => i % 4 === db);
    return { onsets: onsets.map((o) => ({ time: Math.round(o.time * 1000) / 1000, strength: Math.round(o.strength * 1000) / 1000, bass: lowMax ? Math.round((o.low / lowMax) * 1000) / 1000 : 0 })), beats, bpm: Math.round((60 / P) * 10) / 10, downbeats };
  }

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
    // Beats and onsets come from a finer analysis (11.6 ms steps), so cuts can land on the hit.
    const fine = beatAnalysis(pcm);
    const { onsets, beats, bpm, downbeats } = fine;
    return { fps, frames, duration: pcm.length / SR, level, levelS, bands, bass, mid, treble, onsets, beats, bpm, downbeats };
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
  // "#music", "audio", ".track" are selectors; anything with a slash or a file extension is a file.
  const looksLikeFile = (x) => /[\/\\]/.test(x) || /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4|mov|m4v|mkv)(\?|#|$)/i.test(x);
  function audio(spec, opts = {}) {
    const key = spec instanceof Element ? spec : String(spec);
    if (handles.has(key)) return handles.get(key);
    if (I.initialized) I.report('warning', 'audio-late', 'mw.audio() was called after the video started, so its data may be missing in the first frames.', null, 'Call mw.audio(...) once at the top level of your script (or useAudio in React), not inside onFrame.');
    const h = {
      src: null, el: null, isReady: false, data: null, pcm: null,
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
      /** Beat times in composition seconds (only while the audio plays in the video). */
      get beats() { return h._toComp(h.data ? h.data.beats : []); },
      /** First beat of every bar (every 4 beats, on the strongest low hit). */
      get downbeats() { return h._toComp(h.data ? h.data.downbeats : []); },
      /** Every hit (drums, notes) as composition times. */
      get onsets() { return h._toComp(h.data ? h.data.onsets.map((o) => o.time) : []); },
      get bpm() { return h.data ? h.data.bpm : 0; },
      get duration() { return h.data ? h.data.duration : 0; },
      /** Time of beat n (0-based), or of beat n counted from the first downbeat with {bar:true}. */
      beatAt(n) { const b = h.beats; return b[Math.max(0, Math.min(b.length - 1, n))] ?? 0; },
      _toComp(list) {
        if (!h.el) return list.map((t) => t + (opts.start || 0));
        const c = I.nearestClip(h.el); const start = c ? c.start : 0, end = c ? c.end : I.comp.duration;
        const from = I.parseTime(h.el.getAttribute('data-from'), h.el, 'data-from') || 0, rate = parseFloat(h.el.getAttribute('data-rate') || '1') || 1;
        return list.map((t) => start + (t - from) / rate).filter((t) => t >= start && t < end);
      },
      /** 1 right on a beat, falling to 0 (decay seconds). Great for pulses: scale = 1 + 0.1 * music.beat(t) */
      beat(T, decay = 0.25, which = 'beats') {
        T = T ?? I.now;
        const list = which === 'onsets' ? h.onsets : which === 'downbeats' ? h.downbeats : h.beats;
        let lo = 0, hi = list.length - 1, last = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= T + 1e-6) { last = m; lo = m + 1; } else hi = m - 1; }
        if (last < 0) return 0;
        return Math.exp(-(T - list[last]) / Math.max(0.01, decay));
      },
      onset(T, decay = 0.2) { return h.beat(T, decay, 'onsets'); },
      /** index of the current beat (for cutting on the beat) */
      beatIndex(T) { const list = h.beats; let i = -1; for (const b of list) { if (b <= T + 1e-6) i++; else break; } return i; },
    };
    // Resolve the element/file once the page (and React) has rendered.
    const resolve = () => {
      if (spec instanceof Element) h.el = spec;
      else if (typeof spec === 'string' && !looksLikeFile(spec)) { try { h.el = document.querySelector(spec); } catch (e) { h.el = null; } }
      if (h.el) h.src = h.el.currentSrc || h.el.getAttribute('src') || (h.el.querySelector('source') && h.el.querySelector('source').getAttribute('src'));
      else if (typeof spec === 'string' && looksLikeFile(spec)) {
        h.src = spec;
        // use the matching <audio> element's timing if there is one
        for (const a of document.querySelectorAll('audio,video')) { const s2 = a.getAttribute('src'); if (s2 && new URL(s2, location.href).href === new URL(spec, location.href).href) { h.el = a; break; } }
      }
    };
    const waitDom = () => new Promise((r) => { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => r(), { once: true }); else I.real.setTimeout(r, 0); });
    h.ready = (async () => {
      await waitDom();
      resolve();
      if (!h.src) { I.report('error', 'audio-not-found', `mw.audio("${spec}") found no <audio> element or file.`, null, 'Pass a file path ("music.mp3") or the selector of an <audio> element ("#music").'); return h; }
      try {
        h.pcm = await loadPCM(h.src);
        h.data = analyze(h.pcm, I.comp.fps);
        h.isReady = true;
        if (!h.data.bpm) I.report('warning', 'audio-no-beats', `No steady beat found in ${h.src}; music.beats is empty (onsets still work).`, h.el);
      } catch (e) { I.report('error', 'audio-analysis', `Could not analyze audio ${h.src}: ${e && e.message || e}`, h.el, 'Check the file path (relative to the page). Any format ffmpeg can read works.'); }
      return h;
    })();
    h.loaded = h.ready;
    mw.wait(h.ready);
    handles.set(key, h);
    return h;
  }
  mw.audio = audio;
})();
