import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { measureLoudness } from './audio.mjs';
import { captureStills, withStudio } from './render.mjs';
import { fileDigest, sourceRevision } from './revision.mjs';
import { FORMATS, PROVENANCE, QC_MAX_ROUNDS, TIERS, fail, loadProject, pickFormats, projectDir, readJson, run, updateJson, which, writeJson } from './util.mjs';

/** Checks that need no rendering: project settings, provenance declarations, per-format adaptation, licences. */
async function staticChecks(dir, project, info, formats) {
  const issues = [];
  const add = (level, code, detail, scene) => issues.push({ level, code, detail, ...(scene ? { scene } : {}) });
  if (info.duration < 15 || info.duration > 60) add('warn', 'duration-range', `Piece runs ${info.duration}s; the studio targets 15-60s.`);
  if (Math.abs(info.duration - project.duration) > 0.5) add('warn', 'duration-mismatch', `Composition runs ${info.duration}s but the brief asks for ${project.duration}s.`);
  for (const s of info.scenes) {
    if (s.ui && !['authentic', 'illustrative'].includes(s.provenance)) {
      add('error', 'provenance-missing', 'Scene shows an interface ([data-ui]) but does not declare data-provenance="authentic" or "illustrative".', s.id);
    }
    if (s.dur < 0.6) add('warn', 'scene-too-short', `${s.dur}s is too short to read.`, s.id);
  }
  let source = '';
  const comp = join(dir, 'composition');
  for (const e of await readdir(comp, { recursive: true, withFileTypes: true })) {
    if (e.isFile() && /\.(html|css|js)$/.test(e.name)) source += await readFile(join(e.parentPath, e.name), 'utf8');
  }
  for (const f of formats) {
    if (f !== 'horizontal' && !new RegExp(`data-format=["']?${f}|only-${f}|Studio\\.format`).test(source)) {
      add('warn', 'format-not-adapted', `No ${f}-specific layout rules found: ${f} must be composed for its frame, not reflowed from horizontal.`);
    }
  }
  if (/transition\s*:/.test(source.replace(/view-transition/g, ''))) add('warn', 'css-transition', 'CSS transitions are not seekable and will not render. Use animations.');
  if (/setTimeout|setInterval|requestAnimationFrame/.test(source)) add('warn', 'wall-clock-timing', 'Timers/requestAnimationFrame are not deterministic. Drive motion from Studio.onFrame / Studio.scene.');
  const manifest = await readJson(join(dir, 'assets', 'manifest.json'), { assets: [] });
  for (const asset of manifest.assets) {
    if (!PROVENANCE.includes(asset.provenance)) add('error', 'asset-provenance', `${asset.path} has no valid provenance.`);
    if (typeof asset.license !== 'string' || !asset.license.trim()) add('error', 'asset-license', `${asset.path} has no licence terms recorded.`);
  }
  const known = new Set(manifest.assets.map((a) => a.path));
  if (existsSync(join(dir, 'assets'))) {
    for (const e of await readdir(join(dir, 'assets'), { recursive: true, withFileTypes: true })) {
      if (!e.isFile() || e.name === 'manifest.json' || e.name.startsWith('.')) continue;
      const rel = join(e.parentPath, e.name).slice(dir.length + 1).split('\\').join('/');
      if (!known.has(rel)) add('error', 'asset-unregistered', `${rel} has no provenance/licence entry. Register it with "asset --add".`);
    }
  }
  return issues;
}

/** Layout checks in the real browser at two points in every scene, plus load errors. */
async function layoutChecks(dir, formats) {
  const out = {};
  await withStudio(dir, async (open) => {
    for (const format of formats) {
      const stage = await open(format, { scale: 0.5 });
      const seen = new Map();
      for (const s of stage.info.scenes) {
        for (const p of [0.6, 0.9]) {
          await stage.page.eval(`__studio.seek(${s.start + s.dur * p})`);
          for (const i of await stage.page.eval('__studio.inspect()')) seen.set(`${i.code}|${i.scene}|${i.detail}`, i);
        }
      }
      const issues = [...seen.values()];
      for (const p of new Set(stage.page.problems)) issues.push({ level: 'error', code: 'page-error', detail: p });
      const sheet = await captureStills(dir, stage, format, stage.info.scenes.map((s) => ({ t: s.start + s.dur * 0.6, name: s.id })));
      out[format] = { issues, sheet: sheet.sheet, info: stage.info };
      await stage.page.close();
    }
  });
  return out;
}

