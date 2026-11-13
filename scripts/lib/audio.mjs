import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { computeTiming } from './render.mjs';
import { fail, loadProject, projectDir, readJson, run, which } from './util.mjs';

/*
 * Procedural music and sound effects, synthesised from scratch (no samples), so every sound
 * the studio ships is original and free of third-party licences.
 */
const SR = 48000;
const TAU = Math.PI * 2;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const stereo = (sec) => [new Float32Array(Math.ceil(sec * SR)), new Float32Array(Math.ceil(sec * SR))];

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Additive voice. env: attack (s), decay time constant (s, Infinity = sustain), release (s). */
function voice(out, at, dur, freq, { gain = 0.2, pan = 0, partials = [[1, 1]], attack = 0.005, decay = Infinity, release = 0.05, damp = 0 }) {
  const start = Math.round(at * SR), n = Math.round((dur + release) * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n; i++) {
    const k = start + i;
    if (k < 0 || k >= out[0].length) continue;
    const t = i / SR;
    let env = Math.min(1, t / attack) * (decay === Infinity ? 1 : Math.exp(-t / decay));
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    let s = 0;
    for (const [mult, amp] of partials) s += amp * Math.exp(-t * damp * (mult - 1)) * Math.sin(TAU * freq * mult * t);
    out[0][k] += s * env * gl;
    out[1][k] += s * env * gr;
  }
}

function kick(out, at, gain = 0.9) {
  const start = Math.round(at * SR), n = Math.round(0.4 * SR);
  let phase = 0;
  for (let i = 0; i < n && start + i < out[0].length; i++) {
    const t = i / SR;
    phase += (TAU * (46 + 120 * Math.exp(-t / 0.028))) / SR;
    const s = Math.sin(phase) * Math.exp(-t / 0.16) * gain * Math.min(1, t / 0.001);
    out[0][start + i] += s;
    out[1][start + i] += s;
  }
}

/** Filtered noise burst: hats, claps, ticks. `tone` 0..1 moves from dark to bright. */
function noiseHit(out, at, rand, { gain = 0.2, decay = 0.03, tone = 0.9, pan = 0, bursts = 1 }) {
  const start = Math.round(at * SR), n = Math.round((decay * 6 + bursts * 0.012) * SR);
  let lp = 0, prev = 0;
  for (let i = 0; i < n && start + i < out[0].length; i++) {
    const t = i / SR;
    const x = rand() * 2 - 1;
    lp += (x - lp) * (0.15 + 0.8 * tone);
    const hp = lp - prev;
    prev = lp;
    let env = 0;
    for (let b = 0; b < bursts; b++) { const tb = t - b * 0.012; if (tb >= 0) env = Math.max(env, Math.exp(-tb / decay)); }
    const s = (tone > 0.5 ? hp : lp) * env * gain;
    out[0][start + i] += s * (1 - Math.max(0, pan));
    out[1][start + i] += s * (1 + Math.min(0, pan));
  }
}

/** Noise through a swept band-pass: whooshes, swipes, risers. */
function sweep(out, at, dur, rand, { gain = 0.5, from = 300, to = 4000, q = 0.35, shape = 'bell', panFrom = 0, panTo = 0, pitch = 0 }) {
  const start = Math.round(at * SR), n = Math.round(dur * SR);
  let low = 0, band = 0, phase = 0;
  for (let i = 0; i < n && start + i < out[0].length; i++) {
    const p = i / n;
    const fc = from * (to / from) ** p;
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6.5)) / SR);
    const x = rand() * 2 - 1;
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    const env = shape === 'bell' ? Math.sin(Math.PI * p) ** 2 : shape === 'rise' ? p ** 2.4 * Math.min(1, (1 - p) * 60) : Math.exp(-p * 5);
    phase += (TAU * pitch * (1 + p * 1.5)) / SR;
    const s = (band + (pitch ? Math.sin(phase) * 0.25 : 0)) * env * gain;
    const pan = panFrom + (panTo - panFrom) * p;
    if (start + i >= 0) {
      out[0][start + i] += s * Math.cos(((pan + 1) * Math.PI) / 4);
      out[1][start + i] += s * Math.sin(((pan + 1) * Math.PI) / 4);
    }
  }
}

