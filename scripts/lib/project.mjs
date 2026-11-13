import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { currentApprovals, fileDigest, sourceRevision } from './revision.mjs';
import {
  APPROVAL_STAGES, AUTONOMY, FORMATS, HOME, PLUGIN_ROOT, PROVENANCE, copyDir, fail, loadProject, projectDir,
  inside, namedSlug, readJson, saveProject, slugify, timecode, updateJson, writeJson,
} from './util.mjs';

/** init --dir <path> --name "X" [--client slug] [--duration 30] [--formats a,b] [--mode opinionated|faithful] [--autonomy guided|final-only|autonomous] */
export async function init(args) {
  if (!args.dir || !args.name) fail('Usage: init --dir <path> --name "Project name" [--client <brand>] [--duration 30]');
  const dir = resolve(String(args.dir));
  if (existsSync(join(dir, 'project.json'))) fail(`${dir} already contains a project.`);
  if (existsSync(dir) && (await readdir(dir)).length) fail(`${dir} is not empty. Choose a new or empty directory.`);
  const formats = args.formats ? String(args.formats).split(',') : Object.keys(FORMATS);
  for (const f of formats) if (!FORMATS[f]) fail(`Unknown format "${f}".`);
  const autonomy = args.autonomy || 'guided';
  if (!AUTONOMY[autonomy]) fail(`--autonomy must be one of ${Object.keys(AUTONOMY).join(', ')}.`);
  const mode = args.mode || 'opinionated';
  if (!['opinionated', 'faithful'].includes(mode)) fail('--mode must be opinionated or faithful.');
  const duration = args.duration === undefined ? 30 : Number(args.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 120) fail('--duration must be between 5 and 120 seconds (the studio is tuned for 15-60).');

  await copyDir(join(PLUGIN_ROOT, 'templates', 'project'), dir);
  for (const d of ['assets', 'audio/sfx', 'components', 'build', 'renders']) await mkdir(join(dir, d), { recursive: true });
  const project = {
    name: String(args.name),
    client: args.client ? slugify(args.client) : null,
    duration, fps: 30, resolution: 1080, formats,
    mode, autonomy, approvalsRequired: AUTONOMY[autonomy], approved: {},
    disclosure: 'label',
    qc: { rounds: 0 },
    createdAt: new Date().toISOString(),
  };
  await saveProject(dir, project);
  await writeJson(join(dir, 'assets', 'manifest.json'), { assets: [] });
  await writeJson(join(dir, 'feedback.json'), []);
  console.log(JSON.stringify({ created: dir, project }, null, 2));
}

/** status --project <dir>: one place to see where a production stands. */
export async function status(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  project.approved = await currentApprovals(dir, project);
  const feedback = await readFeedback(dir);
  const pending = project.approvalsRequired.filter((s) => !project.approved[s]);
  const renders = {};
  for (const tier of ['draft', 'final']) renders[tier] = project.formats.filter((f) => existsSync(join(dir, 'renders', tier, `${f}.mp4`)));
  console.log(JSON.stringify({
    name: project.name, client: project.client, mode: project.mode, autonomy: project.autonomy,
    nextApproval: pending[0] || null, approved: project.approved, changesRequested: project.changesRequested || null,
    qcRounds: project.qc.rounds, openNotes: feedback.filter((n) => n.status !== 'resolved').length, renders,
  }, null, 2));
}

/** approve --project <dir> --stage concept|storyboard|final [--note "..."]: record the user's approval. */
export async function approve(args) {
  const dir = projectDir(args);
  if (!APPROVAL_STAGES.includes(args.stage)) fail(`--stage must be one of ${APPROVAL_STAGES.join(', ')}.`);
  console.log(JSON.stringify(await recordDecision(dir, args.stage, true, args.note), null, 2));
}

