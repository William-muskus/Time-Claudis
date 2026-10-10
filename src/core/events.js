/**
 * Synchronous event bus.
 *
 * Gameplay publishes facts. Audio, UI and render subscribe. Gameplay never
 * calls into them directly — see docs/ARCHITECTURE.md. Synchronous on purpose:
 * an arcade game's feedback must land on the same frame as the event that
 * caused it, and a microtask queue is one frame of mush between the shot and
 * the crack.
 */
export class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) { this.map.get(type)?.delete(fn); }

  emit(type, payload = {}) {
    const hs = this.map.get(type);
    if (!hs) return;
    // Copy so a handler may unsubscribe itself mid-dispatch.
    for (const fn of [...hs]) {
      try { fn(payload); }
      catch (e) { console.error(`[events] handler for "${type}" threw`, e); }
    }
  }
}

export const bus = new EventBus();
