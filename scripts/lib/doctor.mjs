import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findChrome } from './chrome.mjs';
import { HOME, run, which } from './util.mjs';

const INSTALL = {
  darwin: { ffmpeg: 'brew install ffmpeg', chrome: 'brew install --cask google-chrome', node: 'brew install node' },
  win32: { ffmpeg: 'winget install --id Gyan.FFmpeg -e', chrome: 'winget install --id Google.Chrome -e', node: 'winget install --id OpenJS.NodeJS.LTS -e' },
  linux: { ffmpeg: 'sudo apt-get install -y ffmpeg', chrome: 'sudo apt-get install -y chromium', node: 'see https://nodejs.org/en/download' },
};

/** Installed creative apps the studio can hand off to. Detection only: nothing is launched. */
function findApps() {
  const found = {};
  const scan = (root, patterns) => {
    if (!root || !existsSync(root)) return;
    let names = [];
    try { names = readdirSync(root); } catch { return; }
    for (const [key, re] of Object.entries(patterns)) {
      const hit = names.find((n) => re.test(n));
      if (hit && !found[key]) found[key] = join(root, hit);
    }
  };
  if (process.platform === 'darwin') {
    scan('/Applications', {
      afterEffects: /^Adobe After Effects/, premiere: /^Adobe Premiere Pro/, finalCut: /^Final Cut Pro\.app$/,
      blender: /^Blender\.app$/, appleMotion: /^Motion\.app$/,
    });
    scan('/Applications/DaVinci Resolve', { resolve: /^DaVinci Resolve\.app$/ });
  } else if (process.platform === 'win32') {
    const pf = process.env.PROGRAMFILES;
    scan(pf && join(pf, 'Adobe'), { afterEffects: /^Adobe After Effects/, premiere: /^Adobe Premiere Pro/ });
    scan(pf && join(pf, 'Blackmagic Design'), { resolve: /^DaVinci Resolve$/ });
    scan(pf && join(pf, 'Blender Foundation'), { blender: /^Blender/ });
  }
  if (!found.blender && which('blender')) found.blender = which('blender');
  return found;
}

/** doctor: report what is installed and what is missing. Never installs anything. */
export async function doctor() {
  const os = INSTALL[process.platform] ? process.platform : 'linux';
  const nodeMajor = parseInt(process.versions.node, 10);
  const ffmpeg = which('ffmpeg'), ffprobe = which('ffprobe'), chrome = findChrome();
  let encoders = '';
  if (ffmpeg) encoders = (await run(ffmpeg, ['-hide_banner', '-encoders'], { allowFail: true })).stdout;
  const required = [
    { name: 'node', ok: nodeMajor >= 22, found: process.version, need: 'Node 22 or newer', install: INSTALL[os].node },
    { name: 'ffmpeg', ok: !!ffmpeg && !!ffprobe, found: ffmpeg, need: 'ffmpeg and ffprobe on PATH', install: INSTALL[os].ffmpeg },
    { name: 'h264 encoder', ok: /libx264/.test(encoders), found: /libx264/.test(encoders) ? 'libx264' : null, need: 'ffmpeg built with libx264', install: INSTALL[os].ffmpeg },
    { name: 'browser', ok: !!chrome, found: chrome, need: 'Chrome, Edge or Chromium (used headless to render frames)', install: INSTALL[os].chrome },
  ];
  const apps = findApps();
  const report = {
    platform: process.platform,
    ready: required.every((r) => r.ok),
    required,
    missing: required.filter((r) => !r.ok).map((r) => ({ name: r.name, need: r.need, install: r.install })),
    optional: {
      proresAlpha: /prores_ks/.test(encoders), // needed for editable-timeline scene clips
      apps,
      timelineTargets: [
        ...(apps.finalCut ? ['Final Cut Pro (FCPXML)'] : []),
        ...(apps.resolve ? ['DaVinci Resolve (FCPXML)'] : []),
        ...(apps.afterEffects ? ['After Effects (JSX build script)'] : []),
        ...(apps.premiere ? ['Premiere Pro (import clips; FCPXML via Resolve or XtoCC)'] : []),
      ],
      blender3d: !!apps.blender,
    },
    home: HOME,
    note: 'Nothing was installed. Ask the user before running any install command.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 2;
}