export async function recordDecision(dir, stage, approved, note) {
  if (!APPROVAL_STAGES.includes(stage)) fail('Unknown approval stage.');
  return updateJson(join(dir, 'project.json'), async project => {
    if (approved) {
      project.approved[stage] = { at: new Date().toISOString(), ...(stage === 'final' ? { revision: await sourceRevision(dir) } : {}), ...(note && note !== true ? { note } : {}) };
      delete project.changesRequested;
    } else {
      delete project.approved[stage];
      project.changesRequested = { stage, at: new Date().toISOString() };
    }
    return { approved: project.approved, changesRequested: project.changesRequested || null };
  });
}

/** autonomy --project <dir> --level guided|final-only|autonomous */
export async function autonomy(args) {
  const dir = projectDir(args);
  if (!AUTONOMY[args.level]) fail(`--level must be one of ${Object.keys(AUTONOMY).join(', ')}.`);
  const project = await loadProject(dir);
  project.autonomy = args.level;
  project.approvalsRequired = AUTONOMY[args.level];
  await saveProject(dir, project);
  console.log(JSON.stringify({ autonomy: project.autonomy, approvalsRequired: project.approvalsRequired }));
}

// ---------- Feedback (timestamped notes from the preview) ----------

export const readFeedback = (dir) => readJson(join(dir, 'feedback.json'), []);

export async function addFeedback(dir, { t, format, scene, source, text }) {
  const note = {
    id: randomUUID().slice(0, 8), t: Math.max(0, Number(t) || 0), format: FORMATS[format] ? format : null,
    scene: scene ? String(scene).slice(0, 80) : null, source: source ? String(source).slice(0, 16) : null,
    text: String(text || '').slice(0, 2000), status: 'open', createdAt: new Date().toISOString(),
  };
  if (!note.text.trim()) fail('Note text is empty.');
  return updateJson(join(dir, 'feedback.json'), notes => { notes.push(note); return note; }, []);
}

export async function setFeedbackStatus(dir, id, value) {
  return updateJson(join(dir, 'feedback.json'), notes => {
    const note = notes.find((n) => n.id === id) || fail(`No note with id ${id}.`);
    note.status = value === 'resolved' ? 'resolved' : 'open';
    if (note.status === 'resolved') note.resolvedAt = new Date().toISOString();
    else delete note.resolvedAt;
    return note;
  }, []);
}

/** feedback --project <dir> [--all] | --resolve <id>[,<id>] | --add "text" --at <seconds> [--format f] */
export async function feedback(args) {
  const dir = projectDir(args);
  if (args.resolve) {
    for (const id of String(args.resolve).split(',')) await setFeedbackStatus(dir, id, 'resolved');
  } else if (args.add) {
    await addFeedback(dir, { t: args.at, format: args.format, text: args.add, source: 'chat' });
  }
  const notes = (await readFeedback(dir)).filter((n) => args.all || n.status !== 'resolved').sort((a, b) => a.t - b.t);
  console.log(JSON.stringify(notes.map((n) => ({ ...n, at: timecode(n.t) })), null, 2));
}

// ---------- Assets (every file carries provenance and licence) ----------

/** asset --project <dir> --add <file> --provenance authentic|illustrative|generated|licensed|brand [--license "..."] [--source "..."] [--as name] */
export async function asset(args) {
  const dir = projectDir(args);
  const file = join(dir, 'assets', 'manifest.json');
  const manifest = await readJson(file, { assets: [] });
  if (args.add) {
    if (!PROVENANCE.includes(args.provenance)) fail(`--provenance must be one of ${PROVENANCE.join(', ')}.`);
    const src = resolve(String(args.add));
    if (!existsSync(src)) fail(`File not found: ${src}`);
    const name = args.as && args.as !== true ? String(args.as) : basename(src);
    if (args.provenance === 'licensed' && (!args.license || args.license === true)) fail('--license is required for licensed assets.');
    const root = join(dir, 'assets');
    const dest = inside(root, name);
    if (dest === join(root, 'manifest.json')) fail('manifest.json is reserved for asset metadata.');
    const realRoot = await realpath(root);
    let parent = dirname(dest);
    while (!existsSync(parent)) parent = dirname(parent);
    const physicalParent = await realpath(parent);
    if (physicalParent !== realRoot && !physicalParent.startsWith(realRoot + sep)) fail('Asset path must stay inside assets.');
    if (existsSync(dest) && !(await realpath(dest)).startsWith(realRoot + sep)) fail('Asset path must stay inside assets.');
    await mkdir(dirname(dest), { recursive: true });
    if (resolve(dest) !== src) {
      if (existsSync(dest) && !args.force) fail(`${name} already exists. Pass --force to overwrite it.`);
      await copyFile(src, dest);
    }
    const registered = relative(dir, dest).split(sep).join('/');
    await registerAsset(dir, { path: registered, provenance: args.provenance, license: args.license, source: args.source });
    return console.log(JSON.stringify({ added: registered }));
  }
  console.log(JSON.stringify(manifest, null, 2));
}

