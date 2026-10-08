import combatData from "./data/combat.json";

export class InputBuffer {
  constructor(windowMs = combatData.timing.inputBufferMs) {
    this.windowMs = windowMs;
    this.queue = [];
  }

  push(action, time = performance.now()) {
    this.queue.push({ action, time });
    this.prune(time);
  }

  prune(now = performance.now()) {
    const cutoff = now - this.windowMs;
    this.queue = this.queue.filter((input) => input.time >= cutoff);
  }

  consume(actions, now = performance.now()) {
    const allowed = new Set(Array.isArray(actions) ? actions : [actions]);
    this.prune(now);
    const index = this.queue.findIndex((input) => allowed.has(input.action));
    if (index === -1) return null;
    return this.queue.splice(index, 1)[0];
  }

  has(action, now = performance.now()) {
    return Boolean(this.consume(action, now));
  }

  clear() {
    this.queue.length = 0;
  }
}