function impact(out, at, rand, gain = 0.9) {
  const start = Math.round(at * SR), n = Math.round(1.6 * SR);
  let phase = 0;
  for (let i = 0; i < n && start + i < out[0].length; i++) {
    const t = i / SR;
    phase += (TAU * (38 + 70 * Math.exp(-t / 0.05))) / SR;
    const s = Math.sin(phase) * Math.exp(-t / 0.45) * gain;
    out[0][start + i] += s;
    out[1][start + i] += s;
  }
  noiseHit(out, at, rand, { gain: gain * 0.35, decay: 0.09, tone: 0.3 });
}

const PARTIALS = {
  pad: [[1, 1], [2, 0.32], [3, 0.12], [4, 0.05]],
  bass: [[1, 1], [2, 0.4], [3, 0.16]],
  pluck: [[1, 1], [2, 0.5], [3, 0.26], [4, 0.12], [5, 0.06]],
  keys: [[1, 1], [2, 0.28], [3, 0.1], [4.02, 0.05]],
  bell: [[1, 1], [2.76, 0.4], [5.4, 0.2], [8.9, 0.08]],
};

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/** Four moods that map to the studio's house styles. `prog` is scale degrees, one chord per bar. */
export const STYLES = {
  refined: { bpm: 88, scale: 'major', prog: [0, 5, 3, 4], lead: 'bell', leadSteps: [0, 6, 10], kick: [0], hat: 0, clap: false, pad: 1, drive: 0.5 },
  editorial: { bpm: 96, scale: 'major', prog: [3, 0, 4, 5], lead: 'keys', leadSteps: [0, 3, 6, 10, 12], kick: [], hat: 4, clap: false, pad: 0.7, drive: 0.4 },
  bold: { bpm: 112, scale: 'minor', prog: [0, 5, 2, 6], lead: 'pluck', leadSteps: [0, 3, 6, 8, 11, 14], kick: [0, 4, 8, 12], hat: 2, clap: true, pad: 0.8, drive: 0.9 },
  energetic: { bpm: 128, scale: 'major', prog: [5, 3, 0, 4], lead: 'pluck', leadSteps: [0, 2, 4, 6, 8, 10, 12, 14], kick: [0, 4, 8, 12], hat: 2, clap: true, pad: 0.6, drive: 1 },
};

/**
 * Compose a bed that fits the cut: sparse intro, build, full section, then a final hit and tail.
 * Returns the samples and the musical grid (beats, drop, final hit) so picture can be cut to it.
 */
