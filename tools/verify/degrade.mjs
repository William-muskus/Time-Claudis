/**
 * What the game does when things go wrong, in a real browser.
 *
 * WHY. Everything else in tools/verify looks at the game working. Nobody had
 * ever watched it fail, and the failure paths turned out to be the worst code
 * in the project: a denied camera dropped the player into an attract demo with
 * a console warning they would never see, a missing WebGL2 context left a
 * title card whose button silently did nothing, and the audio context was
 * unlocked after an eight-megabyte download had already consumed the user
 * gesture that was the only thing allowed to unlock it.
 *
 * Each case below breaks one thing, in the browser, and checks what the player
 * is actually shown. No screenshots: these are assertions with answers.
 *
 *   node tools/verify/degrade.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const body = await readFile(join(DIST, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  s.listen(0, () => ok(s));
});
const port = server.address().port;
const URL_BASE = `http://localhost:${port}/`;

const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(PINNED) ? PINNED : undefined,
  // The landmark model is still fetched from a CDN, and this container only
  // reaches the outside world through an agent proxy. Chromium does not read
  // HTTPS_PROXY, so it has to be handed over explicitly or the real-tracker
  // case below cannot run at all.
  proxy: process.env.HTTPS_PROXY
    ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' }
    : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-gpu-sandbox', '--ignore-gpu-blocklist',
         '--ignore-certificate-errors'],
});

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

/** A page with getUserMedia replaced by one that always rejects with `name`. */
async function pageWithCameraError(name, message) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await page.addInitScript(({ n, m }) => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(Object.assign(new Error(m), { name: n })),
        enumerateDevices: () => Promise.resolve([]),
      },
    });
  }, { n: name, m: message });
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  return page;
}

async function faultText(page) {
  await page.click('#start');
  await page.waitForSelector('#fault.shown', { timeout: 20000 });
  return {
    title: (await page.textContent('#fault-title')).trim(),
    body: (await page.textContent('#fault-body')).trim(),
    titleCardStillUp: !(await page.evaluate(() => document.getElementById('title').classList.contains('gone'))),
    started: await page.evaluate(() => window.__ready === true),
  };
}

console.log('\nCAMERA DENIED');
{
  const page = await pageWithCameraError('NotAllowedError', 'Permission denied');
  const f = await faultText(page);
  ok('says the permission was denied', /denied/i.test(f.title), f.title);
  ok('tells them where the control is', /address bar/i.test(f.body));
  ok('does not start the game behind the message', f.titleCardStillUp && !f.started);
  ok('offers a way to try again', await page.isVisible('#fault-retry'));
  ok('offers the attract mode instead', await page.isVisible('#fault-demo'));
  // The whole point of asking for the camera before downloading the model:
  // this has to come back fast enough that the click and the answer are
  // obviously connected.
  await page.close();
}

console.log('\nNO CAMERA ATTACHED');
{
  const page = await pageWithCameraError('NotFoundError', 'Requested device not found');
  const f = await faultText(page);
  ok('distinguishes "no camera" from "denied"', /no camera/i.test(f.title), f.title);
  ok('does not send them to look for a permission they cannot grant',
     !/address bar/i.test(f.body));
  await page.close();
}

console.log('\nCAMERA IN USE BY SOMETHING ELSE');
{
  const page = await pageWithCameraError('NotReadableError', 'Could not start video source');
  const f = await faultText(page);
  ok('names the real cause', /busy/i.test(f.title), f.title);
  await page.close();
}

console.log('\nHAND-TRACKING MODEL CANNOT BE DOWNLOADED');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  // A camera that works, and a network that does not reach the CDN.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          const c = document.createElement('canvas');
          c.width = 640; c.height = 480;
          c.getContext('2d').fillRect(0, 0, 640, 480);
          return Promise.resolve(c.captureStream(30));
        },
        enumerateDevices: () => Promise.resolve([]),
      },
    });
  });
  await page.route('**/cdn.jsdelivr.net/**', (r) => r.abort());
  await page.route('**/storage.googleapis.com/**', (r) => r.abort());
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  const f = await faultText(page);
  ok('blames the download, not the camera', /hand tracking|download/i.test(f.title + f.body), f.title);
  ok('the camera is released again',
     await page.evaluate(() => {
       const v = document.getElementById('cam');
       const tracks = v?.srcObject?.getTracks?.() ?? [];
       return tracks.every((t) => t.readyState === 'ended');
     }),
     'a failed start must not leave the camera light on');
  await page.close();
}

