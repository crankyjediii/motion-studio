/*
 * Motion Studio stage runtime.
 * Turns a page of CSS animations / Web Animations into a deterministic, seekable timeline:
 * every frame is produced by seek(t), so preview and render are identical.
 * See skills/studio/references/composition.md for the authoring contract.
 */
(() => {
  const html = document.documentElement;
  const q = new URLSearchParams(location.search);
  const FORMATS = { horizontal: [1920, 1080], vertical: [1080, 1920], square: [1080, 1080] };
  // Title-safe insets as fractions: top, right, bottom, left. Vertical leaves room for platform UI.
  const SAFE = { horizontal: [0.05, 0.05, 0.05, 0.05], vertical: [0.1, 0.06, 0.14, 0.06], square: [0.06, 0.06, 0.06, 0.06] };
  const MIN_TEXT = { horizontal: 28, vertical: 34, square: 30 };

  const format = FORMATS[q.get('format')] ? q.get('format') : 'horizontal';
  const [W, H] = FORMATS[format];
  const rendering = q.has('render');
  const solo = q.get('solo'); // scene id, "__under" or "__over": isolates one layer for editable-timeline export
  const embedded = window.parent !== window;

  html.dataset.format = format;
  html.dataset.disclosure = q.get('disclosure') === 'report-only' || (!q.has('disclosure') && html.dataset.disclosure === 'report-only') ? 'report-only' : 'label';
  if (rendering) html.dataset.render = '';
  if (solo) html.dataset.solo = solo;
  html.style.setProperty('--w', W + 'px');
  html.style.setProperty('--h', H + 'px');
  html.style.setProperty('--u', Math.min(W, H) / 100 + 'px');

  const frameHooks = [];
  const sceneHooks = new Map();
  let stage, scenes = [], duration = 0, fps = 30, now = 0, playing = false;

  window.Studio = {
    format, width: W, height: H,
    /** fn(t, { duration, fps, format }) runs on every frame. May be async. */
    onFrame(fn) { frameHooks.push(fn); },
    /** fn(localTime, progress01, sceneEl) runs on every frame while the scene is on screen. */
    scene(id, fn) { sceneHooks.set(id, [...(sceneHooks.get(id) || []), fn]); },
    clamp: (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)),
    /** Map v from [a,b] to 0..1, clamped. */
    range: (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a))),
    ease: {
      outCubic: (p) => 1 - (1 - p) ** 3,
      outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
      inOutCubic: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    },
  };

  /** data-split="words|chars": wraps text in spans carrying --i for staggered CSS animation. */
  function splitText(el) {
    const chars = el.dataset.split === 'chars';
    el.setAttribute('aria-label', el.textContent.trim());
    let wi = 0, ci = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.append(' '); continue; }
        const word = document.createElement('span');
        word.className = 'wd';
        word.style.setProperty('--i', chars ? ci : wi);
        wi++;
        if (chars) {
          for (const ch of part) {
            const c = document.createElement('span');
            c.className = 'ch';
            c.style.setProperty('--i', ci++);
            c.textContent = ch;
            word.append(c);
          }
        } else word.textContent = part;
        frag.append(word);
      }
      node.replaceWith(frag);
    }
  }

  function init() {
    stage = document.getElementById('stage');
    if (!stage) throw new Error('Composition needs <main id="stage">.');
    stage.querySelectorAll('[data-split]').forEach(splitText);

    let cursor = 0, seenScene = false;
    for (const el of stage.children) {
      if (!el.classList.contains('scene')) {
        // Persistent layers: below the scenes if they come first in the DOM, above otherwise.
        if (solo) el.style.visibility = solo === (seenScene ? '__over' : '__under') ? '' : 'hidden';
        continue;
      }
      seenScene = true;
      if (el.dataset.provenance === 'illustrative' && (el.hasAttribute('data-ui') || el.querySelector('[data-ui]')) && !el.dataset.disclose) el.dataset.disclose = 'Illustrative interface';
      const dur = parseFloat(el.dataset.dur) || 2;
      const ms = (v) => Math.round(v * 1000) / 1000;
      const start = ms(el.dataset.start != null ? parseFloat(el.dataset.start) : Math.max(0, cursor - (parseFloat(el.dataset.overlap) || 0)));
      cursor = ms(start + dur);
      if (!el.id) el.id = 'scene-' + (scenes.length + 1);
      scenes.push({
        el, id: el.id, start, dur, end: cursor,
        label: el.dataset.label || el.id,
        provenance: el.dataset.provenance || 'unspecified',
        ui: !!el.querySelector('[data-ui]') || el.hasAttribute('data-ui'),
      });
    }
    duration = parseFloat(html.dataset.duration) || cursor;
    fps = parseFloat(html.dataset.fps) || 30;
  }

  const isOn = (s, t) => (t >= s.start && t < s.end) || (t >= duration && s.end >= duration);

  async function seek(t, opts = {}) {
    t = Math.min(duration, Math.max(0, t));
    now = t;
    const startOf = new Map();
    for (const s of scenes) {
      const on = isOn(s, t) && (!solo || solo === s.id);
      s.el.classList.toggle('on', on);
      startOf.set(s.el, s.start);
    }
    // Scene-local clocks: an animation inside a scene starts counting when the scene starts.
    for (const a of document.getAnimations()) {
      const target = a.effect && a.effect.target;
      const sceneEl = target && target.closest && target.closest('.scene');
      if (a.playState !== 'paused') a.pause();
      a.currentTime = Math.max(0, t - (sceneEl ? startOf.get(sceneEl) ?? 0 : 0)) * 1000;
    }
    const jobs = [];
    for (const v of stage.querySelectorAll('video')) {
      const sceneEl = v.closest('.scene');
      const local = t - (sceneEl ? startOf.get(sceneEl) ?? 0 : 0);
      const rate = Number.isFinite(parseFloat(v.dataset.rate)) ? parseFloat(v.dataset.rate) : 1;
      const want = Math.min(Math.max(0, local * rate + (parseFloat(v.dataset.from) || 0)), Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.001) : 0);
      const visible = !sceneEl || sceneEl.classList.contains('on');
      v.muted = true;
      if (rendering || !opts.playing) {
        v.pause();
        if (visible && v.readyState >= 2 && Math.abs(v.currentTime - want) > 0.001) {
          jobs.push(new Promise((ok, no) => {
            let timer;
            const cleanup = () => { clearTimeout(timer); v.removeEventListener('seeked', done); v.removeEventListener('error', error); };
            // A seeked event can precede presentation of the decoded video frame.
            const done = () => { cleanup(); requestAnimationFrame(() => requestAnimationFrame(ok)); };
            const error = () => { cleanup(); no(new Error(`Video seek failed: ${v.getAttribute('src')}`)); };
            v.addEventListener('seeked', done);
            v.addEventListener('error', error);
            timer = setTimeout(error, 8000);
            v.currentTime = want;
          }));
        }
      } else {
        if (Math.abs(v.currentTime - want) > 0.15) v.currentTime = want;
        if (visible && rate > 0 && want < v.duration - 0.001) { v.playbackRate = rate; v.play().catch(() => {}); } else v.pause();
      }
    }
    const ctx = { duration, fps, format };
    for (const fn of frameHooks) jobs.push(fn(t, ctx));
    for (const s of scenes) {
      if (!s.el.classList.contains('on')) continue;
      for (const fn of sceneHooks.get(s.id) || []) jobs.push(fn(t - s.start, (t - s.start) / s.dur, s.el));
    }
    await Promise.all(jobs);
  }

  /** Effective opacity of el up to the stage. */
  function opacityOf(el) {
    let o = 1;
    for (let n = el; n && n !== stage; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  }

  /** Layout checks for the current frame. Used by the QC pass. Elements inside [data-ui] or [data-qc-ignore] are exempt. */
  function inspect() {
    const issues = [];
    const [st, sr, sb, sl] = SAFE[format];
    const safe = { l: W * sl, t: H * st, r: W * (1 - sr), b: H * (1 - sb) };
    const origin = stage.getBoundingClientRect();
    const k = W / origin.width || 1;
    const describe = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('src') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 48);
    const croppedText = (el) => {
      const text = [];
      if (el.hasAttribute('data-split')) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (walker.currentNode.textContent.trim()) text.push(walker.currentNode);
      } else text.push(...[...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()));
      const boxes = text.flatMap(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()];
      });
      for (let parent = el; parent; parent = parent.parentElement) {
        if (/^(hidden|clip|auto|scroll)$/.test(getComputedStyle(parent).overflowX)) {
          const clip = parent.getBoundingClientRect();
          if (boxes.some(b => b.width && (b.left < clip.left - 1 / k || b.right > clip.right + 1 / k))) return true;
        }
        if (parent === stage) break;
      }
      return false;
    };
    // An animated transform or clip-path on an inline box silently does nothing.
    for (const a of document.getAnimations()) {
      const el = a.effect && a.effect.target;
      const sceneEl = el && el.closest && el.closest('.scene.on');
      if (!sceneEl || a.effect.pseudoElement || getComputedStyle(el).display !== 'inline') continue;
      if (a.effect.getKeyframes().some((kf) => 'transform' in kf || 'clipPath' in kf)) {
        issues.push({ level: 'error', code: 'inline-not-animatable', scene: sceneEl.id, detail: `"${describe(el)}" is display:inline, so its ${a.animationName || 'animation'} has no effect. Make it inline-block or block.` });
      }
    }
    for (const s of scenes) {
      if (!s.el.classList.contains('on')) continue;
      for (const el of s.el.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (el.tagName === 'IMG' && (!el.complete || el.naturalWidth === 0)) {
          issues.push({ level: 'error', code: 'image-missing', scene: s.id, detail: describe(el) });
          continue;
        }
        if (el.tagName === 'VIDEO' && el.readyState < 2) {
          issues.push({ level: 'error', code: 'video-missing', scene: s.id, detail: describe(el) });
          continue;
        }
        if (el.closest('[data-ui],[data-qc-ignore]') || el.classList.contains('wd') || el.classList.contains('ch')) continue;
        const hasText = el.hasAttribute('data-split') || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText || opacityOf(el) < 0.9) continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const r = { l: (b.left - origin.left) * k, t: (b.top - origin.top) * k, r: (b.right - origin.left) * k, b: (b.bottom - origin.top) * k };
        if (r.r <= 0 || r.b <= 0 || r.l >= W || r.t >= H) continue; // fully off stage: in transit
        const size = parseFloat(cs.fontSize);
        if (croppedText(el)) issues.push({ level: 'error', code: 'text-cropped', scene: s.id, detail: `Text is cut off by an overflow container: ${describe(el)}` });
        if (r.l < -1 || r.t < -1 || r.r > W + 1 || r.b > H + 1) issues.push({ level: 'error', code: 'text-clipped', scene: s.id, detail: describe(el) });
        else if (r.l < safe.l - 1 || r.t < safe.t - 1 || r.r > safe.r + 1 || r.b > safe.b + 1) issues.push({ level: 'warn', code: 'outside-safe-area', scene: s.id, detail: describe(el) });
        if (size < MIN_TEXT[format]) issues.push({ level: 'warn', code: 'text-too-small', scene: s.id, detail: `${Math.round(size)}px (min ${MIN_TEXT[format]}): ${describe(el)}` });
      }
    }
    return issues;
  }

  const domReady = new Promise((ok) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', ok) : ok()));
  const loaded = new Promise((ok) => (document.readyState === 'complete' ? ok() : window.addEventListener('load', ok)));

  const ready = (async () => {
    await domReady;
    init();
    await loaded;
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
    await Promise.all([...stage.querySelectorAll('video')].map((v) => v.readyState >= 2 || new Promise((ok) => {
      v.addEventListener('loadeddata', ok, { once: true });
      v.addEventListener('error', ok, { once: true });
      setTimeout(ok, 8000);
    })));
    await seek(0);
    html.dataset.ready = '';
    if (!rendering && !embedded) standalone();
  })();

  /** Opened directly in a browser (e.g. from delivered source files): fit to window and loop. Space toggles. */
  function standalone() {
    const fit = () => {
      const k = Math.min(innerWidth / W, innerHeight / H);
      stage.style.transformOrigin = '0 0';
      stage.style.transform = `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`;
    };
    fit();
    addEventListener('resize', fit);
    let t0 = performance.now();
    playing = true;
    addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      playing = !playing;
      t0 = performance.now() - now * 1000;
    });
    const tick = () => {
      if (playing) seek(((performance.now() - t0) / 1000) % duration, { playing: true });
      requestAnimationFrame(tick);
    };
    tick();
  }

  window.__studio = {
    ready, seek, inspect, format,
    get duration() { return duration; },
    get fps() { return fps; },
    get time() { return now; },
    get scenes() { return scenes.map(({ el, ...s }) => s); },
  };
})();