export function composeMusic({ style = 'refined', duration = 30, bpm, key = 0, seed = 1, hit }) {
  const st = STYLES[style] || fail(`Unknown music style "${style}". Use ${Object.keys(STYLES).join(', ')}.`);
  const tail = Math.min(2.8, Math.max(1.4, duration * 0.08));
  bpm = Number(bpm) || st.bpm;
  let bar = 240 / bpm;
  const hitTarget = Number(hit) || duration - tail;
  const bars = Math.max(2, Math.round(hitTarget / bar));
  if (hit) { bar = hitTarget / bars; bpm = 240 / bar; } // retime slightly so the final hit lands exactly on the cue
  const step = bar / 16;
  const rand = rng(seed);
  const out = stereo(duration);
  const scale = SCALES[st.scale];
  const root = 48 + (((Number(key) || 0) % 12) + 12) % 12;
  const note = (degree, octave = 0) => root + scale[((degree % 7) + 7) % 7] + 12 * (Math.floor(degree / 7) + octave);
  const dropBar = Math.max(1, Math.round(bars * 0.42));
  const buildBar = Math.max(1, Math.round(bars * 0.18));

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    const degree = st.prog[b % st.prog.length];
    const chord = [0, 2, 4, 6].map((d) => note(degree + d, 0));
    const level = b < buildBar ? 0.55 + 0.45 * (b / buildBar) : 1;
    chord.forEach((m, i) => {
      for (const det of [-0.06, 0.06]) {
        voice(out, t0, bar, hz(m + det), { gain: 0.05 * st.pad * level, pan: (i - 1.5) * 0.35 + det * 4, partials: PARTIALS.pad, attack: b === 0 ? 0.9 : 0.25, release: 0.5 });
      }
    });
    if (b >= buildBar) {
      const bn = hz(note(degree, -1));
      const pattern = b >= dropBar ? [0, 6, 10] : [0];
      for (const s of pattern) voice(out, t0 + s * step, step * 3.2, bn, { gain: 0.22 * (0.6 + 0.4 * st.drive), partials: PARTIALS.bass, attack: 0.004, decay: 0.5, release: 0.06 });
    }
    const leadOn = b >= Math.min(buildBar, 1) || st.kick.length === 0;
    if (leadOn) {
      st.leadSteps.forEach((s, i) => {
        if (b < dropBar && i % 2 === 1 && st.drive > 0.6) return; // thin the lead before the drop
        const tone = chord[(i + b) % 4] + 12 + (i % 3 === 2 ? 12 : 0);
        voice(out, t0 + s * step, 0.9, hz(tone), {
          gain: 0.075 * (b >= dropBar ? 1 : 0.7), pan: i % 2 ? 0.45 : -0.45, partials: PARTIALS[st.lead],
          attack: 0.003, decay: st.lead === 'bell' ? 0.7 : 0.22, release: 0.2, damp: st.lead === 'pluck' ? 3 : 1,
        });
      });
    }
    if (st.hat && b >= buildBar) {
      for (let s = 0; s < 16; s += st.hat) {
        const off = s % 4 === 2;
        noiseHit(out, t0 + s * step, rand, { gain: (off ? 0.07 : 0.035) * (b >= dropBar ? 1 : 0.6), decay: off ? 0.03 : 0.015, tone: 0.95, pan: 0.2 });
      }
    }
    if (b >= dropBar) {
      for (const s of st.kick) kick(out, t0 + s * step, 0.55 * (0.6 + 0.4 * st.drive));
      if (st.clap) for (const s of [4, 12]) noiseHit(out, t0 + s * step, rand, { gain: 0.16, decay: 0.07, tone: 0.6, bursts: 3 });
    }
    if (b === dropBar - 1) sweep(out, t0, bar, rand, { gain: 0.12 * st.drive + 0.04, from: 400, to: 6000, shape: 'rise' });
    if (b === bars - 1) sweep(out, t0 + bar / 2, bar / 2, rand, { gain: 0.1 * st.drive + 0.03, from: 500, to: 7000, shape: 'rise' });
  }

  // Final hit: resolve to the tonic and let it ring out.
  const hitAt = bars * bar;
  impact(out, hitAt, rand, 0.5 + 0.3 * st.drive);
  [0, 2, 4, 7].forEach((d, i) => {
    voice(out, hitAt, Math.max(0.2, duration - hitAt - 0.9), hz(note(d, 0)), { gain: 0.07, pan: (i - 1.5) * 0.4, partials: PARTIALS.pad, attack: 0.01, decay: 1.6, release: 0.8 });
    voice(out, hitAt, 1.2, hz(note(d, 1)), { gain: 0.05, pan: (1.5 - i) * 0.4, partials: PARTIALS.bell, attack: 0.002, decay: 0.9, release: 0.4 });
  });

  const beats = [];
  for (let t = 0; t < hitAt - 1e-6; t += bar / 4) beats.push(+t.toFixed(3));
  return {
    samples: out,
    grid: { style, bpm: +bpm.toFixed(2), bar: +bar.toFixed(4), beat: +(bar / 4).toFixed(4), build: +(buildBar * bar).toFixed(3), drop: +(dropBar * bar).toFixed(3), hit: +hitAt.toFixed(3), duration, beats },
  };
}

