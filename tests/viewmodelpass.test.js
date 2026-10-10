import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViewModelPass } from '../src/render/viewmodel.js';

/**
 * The viewmodel pass, pinned by call order.
 *
 * Two separate bugs made the first-person weapon invisible, and neither
 * produced an error, a warning, or anything visible in a debugger — the gun
 * loaded, sat in the frustum, reported itself visible, and simply was not
 * drawn. Both were ordering mistakes in a five-line function.
 *
 * A fake renderer that records the sequence of calls catches exactly that, and
 * it needs no GPU, no canvas and no browser.
 */
function fakeRenderer() {
  const calls = [];
  return {
    calls,
    autoClear: true,
    setRenderTarget(t) { calls.push(['setRenderTarget', t]); this._target = t; },
    clearDepth() { calls.push(['clearDepth', this._target, this.autoClear]); },
    clear() { calls.push(['clear']); },
    render(scene, camera) { calls.push(['render', scene, camera, this.autoClear]); },
  };
}

const SCENE = { name: 'viewmodel' };
const CAMERA = { name: 'vmcam' };
const READ = { name: 'readBuffer' };
const WRITE = { name: 'writeBuffer' };

test('the render target is bound BEFORE the depth is cleared', () => {
  // three's own RenderPass clears depth first and binds second, so it clears
  // whatever was bound previously. That is the bug this class exists to avoid.
  const r = fakeRenderer();
  const pass = new ViewModelPass(SCENE, CAMERA);
  pass.render(r, WRITE, READ);

  const bind = r.calls.findIndex((c) => c[0] === 'setRenderTarget');
  const clear = r.calls.findIndex((c) => c[0] === 'clearDepth');
  assert.ok(bind >= 0, 'must bind a render target');
  assert.ok(clear >= 0, 'must clear the depth buffer');
  assert.ok(bind < clear,
    'setRenderTarget must come first, or the wrong buffer gets cleared');
});

test('the depth is cleared on the buffer we are about to draw into', () => {
  const r = fakeRenderer();
  new ViewModelPass(SCENE, CAMERA).render(r, WRITE, READ);
  const clear = r.calls.find((c) => c[0] === 'clearDepth');
  assert.equal(clear[1], READ, 'depth must be cleared on the read buffer');
});

test('autoClear is disabled while drawing, so the world survives', () => {
  // renderer.render() clears colour when autoClear is on, which would wipe the
  // world this pass is compositing onto. Leaving it on produced a frame with
  // the weapon and nothing else in it.
  const r = fakeRenderer();
  new ViewModelPass(SCENE, CAMERA).render(r, WRITE, READ);
  const draw = r.calls.find((c) => c[0] === 'render');
  assert.equal(draw[3], false, 'autoClear must be false during the draw');
});

test('autoClear is restored afterwards', () => {
  const r = fakeRenderer();
  r.autoClear = true;
  new ViewModelPass(SCENE, CAMERA).render(r, WRITE, READ);
  assert.equal(r.autoClear, true, 'the renderer must be left as we found it');
});

test('the pass never clears colour', () => {
  const r = fakeRenderer();
  new ViewModelPass(SCENE, CAMERA).render(r, WRITE, READ);
  assert.ok(!r.calls.some((c) => c[0] === 'clear'),
    'clearing colour would destroy the world underneath the weapon');
});

test('the pass does not swap buffers', () => {
  // It draws into readBuffer in place, exactly like RenderPass. Swapping would
  // hand the next pass an empty buffer.
  const pass = new ViewModelPass(SCENE, CAMERA);
  assert.equal(pass.needsSwap, false);
});

test('rendering to screen binds null rather than a buffer', () => {
  const r = fakeRenderer();
  const pass = new ViewModelPass(SCENE, CAMERA);
  pass.renderToScreen = true;
  pass.render(r, WRITE, READ);
  const bind = r.calls.find((c) => c[0] === 'setRenderTarget');
  assert.equal(bind[1], null);
});

test('it draws the viewmodel scene with the viewmodel camera', () => {
  const r = fakeRenderer();
  new ViewModelPass(SCENE, CAMERA).render(r, WRITE, READ);
  const draw = r.calls.find((c) => c[0] === 'render');
  assert.equal(draw[1], SCENE, 'must draw the viewmodel scene, not the world');
  assert.equal(draw[2], CAMERA, 'and with the viewmodel camera, which has its own near plane');
});