console.log('\nFALLING BACK TO THE ATTRACT MODE');
{
  const page = await pageWithCameraError('NotAllowedError', 'Permission denied');
  await faultText(page);
  await page.click('#fault-demo');
  await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
  ok('the demo actually starts', await page.evaluate(() => window.__ready === true));
  ok('the title card gets out of the way',
     await page.evaluate(() => document.getElementById('title').classList.contains('gone')));
  await page.close();
}

console.log('\nAUDIO IS UNLOCKED BY THE CLICK ITSELF');
{
  // THE BUG THIS EXISTS FOR. unlock() used to run after `await tracker.init()`,
  // which is an 8 MB download and a permission prompt. A browser will not let
  // an AudioContext created that far from a user gesture leave the suspended
  // state, so the game was very probably silent for everyone — and on the
  // camera-failure path unlock() was never reached at all.
  const page = await pageWithCameraError('NotAllowedError', 'Permission denied');
  await page.evaluate(() => {
    window.__ctxStates = [];
    const Real = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = class extends Real {
      constructor(...a) { super(...a); window.__ctxStates.push(this); }
    };
  });
  await page.click('#start');
  await page.waitForSelector('#fault.shown', { timeout: 20000 });
  const states = await page.evaluate(() => (window.__ctxStates ?? []).map((c) => c.state));
  ok('an AudioContext exists after one click', states.length > 0, `got ${states.length}`);
  ok('and it is not stuck suspended', states.length > 0 && states.every((s) => s !== 'suspended'),
     `states: ${states.join(', ')}`);
  await page.close();
}

console.log('\nNO WEBGL2');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (String(type).startsWith('webgl')) return null;
      return orig.call(this, type, ...rest);
    };
  });
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('#fault.shown', { timeout: 20000 });
  const title = (await page.textContent('#fault-title')).trim();
  ok('says 3D is unavailable rather than showing a dead button', /3d/i.test(title), title);
  ok('names hardware acceleration as the likely cause',
     /acceleration/i.test(await page.textContent('#fault-body')));
  await page.close();
}

console.log('\nTRACKING LOST MID-WAVE (the real tracker, on a camera with no hand in it)');
{
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  // A camera that works and shows nothing. MediaPipe will run, find no hand,
  // and the game has to say so rather than silently locking the player in
  // cover with the area clock running.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          const c = document.createElement('canvas');
          c.width = 640; c.height = 480;
          const g = c.getContext('2d');
          (function paint() { g.fillStyle = '#202024'; g.fillRect(0, 0, 640, 480); requestAnimationFrame(paint); })();
          return Promise.resolve(c.captureStream(30));
        },
        enumerateDevices: () => Promise.resolve([]),
      },
    });
  });
  await page.goto(URL_BASE, { waitUntil: 'load', timeout: 120000 });
  await page.click('#start');
  let started = true;
  try {
    await page.waitForFunction(() => window.__ready === true, { timeout: 180000 });
  } catch {
    started = false;
    const t = await page.textContent('#fault-title').catch(() => '(no fault shown)');
    ok('the real hand tracker starts', false,
       `never became ready — ${t}. The landmark model is still fetched from ` +
       'storage.googleapis.com; if that is unreachable this case cannot run.');
  }
  if (started) {
    ok('the real hand tracker starts', true);
    ok('the local WASM runtime was used, not the CDN',
       !warnings.some((w) => /local MediaPipe runtime unavailable/.test(w)),
       warnings.filter((w) => /MediaPipe/.test(w)).join(' | '));
    // The banner waits 0.9 s so an ordinary dropped frame does not flicker it.
    await page.waitForSelector('#handlost.shown', { timeout: 30000 })
      .then(() => ok('the player is told the hand is lost', true))
      .catch(() => ok('the player is told the hand is lost', false,
        'no HAND LOST banner after seconds of an empty camera'));
    ok('and is held in cover rather than left exposed',
       await page.evaluate(() => window.__game.snapshot().coverState !== 'EXPOSED'),
       await page.evaluate(() => window.__game.snapshot().coverState));
    ok('the corner chip agrees',
       (await page.textContent('#cam-status')).trim().toLowerCase() === 'no hand');
  }
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${failures === 0 ? 'all degradation paths behave' : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