export const SFX = {
  whoosh: (o, r, d) => sweep(o, 0, d, r, { gain: 0.6, from: 250, to: 5200, panFrom: -0.7, panTo: 0.7 }),
  swipe: (o, r, d) => sweep(o, 0, d, r, { gain: 0.5, from: 900, to: 7000, q: 0.5, panFrom: 0.5, panTo: -0.5 }),
  rise: (o, r, d) => sweep(o, 0, d, r, { gain: 0.5, from: 300, to: 8000, shape: 'rise', pitch: 180 }),
  impact: (o, r) => impact(o, 0, r, 0.95),
  click: (o, r) => { voice(o, 0, 0.012, 2100, { gain: 0.4, decay: 0.006, release: 0.01 }); noiseHit(o, 0, r, { gain: 0.25, decay: 0.004, tone: 0.9 }); },
  tick: (o, r) => noiseHit(o, 0, r, { gain: 0.4, decay: 0.006, tone: 1 }),
  pop: (o) => { for (let i = 0; i < 4; i++) voice(o, i * 0.004, 0.05, 620 - i * 90, { gain: 0.2, decay: 0.03, release: 0.03 }); },
  key: (o, r) => { voice(o, 0, 0.02, 320, { gain: 0.25, decay: 0.012, release: 0.02 }); noiseHit(o, 0, r, { gain: 0.3, decay: 0.01, tone: 0.45 }); },
  chime: (o) => [76, 83, 88].forEach((m, i) => voice(o, i * 0.07, 1.2, hz(m), { gain: 0.16, pan: (i - 1) * 0.5, partials: PARTIALS.bell, attack: 0.002, decay: 0.5, release: 0.4 })),
  shimmer: (o, r, d) => { for (let i = 0; i < 14; i++) voice(o, r() * d * 0.5, d * 0.5, hz(84 + [0, 4, 7, 11, 12, 16][Math.floor(r() * 6)]), { gain: 0.05, pan: r() * 2 - 1, partials: PARTIALS.bell, attack: 0.05, decay: d * 0.25, release: 0.3 }); },
};
const SFX_DUR = { whoosh: 0.7, swipe: 0.28, rise: 1.6, impact: 1.6, click: 0.08, tick: 0.06, pop: 0.14, key: 0.09, chime: 1.8, shimmer: 2.2 };

