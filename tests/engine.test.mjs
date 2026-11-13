import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { findChrome, openBrowser } from '../scripts/lib/chrome.mjs';
import { withStudio } from '../scripts/lib/render.mjs';
import { serve } from '../scripts/lib/server.mjs';
import { which } from '../scripts/lib/util.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const exec = promisify(execFile);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value));
const pngSize = async (path) => { const b = await readFile(path); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('project, browser and media workflows', { timeout: 300000 }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'motion-studio-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const project = join(temp, 'project');
  const env = { ...process.env, MOTION_STUDIO_HOME: join(temp, 'home') };
  const cli = async (...args) => {
    const result = await exec(process.execPath, [join(root, 'scripts/studio.mjs'), ...args], { env, maxBuffer: 8 * 1024 * 1024, timeout: 180000 });
    return JSON.parse(result.stdout);
  };
  const command = (name, ...args) => cli(name, '--project', project, ...args);
  const reject = (fn, pattern) => assert.rejects(fn, (e) => pattern.test(e.stderr || e.message));
  await cli('init', '--dir', project, '--name', 'Engine test', '--duration', '5', '--autonomy', 'autonomous');

  await t.test('initialization never overwrites an existing folder', async () => {
    const target = join(temp, 'existing');
    await mkdir(target);
    await writeFile(join(target, 'keep.txt'), 'keep');
    await reject(() => cli('init', '--dir', target, '--name', 'No overwrite'), /not empty|empty directory/i);
    assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'keep');
    await reject(() => cli('init', '--dir', join(temp, 'bad'), '--name', 'Bad', '--duration', 'NaN'), /duration/i);
  });

  await t.test('asset registration stays inside assets and keeps licence terms', async () => {
    const source = join(temp, 'logo.svg');
    await writeFile(source, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#ee7744"/></svg>');
    await reject(() => command('asset', '--add', source, '--as', '../escape.svg', '--provenance', 'brand'), /inside|relative|path/i);
    await reject(() => command('asset', '--add', source, '--as', 'manifest.json', '--provenance', 'brand'), /manifest|reserved/i);
    await reject(() => command('asset', '--add', source, '--as', 'logos/../manifest.json', '--provenance', 'brand'), /manifest|reserved/i);
    if (process.platform !== 'win32') {
      const outside = join(temp, 'outside-assets');
      await mkdir(outside);
      await symlink(outside, join(project, 'assets/link'));
      await reject(() => command('asset', '--add', source, '--as', 'link/new/file.svg', '--provenance', 'brand'), /inside|path/i);
      assert.equal(existsSync(join(outside, 'new')), false);
      await rm(join(project, 'assets/link'));
    }
    await reject(() => command('asset', '--add', source, '--provenance', 'licensed'), /licen[cs]e/i);
    await command('asset', '--add', source, '--as', 'logos/test.svg', '--provenance', 'licensed', '--license', 'Test fixture; not for distribution', '--source', 'local fixture');
    assert.ok(existsSync(join(project, 'assets/logos/test.svg')));
    const manifest = await command('asset');
    assert.equal(manifest.assets[0].license, 'Test fixture; not for distribution');
    await reject(() => command('asset', '--add', source, '--as', 'logos/test.svg', '--provenance', 'brand'), /exists|overwrite/i);
  });

  await t.test('autonomy, feedback and local component round trips', async () => {
    assert.deepEqual((await command('autonomy', '--level', 'guided')).approvalsRequired, ['concept', 'storyboard', 'final']);
    assert.deepEqual((await command('autonomy', '--level', 'autonomous')).approvalsRequired, []);
    const notes = await command('feedback', '--add', 'Fixture revision', '--at', '1.2', '--format', 'square');
    assert.equal(notes[0].t, 1.2);
    assert.deepEqual(await command('feedback', '--resolve', notes[0].id), []);
    assert.equal((await command('feedback', '--all'))[0].status, 'resolved');
    const component = join(project, 'components/title');
    await mkdir(component);
    await save(join(component, 'component.json'), { description: 'Fixture', formats: ['square'] });
    await writeFile(join(component, 'component.html'), '<h1>Title</h1>');
    await command('component', '--publish', 'title');
    await rm(component, { recursive: true });
    await command('component', '--pull', 'title');
    assert.equal(await readFile(join(component, 'component.html'), 'utf8'), '<h1>Title</h1>');
    await reject(() => command('component', '--publish', '---'), /name|slug/i);
  });

  await t.test('brand logo and font files apply without mixing clients', async () => {
    await cli('brand', '--init', 'fixture', '--name', 'Fixture');
    await cli('brand', '--add-file', join(temp, 'logo.svg'), '--to', 'fixture', '--kind', 'logo');
    const profile = join(env.MOTION_STUDIO_HOME, 'brands/fixture/brand.json');
    const b = await json(profile);
    b.logos.primary = 'logos/logo.svg';
    const font = process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : process.env.MOTION_STUDIO_TEST_FONT;
    if (font && existsSync(font)) {
      await cli('brand', '--add-file', font, '--to', 'fixture', '--kind', 'font');
      b.typography.display = { family: 'Fixture Font', file: `fonts/${font.split(/[\\/]/).at(-1)}`, weight: '400', fallback: 'sans-serif' };
    }
    await save(profile, b);
    await command('brand', '--apply', 'fixture');
    assert.match(await readFile(join(project, 'composition/brand.css'), 'utf8'), /--brand-logo-primary/);
    if (b.typography.display.file) assert.match(await readFile(join(project, 'composition/brand.css'), 'utf8'), /@font-face/);
    await cli('brand', '--init', 'other', '--name', 'Other');
    await reject(() => command('brand', '--apply', 'other'), /belongs to brand/);
  });

  await t.test('static server serves ranges and blocks paths through symlinks', async () => {
    const outside = join(temp, 'outside.txt');
    await writeFile(outside, 'private fixture');
    if (process.platform !== 'win32') await symlink(outside, join(project, 'assets/outside.txt'));
    const server = await serve(project);
    try {
      const range = await fetch(server.url + '/assets/logos/test.svg', { headers: { Range: 'bytes=0-9' } });
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 10);
      if (process.platform !== 'win32') assert.equal((await fetch(server.url + '/assets/outside.txt')).status, 403);
      assert.equal((await fetch(server.url + '/%2e%2e%2foutside.txt')).status, 403);
    } finally { await server.close(); }
    await rm(join(project, 'assets/outside.txt'), { force: true });
  });

  if (!findChrome() || !which('ffmpeg') || !which('ffprobe')) {
    await t.test('browser and media checks', { skip: 'Install Chromium, ffmpeg and ffprobe to run these checks.' }, () => {});
    return;
  }

  await t.test('desktop full-page, scroll and mobile captures are registered', async () => {
    const pageRoot = join(temp, 'site');
    await mkdir(pageRoot);
    await writeFile(join(pageRoot, 'page.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#dbceae}.hero{height:100vh;background:#334455;color:white}.tail{height:1800px;background:linear-gradient(#d86643,#72b1b0)}</style><div class="hero">Viewport-sized hero</div><div class="tail">End</div>');
    const server = await serve(pageRoot);
    try {
      const captured = await command('capture', '--url', server.url + '/page.html', '--name', 'desktop', '--viewport', '320x240', '--full', '--scroll', '0.4', '--wait', '20');
      assert.equal(captured.captured.length, 3);
      assert.deepEqual(await pngSize(join(project, 'assets/captures/desktop.png')), [640, 480]);
      assert.deepEqual(await pngSize(join(project, 'assets/captures/desktop-full.png')), [640, 4080]);
      const probe = JSON.parse((await exec(which('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', join(project, 'assets/captures/desktop-scroll.mp4')])).stdout);
      assert.equal(probe.streams[0].nb_frames, '12');
      await command('capture', '--url', server.url + '/page.html', '--name', 'mobile', '--mobile', '--wait', '20');
      assert.deepEqual(await pngSize(join(project, 'assets/captures/mobile.png')), [1170, 2532]);
      assert.ok((await command('asset')).assets.filter(a => a.path.startsWith('assets/captures/')).every(a => a.provenance === 'authentic'));
    } finally { await server.close(); }
  });

  await exec(which('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(temp, 'fixture.mp4')]);
  await command('asset', '--add', join(temp, 'fixture.mp4'), '--provenance', 'generated');
  await writeFile(join(project, 'composition/index.html'), `<!doctype html><html><head><link rel="stylesheet" href="../__studio/studio.css"><link rel="stylesheet" href="brand.css"><link rel="stylesheet" href="style.css"><script src="../__studio/stage.js"></script></head><body><main id="stage"><div class="layer" style="background:#d8c8a5"></div><section class="scene" id="hook" data-dur="1"><h1>Make room</h1></section><section class="scene" id="product" data-dur="4" data-provenance="illustrative"><div data-ui><video muted src="../assets/fixture.mp4" data-from="0.2" data-rate="1.5"></video></div><h1>For focused work</h1></section><div class="layer overlay"><span>TEST</span></div></main></body></html>`);
  await writeFile(join(project, 'composition/style.css'), 'h1{position:absolute;left:15%;top:35%;font:100px sans-serif;color:#152027;animation:sway 5s linear both}video{width:50%;margin:12% 25%}.overlay span{position:absolute;right:10%;bottom:20%;font:40px sans-serif;color:#152027}html[data-format="vertical"] h1{font-size:80px;max-width:65%}html[data-format="square"] h1{font-size:90px}@keyframes sway{from{transform:translateX(0)}to{transform:translateX(12px)}}');
  const settings = await json(join(project, 'project.json'));
  settings.resolution = 720;
  await save(join(project, 'project.json'), settings);

  await t.test('video seeks are deterministic, clamped and scene-local', async () => {
    await withStudio(project, async (open) => {
      const stage = await open('horizontal', { scale: 0.25 });
      await stage.page.eval('__studio.seek(1.4)');
      assert.ok(Math.abs(await stage.page.eval('document.querySelector("video").currentTime') - 0.8) < 0.01);
      const first = await stage.page.screenshot();
      await stage.page.eval('__studio.seek(2)');
      await stage.page.eval('__studio.seek(1.4)');
      assert.deepEqual(await stage.page.screenshot(), first);
      const start = Date.now();
      await stage.page.eval('__studio.seek(4.9)');
      await stage.page.eval('__studio.seek(4.95)');
      assert.ok(Date.now() - start < 2500, 'seeking beyond the video end must not wait for a timeout');
      assert.ok(await stage.page.eval('document.querySelector("video").paused'));
    });
  });

  await t.test('QC catches words clipped by an ancestor inside the stage', async () => {
    await withStudio(project, async open => {
      const stage = await open('horizontal');
      await stage.page.eval(`__studio.seek(0.5); const clip = document.createElement('div'); clip.style.cssText='position:absolute;left:300px;top:200px;width:100px;overflow:hidden'; clip.innerHTML='<span style="font:80px sans-serif;white-space:nowrap">Notifications</span>'; document.querySelector('#hook').append(clip)`);
      const issues = await stage.page.eval('__studio.inspect()');
      assert.ok(issues.some(i => i.code === 'text-cropped' && i.detail.includes('Notifications')));
    });
  });

  await t.test('disclosure follows project settings in captures', async () => {
    await withStudio(project, async open => {
      const stage = await open('square');
      await stage.page.eval('__studio.seek(2)');
      assert.equal(await stage.page.eval('getComputedStyle(document.querySelector("#product"),"::after").content'), '"Illustrative interface"');
    });
    const p = await json(join(project, 'project.json'));
    p.disclosure = 'report-only';
    await save(join(project, 'project.json'), p);
    await withStudio(project, async open => {
      const stage = await open('square');
      assert.equal(await stage.page.eval('getComputedStyle(document.querySelector("#product"),"::after").display'), 'none');
    });
  });

  await t.test('partial ranges validate and non-default resolution encodes', async () => {
    await reject(() => command('render', '--from', '3', '--to', '1'), /from|range/i);
    await reject(() => command('render', '--from', 'NaN'), /from|number/i);
    const part = await command('render', '--tier', 'final', '--format', 'horizontal', '--from', '1', '--to', '1.2');
    assert.equal(part.rendered[0].frames, 6);
    assert.equal(part.rendered[0].width, 1280);
    const probe = JSON.parse((await exec(which('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', part.rendered[0].out])).stdout);
    assert.equal(probe.streams[0].width, 1280);
    assert.equal(probe.streams[0].height, 720);
  });

  await t.test('final QC fails when files have not been rendered', async () => {
    await reject(() => command('qc', '--tier', 'final'), /./);
    const report = await json(join(project, 'build/qc/report.json'));
    assert.equal(report.pass, false);
    assert.ok(Object.values(report.formats).every(f => f.issues.some(i => i.code === 'not-rendered' && i.level === 'error')));
    for (const round of [2, 3]) {
      await reject(() => command('qc', '--tier', 'final', '--format', 'horizontal'), /./);
      assert.equal((await json(join(project, 'build/qc/report.json'))).round, round);
    }
    assert.match((await json(join(project, 'build/qc/report.json'))).next, /Correction limit reached/);
  });

  await t.test('preview supports play, scrub, formats, notes and pausing embedded media', async () => {
    const proc = spawn(process.execPath, [join(root, 'scripts/studio.mjs'), 'preview', '--project', project, '--port', '19471'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let browser;
    try {
      const first = await Promise.race([once(proc.stdout, 'data'), once(proc, 'exit').then(() => { throw new Error('preview exited'); })]);
      const url = JSON.parse(first[0].toString()).preview;
      browser = await openBrowser();
      const page = await browser.newPage({ width: 1280, height: 900 });
      await page.goto(url);
      await page.eval('(async()=>{for(let i=0;i<100&&!studio;i++)await new Promise(r=>setTimeout(r,50));if(!studio)throw Error("preview did not load")})()');
      await page.eval('setTime(1.3); play()');
      await new Promise(r => setTimeout(r, 250));
      assert.ok(await page.eval('t > 1.3'));
      await page.eval('pause()');
      assert.equal(await page.eval('live.contentDocument.querySelector("video").paused'), true);
      await page.eval('document.querySelector("#formats button[data-format=square]").click()');
      await page.eval('(async()=>{for(let i=0;i<100&&(!studio||studio.format!=="square");i++)await new Promise(r=>setTimeout(r,50))})()');
      assert.equal(await page.eval('studio.format'), 'square');
      await page.eval('setTime(2.1); document.querySelector("#notetext").value="Test note"; document.querySelector("#noteform").requestSubmit()');
      await page.eval('(async()=>{for(let i=0;i<100&&!document.querySelector("#notes p")?.textContent.includes("Test note");i++)await new Promise(r=>setTimeout(r,50))})()');
      assert.equal((await command('feedback'))[0].text, 'Test note');
      const concurrent = await Promise.all(Array.from({ length: 12 }, (_, i) => fetch(url + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ text: `Concurrent ${i}`, t: 0.5 }) })));
      assert.ok(concurrent.every(r => r.ok));
      assert.equal((await command('feedback')).filter(n => n.text.startsWith('Concurrent')).length, 12);
      const before = await page.eval('t');
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
      assert.ok(Math.abs(await page.eval('t') - before - 1 / 30) < 0.001);
      const denied = await fetch(url + '/api/feedback', { method: 'POST', headers: { Origin: 'https://example.invalid' }, body: JSON.stringify({ text: 'bad' }) });
      assert.equal(denied.status, 403);
      assert.deepEqual(page.problems, []);
    } finally {
      if (browser) await browser.close();
      proc.kill();
      if (proc.exitCode === null) await once(proc, 'exit');
    }
  });

  const hasProres = /prores_ks/.test((await exec(which('ffmpeg'), ['-hide_banner', '-encoders'])).stdout);
  await t.test('timeline exports an alpha overlay and bounded After Effects layers', { skip: !hasProres && 'ffmpeg needs the optional prores_ks encoder.' }, async () => {
    const path = join(project, 'project.json');
    const p = await json(path);
    await save(path, { ...p, resolution: 216 });
    try {
      const result = await command('timeline', '--format', 'square');
      const data = await json(join(result.timeline, 'timeline.json'));
      assert.equal(data.clips.at(-1).name, '99-overlay');
      assert.equal(data.width, 216);
      const overlay = join(result.timeline, data.clips.at(-1).file);
      const probe = JSON.parse((await exec(which('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', overlay])).stdout);
      assert.match(probe.streams[0].pix_fmt, /^yuva/);
      assert.match(await readFile(result.afterEffects, 'utf8'), /layer.outPoint = entry.start \+ entry.duration/);
      if (which('xmllint')) await exec(which('xmllint'), ['--noout', result.fcpxml]);
    } finally { await save(path, p); }
  });

  await t.test('final renders, current QC and portable delivery', async () => {
    await command('music', '--style', 'editorial', '--hit', '3');
    await save(join(project, 'audio/cues.json'), { target: -14, music: { file: 'audio/music.wav', gain: -3 }, cues: [] });
    await command('mix');
    await command('render', '--tier', 'final');
    await reject(() => command('deliver'), /QC|quality/i);
    const report = await command('qc', '--tier', 'final', '--reset');
    assert.equal(report.pass, true);
    const delivery = await command('deliver');
    assert.equal(delivery.videos.length, 3);
    assert.match(await readFile(join(project, 'deliverables/source/composition/index.html'), 'utf8'), /data-disclosure="report-only"/);
    const browser = await openBrowser();
    try {
      const page = await browser.newPage({ width: 1080, height: 1080 });
      await page.goto(pathToFileURL(join(project, 'deliverables/source/composition/index.html')).href + '?render=1&format=square');
      await page.eval('__studio.ready');
      await page.eval('__studio.seek(1.4)');
      assert.equal(await page.eval('getComputedStyle(document.querySelector("#product"),"::after").display'), 'none');
      assert.ok(await page.eval('document.querySelector("video").readyState >= 2'));
      assert.deepEqual(await page.eval('__studio.inspect().filter(i=>i.level==="error")'), []);
    } finally { await browser.close(); }
    // Simulated approval in this temporary fixture; never an approval of the user's work.
    await command('approve', '--stage', 'final', '--note', 'Temporary regression fixture');
    assert.ok((await command('status')).approved.final);
    const finalFile = join(project, 'renders/final/square.mp4');
    const video = await readFile(finalFile);
    await writeFile(finalFile, Buffer.concat([video, Buffer.from('changed')]));
    await reject(() => command('deliver'), /changed|QC/i);
    await writeFile(finalFile, video);
    await writeFile(join(project, 'composition/style.css'), '\n/* revision after final render */\n', { flag: 'a' });
    assert.equal((await command('status')).approved.final, undefined);
    await reject(() => command('deliver'), /stale|changed|render|revision/i);
  });
});