/** Technical checks on a rendered file: container, picture, black/frozen stretches, loudness. */
async function fileChecks(file, { format, tier, project, duration }) {
  const issues = [];
  const add = (level, code, detail) => issues.push({ level, code, detail });
  const ffprobe = which('ffprobe') || fail('ffprobe not found.');
  const ffmpeg = which('ffmpeg') || fail('ffmpeg not found.');
  const probe = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).stdout);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const scale = TIERS[tier].scale * (tier === 'final' ? (project.resolution || 1080) / 1080 : 1);
  const want = { w: Math.round(FORMATS[format].w * scale), h: Math.round(FORMATS[format].h * scale) };
  if (!v) return [{ level: 'error', code: 'no-video', detail: 'File has no video stream.' }];
  if (v.width !== want.w || v.height !== want.h) add('error', 'resolution', `${v.width}x${v.height}, expected ${want.w}x${want.h}.`);
  const [n, d] = v.avg_frame_rate.split('/').map(Number);
  if (Math.abs(n / d - project.fps) > 0.01) add('error', 'frame-rate', `${(n / d).toFixed(2)} fps, expected ${project.fps}.`);
  if (v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p') add('error', 'codec', `${v.codec_name}/${v.pix_fmt}, expected h264/yuv420p.`);
  const fileDur = parseFloat(probe.format.duration);
  if (Math.abs(fileDur - duration) > 0.12) add('error', 'duration', `File runs ${fileDur.toFixed(2)}s, composition is ${duration}s.`);

  const { stderr } = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-vf', 'blackdetect=d=0.6:pix_th=0.015:pic_th=0.995,freezedetect=n=-55dB:d=3', '-an', '-f', 'null', '-']);
  for (const m of stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) add('error', 'black-frames', `Black from ${(+m[1]).toFixed(2)}s to ${(+m[2]).toFixed(2)}s.`);
  for (const m of stderr.matchAll(/freeze_start: ([\d.]+)/g)) add('warn', 'frozen-picture', `Nothing moves for 3s+ from ${(+m[1]).toFixed(2)}s. Add a slow drift or shorten the hold.`);

  if (!a) add(tier === 'final' ? 'error' : 'warn', 'no-audio', 'No audio track. Run "audio mix" and render again.');
  else {
    const loud = await measureLoudness(file);
    if (loud.lufs < -17 || loud.lufs > -12) add('warn', 'loudness', `${loud.lufs} LUFS; target is -14 (range -17 to -12).`);
    if (!Number.isFinite(loud.lufs) || !Number.isFinite(loud.truePeak)) add('error', 'invalid-loudness', 'Audio loudness could not be measured or the track is silent.');
    if (loud.truePeak > -1) add('error', 'true-peak', `True peak ${loud.truePeak} dBTP; must stay under -1.`);
    if (loud.lufs < -45) add('error', 'silent-audio', 'Audio track is effectively silent.');
  }
  return issues;
}

/**
 * qc --project <dir> [--format all] [--tier draft|final] [--reset]
 * Writes build/qc/report.json. Each failing run counts as a correction round; after QC_MAX_ROUNDS
 * the report says to stop auto-fixing and bring the remaining issues to the user.
 */
export async function qc(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  const tier = args.tier || 'draft';
  if (!TIERS[tier]) fail('--tier must be draft or final.');
  const formats = pickFormats(project, args.format);
  const revision = await sourceRevision(dir);
  if (args.reset) project.qc = { rounds: 0 };

  const layout = await layoutChecks(dir, formats);
  const info = layout[formats[0]].info;
  await writeJson(join(dir, 'build', 'timing.json'), info);
  const report = { tier, revision, at: new Date().toISOString(), general: await staticChecks(dir, project, info, formats), formats: {} };
  for (const format of formats) {
    const file = join(dir, 'renders', tier, `${format}.mp4`);
    const rendered = existsSync(file);
    const digest = rendered ? await fileDigest(file) : null;
    const recorded = rendered ? await readJson(join(dir, 'build/renders', tier, `${format}.json`), {}) : {};
    report.formats[format] = {
      contactSheet: layout[format].sheet,
      render: rendered ? file : null,
      digest,
      issues: [
        ...layout[format].issues,
        ...(rendered ? await fileChecks(file, { format, tier, project, duration: info.duration }) : [{ level: tier === 'final' ? 'error' : 'warn', code: 'not-rendered', detail: `No ${tier} render yet; file checks skipped.` }]),
        ...(rendered && (recorded.revision !== revision || recorded.digest !== digest) ? [{ level: 'error', code: 'stale-render', detail: 'Render does not match the current production source. Render again before QC.' }] : []),
      ],
    };
  }
  if (await sourceRevision(dir) !== revision) report.general.push({ level: 'error', code: 'source-changed', detail: 'Production source changed during QC. Run QC again on the finished source.' });
  const all = [...report.general, ...Object.values(report.formats).flatMap((f) => f.issues)];
  report.errors = all.filter((i) => i.level === 'error').length;
  report.warnings = all.filter((i) => i.level === 'warn').length;
  report.pass = report.errors === 0;
  report.round = report.pass ? project.qc.rounds || 0 : (project.qc.rounds || 0) + 1;
  project.qc.rounds = report.pass ? 0 : report.round; // a pass closes the correction cycle
  report.maxRounds = QC_MAX_ROUNDS;
  report.next = report.pass
    ? 'Automated checks pass. Review the contact sheets by eye before showing the user.'
    : report.round >= QC_MAX_ROUNDS
      ? 'Correction limit reached. Stop auto-fixing: show the user the remaining issues and ask how to proceed.'
      : `Fix the errors, then run qc again (round ${report.round} of ${QC_MAX_ROUNDS}).`;
  project.qc.lastPass = report.pass;
  await updateJson(join(dir, 'project.json'), current => { current.qc = project.qc; });
  await writeJson(join(dir, 'build', 'qc', 'report.json'), report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 2;
}