export async function registerAsset(dir, { path, provenance, license, source, note }) {
  const file = join(dir, 'assets', 'manifest.json');
  const manifest = await readJson(file, { assets: [] });
  manifest.assets = manifest.assets.filter((a) => a.path !== path);
  manifest.assets.push({
    path, provenance,
    license: license && license !== true ? String(license) : provenance === 'generated' ? 'Generated for this project' : 'Supplied by client',
    source: source && source !== true ? String(source) : null,
    ...(note ? { note } : {}),
    addedAt: new Date().toISOString(),
  });
  await writeJson(file, manifest);
}

// ---------- Components (project collection + optional shared collection) ----------

const sharedDir = () => join(HOME, 'collection');

async function listComponents(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const meta = await readJson(join(root, e.name, 'component.json'), {});
    out.push({ name: e.name, description: meta.description || '', formats: meta.formats || [], path: join(root, e.name) });
  }
  return out;
}

/**
 * component --project <dir> [--list] | --publish <name> | --pull <name>
 * A component is a folder: component.json { description, formats, usage } + component.html + component.css.
 * Publishing copies it to the shared collection only when the user asks for it.
 */
export async function component(args) {
  const dir = projectDir(args);
  const local = join(dir, 'components');
  if (args.publish) {
    const name = namedSlug(args.publish);
    if (!existsSync(join(local, name, 'component.json'))) fail(`components/${name}/component.json not found.`);
    await copyDir(join(local, name), join(sharedDir(), name));
    return console.log(JSON.stringify({ published: join(sharedDir(), name) }));
  }
  if (args.pull) {
    const name = namedSlug(args.pull);
    if (!existsSync(join(sharedDir(), name))) fail(`No shared component "${name}".`);
    await copyDir(join(sharedDir(), name), join(local, name));
    return console.log(JSON.stringify({ pulled: `components/${name}` }));
  }
  console.log(JSON.stringify({ project: await listComponents(local), shared: await listComponents(sharedDir()) }, null, 2));
}

// ---------- Delivery ----------

