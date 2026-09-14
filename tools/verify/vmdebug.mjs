/** One-shot diagnostic: what is the viewmodel actually doing? */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const b = await readFile(join(DIST, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  s.listen(0, () => ok(s));
});
const port = server.address().port;
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: existsSync(PINNED) ? PINNED : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 220)));
page.on('pageerror', (e) => console.log('[PAGEERROR]', e.message.slice(0, 300)));
page.on('requestfailed', (r) => console.log('[REQFAIL]', r.url().slice(-50), r.failure()?.errorText));

await page.goto(`http://localhost:${port}/?demo=1&fixed=${1 / 60}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.evaluate(async () => { for (let i = 0; i < 60; i++) await new Promise((r) => requestAnimationFrame(() => r())); });

const info = await page.evaluate(() => {
  const THREE = window.__THREE;
  const vm = window.__vm;
  const r = window.__renderer;
  return {
    viewModelReady: window.__viewModelReady,
    vmExists: !!vm,
    vmIsReady: vm?.ready,
    modelsLoaded: vm ? [...vm.models.keys()] : null,
    currentKey: vm?.currentKey,
    currentVisible: vm?.current?.visible,
    rootVisible: vm?.root?.visible,
    rootPos: vm?.root ? vm.root.position.toArray().map((n) => +n.toFixed(3)) : null,
    sceneChildren: vm?.scene?.children?.length,
    passes: r?.composer?.passes?.map((p) => p.constructor.name),
    vmPassClear: r?.viewmodelPass?.clear,
    vmPassClearDepth: r?.viewmodelPass?.clearDepth,
    vmCamAspect: vm?.camera?.aspect,
    meshCount: (() => { let n = 0; vm?.root?.traverse?.((o) => { if (o.isMesh) n++; }); return n; })(),

    // Where is the gun actually, in screen space?
    projected: (() => {
      if (!vm?.current || !THREE) return 'no THREE on window';
      vm.camera.updateMatrixWorld(true);
      vm.camera.updateProjectionMatrix();
      vm.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(vm.current);
      if (box.isEmpty()) return 'EMPTY BOUNDING BOX';
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const ndc = c.clone().project(vm.camera);
      return {
        worldCentre: c.toArray().map((n) => +n.toFixed(3)),
        size: size.toArray().map((n) => +n.toFixed(3)),
        ndc: ndc.toArray().map((n) => +n.toFixed(3)),
        onScreen: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z >= -1 && ndc.z <= 1,
        screenPct: [((ndc.x + 1) / 2 * 100).toFixed(1), ((1 - ndc.y) / 2 * 100).toFixed(1)],
      };
    })(),
    camNear: vm?.camera?.near,
    camFar: vm?.camera?.far,
    camPos: vm?.camera?.position?.toArray?.(),
    materialCount: (() => {
      const mats = [];
      vm?.current?.traverse?.((o) => { if (o.isMesh && o.material) mats.push({
        type: o.material.type, visible: o.visible, transparent: o.material.transparent,
        opacity: o.material.opacity, depthTest: o.material.depthTest, colorWrite: o.material.colorWrite,
      }); });
      return mats.slice(0, 3);
    })(),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
server.close();
