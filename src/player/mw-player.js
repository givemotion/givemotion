/* <mw-player>: play a motionwright composition inside any web page, with controls and sound.
 * MIT License. No dependencies.
 *
 *   <script src="mw-player.js"></script>
 *   <mw-player src="video/index.html" controls autoplay loop muted></mw-player>
 *
 * src must be a page made with `motionwright bundle` (or served by `motionwright dev`).
 * Attributes: src, controls, autoplay, loop, muted, rate, data (JSON for mw.data / data-bind)
 * Methods: play(), pause(), seekTo(seconds), toggle(). Properties: currentTime, duration, paused, info
 * Events: ready, play, pause, timeupdate, ended
 */
(function () {
  if (customElements.get('mw-player')) return;
  const CSS = `
:host{display:block;position:relative;background:#000;overflow:hidden;border-radius:inherit;font:13px/1.2 system-ui,sans-serif;color:#fff;user-select:none;-webkit-user-select:none}
.box{position:relative;width:100%}
iframe{position:absolute;left:0;top:0;border:0;transform-origin:0 0;pointer-events:none;background:transparent}
.bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:10px;padding:10px 12px;background:linear-gradient(transparent,rgba(0,0,0,.65));opacity:0;transition:opacity .2s}
:host(:hover) .bar,.bar.show{opacity:1}
button{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:6px}
button:hover{background:rgba(255,255,255,.15)}
svg{width:18px;height:18px;fill:currentColor}
input[type=range]{flex:1;accent-color:#fff;height:4px;cursor:pointer}
.time{font-variant-numeric:tabular-nums;opacity:.9;min-width:86px;text-align:right}
.big{position:absolute;inset:0;display:grid;place-items:center;cursor:pointer}
.big div{width:68px;height:68px;border-radius:50%;background:rgba(0,0,0,.45);display:grid;place-items:center;backdrop-filter:blur(6px)}
.big svg{width:30px;height:30px}
.hidden{display:none!important}
.err{position:absolute;inset:0;display:grid;place-items:center;padding:20px;text-align:center;background:#111;color:#f88}`;
  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9zm15.6 3 2.2-2.2-1.4-1.4-2.2 2.2-2.2-2.2-1.4 1.4 2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4z"/></svg>',
    full: '<svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 4v-4h2v6h-6v-2z"/></svg>',
  };
  const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };

  class MwPlayer extends HTMLElement {
    static get observedAttributes() { return ['src', 'controls', 'muted', 'data', 'rate']; }
    constructor() {
      super();
      const r = this.attachShadow({ mode: 'open' });
      r.innerHTML = `<style>${CSS}</style><div class="box"><iframe allow="autoplay"></iframe><div class="big hidden"><div>${ICON.play}</div></div>
        <div class="bar hidden"><button class="pp" aria-label="Play">${ICON.play}</button><input type="range" min="0" max="1000" value="0" aria-label="Seek"><span class="time">0:00 / 0:00</span><button class="mu" aria-label="Mute">${ICON.vol}</button><button class="fs" aria-label="Full screen">${ICON.full}</button></div></div>`;
      this.$ = (s) => r.querySelector(s);
      this._t = 0; this._paused = true; this.info = null; this._busy = false; this._seq = 0; this._wait = new Map();
      this._onMsg = (e) => { const m = e.data; if (m && m.mwReply != null && this._wait.has(m.mwReply) && e.source === this.$('iframe').contentWindow) { this._wait.get(m.mwReply)(m); this._wait.delete(m.mwReply); } };
      this.$('.pp').onclick = () => this.toggle();
      this.$('.big').onclick = () => this.play();
      this.$('.mu').onclick = () => { this.muted = !this.muted; };
      this.$('.fs').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : this.requestFullscreen && this.requestFullscreen());
      const rg = this.$('input');
      rg.oninput = () => { this._scrubbing = true; if (this.info) this.seekTo((rg.value / 1000) * this.info.duration); };
      rg.onchange = () => { this._scrubbing = false; };
      this.addEventListener('keydown', (e) => { if (e.key === ' ') { e.preventDefault(); this.toggle(); } });
    }
    connectedCallback() {
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;
      window.addEventListener('message', this._onMsg);
      this._ro = new ResizeObserver(() => this._fit());
      this._ro.observe(this);
      if (!this._loaded) this._load();
    }
    disconnectedCallback() { window.removeEventListener('message', this._onMsg); this._ro && this._ro.disconnect(); this.pause(); }
    attributeChangedCallback(n, a, b) {
      if (a === b) return;
      if ((n === 'src' || n === 'data') && this.isConnected) this._load();
      if (n === 'controls') this.$('.bar').classList.toggle('hidden', !this.hasAttribute('controls'));
      if (n === 'muted') { this.$('.mu').innerHTML = this.muted ? ICON.mute : ICON.vol; this._media(); }
    }
    get muted() { return this.hasAttribute('muted'); }
    set muted(v) { this.toggleAttribute('muted', !!v); }
    get rate() { return parseFloat(this.getAttribute('rate')) || 1; }
    get currentTime() { return this._t; }
    set currentTime(v) { this.seekTo(v); }
    get duration() { return this.info ? this.info.duration : 0; }
    get paused() { return this._paused; }
    _call(msg) {
      const id = ++this._seq;
      return new Promise((res) => { this._wait.set(id, res); this.$('iframe').contentWindow.postMessage(Object.assign({ id }, msg), '*'); setTimeout(() => { if (this._wait.has(id)) { this._wait.delete(id); res({ timeout: true }); } }, 15000); });
    }
    _load() {
      this._loaded = true;
      this.pause();
      const f = this.$('iframe');
      let src = this.getAttribute('src') || '';
      const data = this.getAttribute('data');
      if (data) src += (src.includes('#') ? '&' : '#') + 'mw-data=' + encodeURIComponent(data);
      f.onload = async () => {
        const r = await this._call({ mw: 'ready' });
        if (!r.info) { this._error('Could not start the composition. Make it with `motionwright bundle`.'); return; }
        this.info = r.info;
        this._fit();
        this.$('.bar').classList.toggle('hidden', !this.hasAttribute('controls'));
        await this.seekTo(0);
        this.dispatchEvent(new Event('ready'));
        if (this.hasAttribute('autoplay')) this.play(); else this.$('.big').classList.toggle('hidden', !this.hasAttribute('controls'));
      };
      f.src = src;
    }
    _error(msg) { const d = document.createElement('div'); d.className = 'err'; d.textContent = msg; this.shadowRoot.querySelector('.box').appendChild(d); }
    _fit() {
      if (!this.info) return;
      const { width: W, height: H } = this.info;
      const box = this.$('.box');
      box.style.aspectRatio = W + ' / ' + H;
      const f = this.$('iframe');
      f.style.width = W + 'px'; f.style.height = H + 'px';
      f.style.transform = `scale(${box.clientWidth / W})`;
    }
    _ui() {
      if (!this.info) return;
      if (!this._scrubbing) this.$('input').value = String(Math.round((this._t / this.info.duration) * 1000));
      this.$('.time').textContent = fmt(this._t) + ' / ' + fmt(this.info.duration);
      this.$('.pp').innerHTML = this._paused ? ICON.play : ICON.pause;
    }
    _media() { if (this.info) this._call({ mw: 'media', playing: !this._paused, t: this._t, muted: this.muted, rate: this.rate }); }
    async seekTo(t) {
      if (!this.info) return;
      const fps = this.info.fps, D = this.info.duration;
      t = Math.max(0, Math.min(D - 1 / fps, Math.round(t * fps) / fps));
      this._t = t;
      if (!this._paused) { this._t0 = t; this._p0 = performance.now(); }
      if (this._busy) { this._pending = t; return; }
      this._busy = true;
      await this._call({ mw: 'seek', t, playing: this._paused ? false : undefined, muted: this.muted, rate: this.rate });
      this._busy = false;
      this._ui();
      this.dispatchEvent(new Event('timeupdate'));
      if (this._pending != null) { const p = this._pending; this._pending = null; return this.seekTo(p); }
    }
    play() {
      if (!this.info || !this._paused) return;
      if (this._t >= this.info.duration - 1.5 / this.info.fps) this._t = 0;
      this._paused = false; this._t0 = this._t; this._p0 = performance.now();
      this.$('.big').classList.add('hidden');
      this._call({ mw: 'media', playing: true, t: this._t, muted: this.muted, rate: this.rate });
      let lastSync = 0;
      const step = async () => {
        if (this._paused) return;
        let x = this._t0 + ((performance.now() - this._p0) / 1000) * this.rate;
        if (x >= this.info.duration) {
          if (this.hasAttribute('loop')) { this._t0 = 0; this._p0 = performance.now(); x = 0; lastSync = 0; }
          else { this.pause(); this._t = this.info.duration; this._ui(); this.dispatchEvent(new Event('ended')); return; }
        }
        if (!this._busy) {
          this._busy = true;
          const now = performance.now();
          const sync = now - lastSync > 250;
          if (sync) lastSync = now;
          this._t = Math.round(x * this.info.fps) / this.info.fps;
          await this._call({ mw: 'seek', t: this._t, playing: sync ? true : undefined, muted: this.muted, rate: this.rate });
          this._busy = false;
          this._ui();
          this.dispatchEvent(new Event('timeupdate'));
        }
        this._raf = requestAnimationFrame(step);
      };
      this._raf = requestAnimationFrame(step);
      this._ui();
      this.dispatchEvent(new Event('play'));
    }
    pause() {
      if (this._paused) return;
      this._paused = true;
      cancelAnimationFrame(this._raf);
      this._media();
      this._ui();
      this.dispatchEvent(new Event('pause'));
    }
    toggle() { this._paused ? this.play() : this.pause(); }
  }
  customElements.define('mw-player', MwPlayer);
})();