/** Normalise to a peak and write 16-bit stereo WAV. */
async function writeWav(file, [l, r], { peak = 0.8, fadeOut = 0.02 } = {}) {
  const n = l.length;
  let max = 1e-9;
  for (let i = 0; i < n; i++) { l[i] = Math.tanh(l[i] * 1.15); r[i] = Math.tanh(r[i] * 1.15); max = Math.max(max, Math.abs(l[i]), Math.abs(r[i])); }
  const g = peak / max, fade = Math.round(fadeOut * SR);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    buf.writeInt16LE(Math.round(l[i] * g * f * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(r[i] * g * f * 32767), 46 + i * 4);
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
}

const outPath = (args, fallback) => resolve(args.project ? String(args.project) : '.', args.out && args.out !== true ? String(args.out) : fallback);

/** music --style refined|editorial|bold|energetic [--duration 30] [--bpm n] [--key 0-11] [--seed n] [--hit seconds] [--project dir] [--out audio/music.wav] */
export async function music(args) {
  let duration = parseFloat(args.duration);
  if (!duration && args.project) duration = (await loadProject(projectDir(args))).duration;
  const { samples, grid } = composeMusic({ style: args.style, duration: duration || 30, bpm: args.bpm, key: args.key, seed: parseInt(args.seed, 10) || 1, hit: args.hit });
  const out = outPath(args, 'audio/music.wav');
  await writeWav(out, samples, { peak: 0.7, fadeOut: 0.4 });
  console.log(JSON.stringify({ wrote: out, license: 'Procedurally generated; original to this project', grid }, null, 2));
}

/** sfx --type <name> [--dur s] [--seed n] [--project dir] [--out audio/sfx/<name>.wav] */
export async function sfx(args) {
  const type = args.type;
  if (!SFX[type]) fail(`--type must be one of: ${Object.keys(SFX).join(', ')}.`);
  const dur = parseFloat(args.dur) || SFX_DUR[type];
  const out = stereo(dur + 0.05);
  SFX[type](out, rng(parseInt(args.seed, 10) || 7), dur);
  const file = outPath(args, `audio/sfx/${type}.wav`);
  await writeWav(file, out, { peak: 0.85 });
  console.log(JSON.stringify({ wrote: file, duration: dur }));
}

/** Integrated loudness and true peak of a file, via ffmpeg's EBU R128 meter. */
export async function measureLoudness(file) {
  const { stderr } = await run(which('ffmpeg') || fail('ffmpeg not found.'), ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr);
  if (!m) fail(`Could not measure loudness of ${file}.`);
  const j = JSON.parse(m[0]);
  return { lufs: parseFloat(j.input_i), truePeak: parseFloat(j.input_tp), range: parseFloat(j.input_lra) };
}

/** A cue time is seconds, or a scene reference: "hero", "hero+0.4", "hero.end-0.3". */
export function cueTime(at, timing) {
  if (typeof at === 'number') return at;
  const m = /^([\w-]+?)(\.end)?([+-]\d*\.?\d+)?$/.exec(String(at).trim());
  const scene = m && timing?.scenes.find((s) => s.id === m[1]);
  if (!scene) fail(`Cue time "${at}" does not match a scene id. Scenes: ${timing?.scenes.map((s) => s.id).join(', ')}`);
  return (m[2] ? scene.end : scene.start) + (parseFloat(m[3]) || 0);
}

/**
 * mix --project <dir>
 * Reads audio/cues.json { target, music: { file, gain, fadeIn, fadeOut }, cues: [{ file, at, gain }] }
 * and writes build/mix.wav at the target loudness (default -14 LUFS, true peak under -1 dBTP).
 */
export async function mix(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  const sheet = await readJson(join(dir, 'audio', 'cues.json'));
  const cues = sheet.cues || [];
  const timing = await computeTiming(dir);
  const duration = timing.duration || project.duration;
  const tracks = [];
  if (sheet.music) tracks.push({ ...sheet.music, at: 0, music: true });
  for (const c of cues) tracks.push({ ...c, at: cueTime(c.at, timing) });
  if (!tracks.length) fail('audio/cues.json has no music and no cues.');
  const inputs = [], filters = [];
  tracks.forEach((tr, i) => {
    const file = resolve(dir, tr.file);
    if (!existsSync(file)) fail(`Audio file not found: ${tr.file}`);
    if (tr.at < 0 || tr.at >= duration) fail(`Cue ${tr.file} at ${tr.at}s is outside the ${duration}s piece.`);
    inputs.push('-i', file);
    const chain = ['aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo', `volume=${Number(tr.gain) || 0}dB`];
    if (tr.fadeIn) chain.push(`afade=t=in:d=${tr.fadeIn}`);
    if (tr.music) chain.push(`afade=t=out:st=${Math.max(0, duration - (tr.fadeOut ?? 0.6))}:d=${tr.fadeOut ?? 0.6}`);
    if (tr.at > 0) chain.push(`adelay=${Math.round(tr.at * 1000)}:all=1`);
    filters.push(`[${i}:a]${chain.join(',')}[a${i}]`);
  });
  filters.push(`${tracks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tracks.length}:normalize=0:duration=longest,apad,atrim=0:${duration}[pre]`);
  const ffmpeg = which('ffmpeg') || fail('ffmpeg not found.');
  const pre = join(dir, 'build', 'premix.wav'), out = join(dir, 'build', 'mix.wav');
  await mkdir(join(dir, 'build'), { recursive: true });
  await run(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[pre]', '-c:a', 'pcm_s24le', pre]);
  const before = await measureLoudness(pre);
  const target = Number(sheet.target) || -14;
  // Static gain to target; a limiter catches up to 4 dB of peaks rather than pumping the whole mix.
  const gain = Math.min(target - before.lufs, -1 - before.truePeak + 4);
  await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', pre, '-af',
    `volume=${gain.toFixed(2)}dB,alimiter=limit=0.84:level=disabled:attack=3:release=60,afade=t=out:st=${Math.max(0, duration - 0.12)}:d=0.12`,
    '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  const after = await measureLoudness(out);
  console.log(JSON.stringify({ wrote: out, duration, tracks: tracks.map((t) => ({ file: t.file, at: +t.at.toFixed(3), gain: t.gain || 0 })), loudness: after, target }, null, 2));
}
