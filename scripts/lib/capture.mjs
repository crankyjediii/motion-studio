import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openBrowser } from './chrome.mjs';
import { registerAsset } from './project.mjs';
import { encodeFrames, fail, log, projectDir, slugify } from './util.mjs';

/**
 * capture --project <dir> --url <http(s) url> [--name hero] [--viewport 1440x900] [--mobile]
 *         [--full] [--scroll <seconds>] [--wait <ms>]
 * Captures the real product in a headless browser: a screenshot, and optionally a smooth scroll recording.
 * Results land in assets/captures/ and are registered as AUTHENTIC footage with their source URL.
 * Public or local pages only: it does not sign in to anything.
 */
export async function capture(args) {
  const dir = projectDir(args);
  let url;
  try { url = new URL(String(args.url)); } catch { fail('--url must be a full http(s) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) fail('--url must be http or https.');
  const mobile = !!args.mobile;
  const [w, h] = (args.viewport && args.viewport !== true ? String(args.viewport) : mobile ? '390x844' : '1440x900').split('x').map(Number);
  if (![w, h].every(n => Number.isInteger(n) && n > 0 && n <= 12000)) fail('--viewport must contain positive dimensions, like 1440x900 (maximum 12000).');
  const seconds = args.scroll === undefined ? null : args.scroll === true ? 4 : Number(args.scroll);
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 1 / 30 || seconds > 30)) fail('--scroll must be between 1/30 and 30 seconds.');
  const scale = mobile ? 3 : 2;
  const name = slugify(args.name && args.name !== true ? args.name : url.hostname + url.pathname) || 'capture';
  const folder = join(dir, 'assets', 'captures');
  await mkdir(folder, { recursive: true });
  const browser = await openBrowser();
  const made = [];
  try {
    const page = await browser.newPage({ width: w, height: h, scale, mobile });
    await page.goto(url.href);
    await new Promise((r) => setTimeout(r, parseInt(args.wait, 10) || 1200));
    await page.eval('document.documentElement.style.scrollBehavior = "auto"; document.fonts.ready.then(() => true)');
    const meta = { source: url.href, note: `Captured ${w}x${h}@${scale}x on ${new Date().toISOString().slice(0, 10)}` };

    await writeFile(join(folder, `${name}.png`), await page.screenshot({ format: 'png' }));
    made.push(`assets/captures/${name}.png`);

    if (args.full) {
      const height = Math.min(await page.eval('document.documentElement.scrollHeight'), 12000);
      await writeFile(join(folder, `${name}-full.png`), await page.screenshot({ format: 'png', clip: { x: 0, y: 0, width: w, height, scale: 1 } }));
      made.push(`assets/captures/${name}-full.png`);
    }

    if (args.scroll) {
      const fps = 30, total = Math.max(1, Math.round(seconds * fps));
      const max = await page.eval('Math.max(0, document.documentElement.scrollHeight - innerHeight)');
      if (!max) log('Page does not scroll; skipping scroll recording.');
      else {
        const out = join(folder, `${name}-scroll.mp4`);
        async function* frames() {
          for (let i = 0; i < total; i++) {
            const p = total === 1 ? 0 : i / (total - 1);
            const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
            await page.eval(`window.scrollTo(0, ${Math.round(max * eased)}); new Promise(r => requestAnimationFrame(() => r(true)))`);
            yield await page.screenshot({ format: 'jpeg', quality: 94 });
          }
        }
        await encodeFrames(['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-movflags', '+faststart'], frames(), out);
        made.push(`assets/captures/${name}-scroll.mp4`);
      }
    }
    for (const path of made) await registerAsset(dir, { path, provenance: 'authentic', license: 'Capture of the client\'s own product', ...meta });
    console.log(JSON.stringify({ captured: made, provenance: 'authentic', source: url.href, problems: [...new Set(page.problems)].slice(0, 5) }, null, 2));
  } finally {
    await browser.close();
  }
}