/** deliver --project <dir>: assemble final videos, source, assets, audio, components and a provenance sheet. */
export async function deliver(args) {
  const dir = projectDir(args);
  const project = await loadProject(dir);
  const missing = project.formats.filter((f) => !existsSync(join(dir, 'renders', 'final', `${f}.mp4`)));
  if (missing.length) fail(`No final render for: ${missing.join(', ')}. Run "render --tier final" first.`);
  const revision = await sourceRevision(dir);
  const report = await readJson(join(dir, 'build/qc/report.json'), {});
  if (report.tier !== 'final' || !report.pass || report.revision !== revision || project.formats.some(f => !report.formats?.[f]?.render)) {
    fail('Current final QC has not passed for every project format. Render and run "qc --tier final" before delivery.');
  }
  for (const format of project.formats) {
    if (report.formats[format].digest !== await fileDigest(join(dir, 'renders/final', `${format}.mp4`))) fail(`Final ${format} render changed after QC. Run final QC again.`);
  }
  if (project.approvalsRequired.includes('final') && !(await currentApprovals(dir, project)).final && !args.force) {
    fail('Final preview is not approved yet. Get approval (or pass --force if the user asked to skip it).');
  }
  const out = join(dir, 'deliverables');
  const slug = slugify(project.name);
  const res = `${project.resolution || 1080}p${project.fps}`;
  await mkdir(join(out, 'video'), { recursive: true });
  const videos = [];
  for (const f of project.formats) {
    const name = `${slug}_${f}_${res}.mp4`;
    await copyFile(join(dir, 'renders', 'final', `${f}.mp4`), join(out, 'video', name));
    videos.push(`video/${name}`);
  }
  await copyDir(join(dir, 'composition'), join(out, 'source', 'composition'));
  const sourceHtml = join(out, 'source/composition/index.html');
  const html = await readFile(sourceHtml, 'utf8');
  await writeFile(sourceHtml, html.replace(/<html\b([^>]*)>/i, (_, attrs) => `<html${attrs.replace(/\sdata-disclosure\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')} data-disclosure="${project.disclosure === 'report-only' ? 'report-only' : 'label'}">`));
  await copyDir(join(PLUGIN_ROOT, 'runtime'), join(out, 'source', '__studio')); // source opens standalone in a browser
  if (existsSync(join(PLUGIN_ROOT, 'LICENSE'))) await copyFile(join(PLUGIN_ROOT, 'LICENSE'), join(out, 'source', '__studio', 'LICENSE'));
  for (const d of ['assets', 'audio', 'components']) if (existsSync(join(dir, d))) await copyDir(join(dir, d), join(out, 'source', d));
  for (const f of ['project.json', 'brief.md', 'concept.md', 'storyboard.md']) if (existsSync(join(dir, f))) await copyFile(join(dir, f), join(out, 'source', f));
  if (existsSync(join(dir, 'build', 'mix.wav'))) await copyFile(join(dir, 'build', 'mix.wav'), join(out, 'source', 'audio', 'mix.wav'));
  if (existsSync(join(dir, 'build', 'qc', 'report.json'))) await copyFile(join(dir, 'build', 'qc', 'report.json'), join(out, 'qc-report.json'));

  const timing = await readJson(join(dir, 'build', 'timing.json'), { scenes: [] });
  const manifest = await readJson(join(dir, 'assets', 'manifest.json'), { assets: [] });
  const cues = await readJson(join(dir, 'audio', 'cues.json'), { cues: [] });
  const label = { authentic: 'Authentic product footage', illustrative: 'Illustrative representation', generated: 'Generated', unspecified: 'Motion design (no product footage)' };
  const lines = [
    `# ${project.name}: provenance and licences`, '',
    'What in this video is real product footage and what is an illustration.', '',
    '## Scenes', '', '| Time | Scene | Content |', '| --- | --- | --- |',
    ...timing.scenes.map((s) => `| ${timecode(s.start)} | ${s.label} | ${label[s.provenance] || s.provenance} |`), '',
    '## Assets', '', '| File | Provenance | Licence | Source |', '| --- | --- | --- | --- |',
    ...manifest.assets.map((a) => `| ${a.path} | ${a.provenance} | ${a.license} | ${a.source || ''} |`), '',
    '## Audio', '',
    ...[cues.music, ...(cues.cues || [])].filter(Boolean).map((c) => `- ${c.file}: ${c.license || 'Procedurally generated by Motion Studio for this project'}`), '',
  ];
  await writeFile(join(out, 'PROVENANCE.md'), lines.join('\n'));
  await writeFile(join(out, 'README.md'), [
    `# ${project.name}`, '',
    ...videos.map((v) => `- ${v}`), '',
    '- `source/composition/index.html` opens in a browser and plays the piece (add `?format=vertical` or `?format=square`).',
    '- `source/audio/` holds the music, effects and final mix.',
    '- `PROVENANCE.md` lists authentic footage, illustrative scenes and asset licences.',
    existsSync(join(out, 'timeline')) ? '- `timeline/` holds per-scene clips and an editable timeline.' : '', '',
  ].join('\n'));
  if (await sourceRevision(dir) !== revision) fail('Production source changed during delivery. Render and run final QC again before delivery.');
  console.log(JSON.stringify({ deliverables: out, videos, files: (await readdir(out)).map((f) => relative(dir, join(out, f))) }, null, 2));
}
