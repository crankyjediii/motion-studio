import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cueTime } from './audio.mjs';
import { encode, withStudio } from './render.mjs';
import { FORMATS, fail, loadProject, log, projectDir, readJson, run, slugify, which, writeJson } from './util.mjs';

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * timeline --project <dir> [--format horizontal]
 * Editable hand-off for an NLE or After Effects: every scene rendered on its own as a ProRes 4444
 * clip with alpha, a background plate, the audio stems, and timeline files that place them.
 *   deliverables/timeline/<format>/clips/*.mov, audio/*, <name>.fcpxml (Final Cut, Resolve),
 *   build-in-after-effects.jsx, timeline.json
 * ProRes clips are much larger than the MP4s; photographic or video-heavy scenes most of all.
 */
export async function timeline(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  const format = args.format && args.format !== true ? String(args.format) : project.formats[0];
  if (!FORMATS[format]) fail(`Unknown format "${format}".`);
  const ffmpeg = which('ffmpeg') || fail('ffmpeg not found.');
  if (!/prores_ks/.test((await run(ffmpeg, ['-hide_banner', '-encoders'])).stdout)) fail('This ffmpeg build has no ProRes encoder (prores_ks), which timeline export needs.');
  const out = join(dir, 'deliverables', 'timeline', format);
  await mkdir(join(out, 'clips'), { recursive: true });
  await mkdir(join(out, 'audio'), { recursive: true });
  const { w, h } = FORMATS[format];
  const scale = (project.resolution || 1080) / 1080;
  const clips = [];
  let info;

  await withStudio(dir, async (open) => {
    const layer = async (solo, name, from, to) => {
      const stage = await open(format, { scale, solo, transparent: true });
      info = stage.info;
      const end = to ?? info.duration;
      const file = join(out, 'clips', `${name}.mov`);
      log(`Rendering ${name} (${(end - from).toFixed(2)}s)`);
      await encode({ stage, out: file, tier: 'final', from, to: end, alpha: true, label: name });
      clips.push({ name, file: `clips/${name}.mov`, start: from, duration: +(end - from).toFixed(4) });
      await stage.page.close();
    };
    await layer('__under', '00-background', 0);
    for (const [i, s] of info.scenes.entries()) await layer(s.id, `${String(i + 1).padStart(2, '0')}-${slugify(s.id)}`, s.start, s.end);
    const probe = await open(format, {});
    const hasOver = await probe.page.eval('[...document.querySelectorAll("#stage > .scene ~ :not(.scene)")].length > 0');
    await probe.page.close();
    if (hasOver) await layer('__over', '99-overlay', 0);
  });

  // Audio stems, placed where the cue sheet puts them.
  const sheet = await readJson(join(dir, 'audio', 'cues.json'), { cues: [] });
  const timing = info;
  const audio = [];
  for (const [i, c] of [sheet.music && { ...sheet.music, at: 0 }, ...(sheet.cues || [])].filter(Boolean).entries()) {
    const src = resolve(dir, c.file);
    if (!existsSync(src)) fail(`Audio file not found: ${c.file}`);
    const name = `${String(i).padStart(2, '0')}-${basename(c.file)}`;
    await copyFile(src, join(out, 'audio', name));
    const dur = parseFloat((await run(which('ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src])).stdout);
    const start = cueTime(c.at, timing);
    if (!Number.isFinite(start) || start < 0 || start >= info.duration) fail(`Cue ${c.file} at ${start}s is outside the ${info.duration}s piece.`);
    audio.push({ name, file: `audio/${name}`, start, duration: +Math.min(dur, info.duration - start).toFixed(4), gain: c.gain || 0 });
  }

  const fps = info.fps;
  const data = { name: project.name, format, width: Math.round(w * scale), height: Math.round(h * scale), fps, duration: info.duration, clips, audio };
  await writeJson(join(out, 'timeline.json'), data);

  // FCPXML: clips are connected to a gap so each sits on its own lane in stacking order.
  const fr = (sec) => `${Math.round(sec * fps)}/${fps}s`;
  const assets = [], placed = [];
  clips.forEach((c, i) => {
    assets.push(`    <asset id="v${i}" name="${xml(c.name)}" start="0s" duration="${fr(c.duration)}" hasVideo="1" format="r0" videoSources="1"><media-rep kind="original-media" src="${xml(pathToFileURL(join(out, c.file)).href)}"/></asset>`);
    placed.push(`          <asset-clip ref="v${i}" lane="${i + 1}" offset="${fr(c.start)}" start="0s" duration="${fr(c.duration)}" name="${xml(c.name)}"/>`);
  });
  audio.forEach((a, i) => {
    assets.push(`    <asset id="a${i}" name="${xml(a.name)}" start="0s" duration="${fr(a.duration)}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"><media-rep kind="original-media" src="${xml(pathToFileURL(join(out, a.file)).href)}"/></asset>`);
    placed.push(`          <asset-clip ref="a${i}" lane="${-(i + 1)}" offset="${fr(a.start)}" start="0s" duration="${fr(a.duration)}" name="${xml(a.name)}"><adjust-volume amount="${a.gain}dB"/></asset-clip>`);
  });
  const fcpxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r0" frameDuration="1/${fps}s" width="${data.width}" height="${data.height}" colorSpace="1-1-1 (Rec. 709)"/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="${xml(project.name)}">
      <project name="${xml(project.name)} (${format})">
        <sequence format="r0" duration="${fr(info.duration)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <gap name="Timeline" offset="0s" start="0s" duration="${fr(info.duration)}">
${placed.join('\n')}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
  const fcp = join(out, `${slugify(project.name)}-${format}.fcpxml`);
  await writeFile(fcp, fcpxml);

  // After Effects: File > Scripts > Run Script File. Paths are relative to this script.
  const jsx = `// Builds a Motion Studio composition in After Effects from the clips beside this script.
(function () {
  var base = File($.fileName).parent.fsName;
  var data = ${JSON.stringify(data).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};
  app.beginUndoGroup("Motion Studio timeline");
  var comp = app.project.items.addComp(data.name + " (" + data.format + ")", data.width, data.height, 1, data.duration, data.fps);
  var folder = app.project.items.addFolder("Motion Studio");
  function place(entry) {
    var item = app.project.importFile(new ImportOptions(new File(base + "/" + entry.file)));
    item.parentFolder = folder;
    var layer = comp.layers.add(item); // each new layer lands on top, so clips keep their stacking order
    layer.startTime = entry.start;
    layer.inPoint = entry.start;
    layer.outPoint = entry.start + entry.duration;
    layer.name = entry.name;
    return layer;
  }
  for (var i = 0; i < data.clips.length; i++) place(data.clips[i]);
  for (var j = 0; j < data.audio.length; j++) {
    var a = place(data.audio[j]);
    a.property("Audio").property("Audio Levels").setValue([data.audio[j].gain, data.audio[j].gain]);
  }
  comp.openInViewer();
  app.endUndoGroup();
})();
`;
  await writeFile(join(out, 'build-in-after-effects.jsx'), jsx);
  console.log(JSON.stringify({ timeline: out, fcpxml: fcp, afterEffects: join(out, 'build-in-after-effects.jsx'), clips: clips.length, audio: audio.length,
    note: 'FCPXML uses absolute file paths: relink if the folder moves.' }, null, 2));
}
