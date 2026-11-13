import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openBrowser } from './chrome.mjs';
import { serve } from './server.mjs';
import { fileDigest, sourceRevision } from './revision.mjs';
import { FORMATS, TIERS, encodeFrames, fail, loadProject, log, pickFormats, projectDir, run, timecode, which, writeJson } from './util.mjs';

/**
 * Open the composition in headless Chrome and hand `fn` a page that is ready to seek.
 * Reuses one browser and one local server across formats.
 */
export async function withStudio(dir, fn) {
  if (!existsSync(join(dir, 'composition', 'index.html'))) fail(`No composition/index.html in ${dir}.`);
  const server = await serve(dir);
  let browser;
  try {
    browser = await openBrowser();
    const project = await loadProject(dir);
    return await fn(async (format, { scale = 1, solo, transparent = false } = {}) => {
      const { w, h } = FORMATS[format];
      const page = await browser.newPage({ width: w, height: h, scale, transparent });
      const query = `format=${format}&render=1&disclosure=${project.disclosure === 'report-only' ? 'report-only' : 'label'}${solo ? `&solo=${encodeURIComponent(solo)}` : ''}`;
      await page.goto(`${server.url}/composition/index.html?${query}`);
      const hasRuntime = await page.eval('typeof window.__studio === "object"');
      if (!hasRuntime) fail('composition/index.html does not load ../__studio/stage.js.');
      await page.eval('window.__studio.ready');
      const info = await page.eval('({ duration: __studio.duration, fps: __studio.fps, scenes: __studio.scenes })');
      if (!info.scenes.length) fail('Composition has no <section class="scene"> elements inside #stage.');
      return { page, info, width: w, height: h };
    });
  } finally {
    await browser?.close();
    await server.close();
  }
}

/** Scene timings as authored. Written to build/timing.json; audio cues and timeline export resolve against it. */
export async function computeTiming(dir) {
  const project = await loadProject(dir);
  const info = await withStudio(dir, async (open) => (await open(project.formats[0])).info);
  await writeJson(join(dir, 'build', 'timing.json'), info);
  return info;
}

function ffmpegBin() {
  return which('ffmpeg') || fail('ffmpeg not found on PATH. Run the setup check.');
}

/** Capture frames [from, to) and encode. `alpha` writes ProRes 4444 with transparency (for timeline clips). */
async function encode({ stage, out, tier, from, to, audio, alpha, label }) {
  const { page, info } = stage;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > info.duration + 0.001) fail('Render range must satisfy 0 <= --from < --to <= composition duration.');
  const t = TIERS[tier];
  const total = Math.max(1, Math.round((to - from) * info.fps));
  const image = alpha ? 'png' : t.image;
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', image === 'png' ? 'png' : 'mjpeg', '-i', '-'];
  if (audio) args.push('-ss', String(from), '-t', String(to - from), '-i', audio);
  if (alpha) args.push('-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', '-q:v', '11');
  else args.push(
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', t.preset, '-crf', String(t.crf),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart',
  );
  if (audio) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest');
  const started = Date.now();
  let lastLog = 0;
  async function* frames() {
    for (let i = 0; i < total; i++) {
      await page.eval(`__studio.seek(${from + i / info.fps})`);
      yield await page.screenshot({ format: image, quality: t.quality });
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        log(`  ${label}: frame ${i + 1}/${total} (${(((i + 1) / (Date.now() - started)) * 1000).toFixed(1)} fps)`);
      }
    }
  }
  await encodeFrames(args, frames(), out);
  return { out, frames: total, seconds: +((Date.now() - started) / 1000).toFixed(1) };
}

/** render --project <dir> [--format all] [--tier draft|final] [--from s] [--to s] */
export async function render(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  const tier = args.tier || 'draft';
  if (!TIERS[tier]) fail('--tier must be draft or final.');
  const formats = pickFormats(project, args.format);
  for (const key of ['from', 'to']) if (args[key] !== undefined && (args[key] === true || !Number.isFinite(Number(args[key])))) fail(`--${key} must be a finite number of seconds.`);
  const mix = join(dir, 'build', 'mix.wav');
  const audio = existsSync(mix) ? mix : null;
  if (!audio) log('No build/mix.wav yet: rendering picture only. Run "audio mix" to add sound.');
  const scale = TIERS[tier].scale * (tier === 'final' ? (project.resolution || 1080) / 1080 : 1);
  const results = [];
  const revision = await sourceRevision(dir);
  await withStudio(dir, async (open) => {
    for (const format of formats) {
      const stage = await open(format, { scale });
      const from = args.from === undefined ? 0 : Number(args.from);
      const to = args.to === undefined ? stage.info.duration : Number(args.to);
      const partial = from > 0 || to < stage.info.duration;
      const out = join(dir, 'renders', tier, `${format}${partial ? `_${from}-${to}` : ''}.mp4`);
      const r = await encode({ stage, out, tier, from, to, audio, label: `${format} ${tier}` });
      if (await sourceRevision(dir) !== revision) fail('Production source changed during rendering. Render again before QC or delivery.');
      if (!partial) await writeJson(join(dir, 'build/renders', tier, `${format}.json`), { revision, digest: await fileDigest(out) });
      results.push({ format, tier, ...r, width: Math.round(stage.width * scale), height: Math.round(stage.height * scale), duration: +(to - from).toFixed(3), problems: [...new Set(stage.page.problems)] });
      await stage.page.close();
    }
  });
  console.log(JSON.stringify({ rendered: results }, null, 2));
}

/**
 * stills --project <dir> [--format all] [--at 1.5,4 | scenes]
 * Writes PNG frames plus a contact sheet per format, so frames can be reviewed without rendering video.
 */
export async function stills(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  const formats = pickFormats(project, args.format);
  const out = [];
  await withStudio(dir, async (open) => {
    for (const format of formats) {
      const stage = await open(format, { scale: 0.5 });
      const times = !args.at || args.at === 'scenes'
        ? stage.info.scenes.map((s) => ({ t: s.start + s.dur * 0.6, name: s.id }))
        : String(args.at).split(',').map((v) => ({ t: parseFloat(v), name: `t${v}` }));
      out.push(await captureStills(dir, stage, format, times));
      await stage.page.close();
    }
  });
  console.log(JSON.stringify({ stills: out }, null, 2));
}

export async function captureStills(dir, stage, format, times) {
  const folder = join(dir, 'build', 'stills', format);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const frames = [];
  for (const [i, { t, name }] of times.entries()) {
    await stage.page.eval(`__studio.seek(${t})`);
    const file = join(folder, `${String(i + 1).padStart(2, '0')}.png`);
    await writeFile(file, await stage.page.screenshot({ format: 'png' }));
    frames.push({ file, t: +t.toFixed(3), at: timecode(t), name });
  }
  const sheet = join(folder, 'sheet.jpg');
  const cols = format === 'vertical' ? Math.min(6, frames.length) : Math.min(3, frames.length);
  const rows = Math.ceil(frames.length / cols);
  await run(ffmpegBin(), ['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(folder, '%02d.png'),
    '-vf', `scale=${format === 'vertical' ? 270 : 480}:-2,tile=${cols}x${rows}:padding=8:margin=8:color=0x202024`, '-frames:v', '1', '-update', '1', sheet]);
  return { format, sheet, frames };
}

/** timing --project <dir>: print scene timings. */
export async function timing(args) {
  const info = await computeTiming(projectDir(args));
  console.log(JSON.stringify(info, null, 2));
}

export { encode };
