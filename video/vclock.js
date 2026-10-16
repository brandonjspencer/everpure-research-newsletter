// Virtual clock, injected before any page script (evaluateOnNewDocument). Replaces every time
// source the page and the hex-mesh library use — performance.now, Date.now, timers,
// requestAnimationFrame, idle callbacks — plus Math.random (seeded), so stepping the clock
// frame by frame from 0 renders the same pixels on every run and in every worker.
(() => {
  let now = 0; // virtual ms
  let seq = 0;
  const timers = new Map();
  const rafs = new Map();
  const EPOCH = 1792000000000;

  performance.now = () => now;
  Date.now = () => EPOCH + now;

  window.setTimeout = (fn, ms, ...args) => {
    const id = ++seq;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args, every: 0, order: id });
    return id;
  };
  window.setInterval = (fn, ms, ...args) => {
    const id = ++seq;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, fn, args, every, order: id });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = ++seq;
    rafs.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => rafs.delete(id);
  window.requestIdleCallback = (fn) =>
    window.setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 0 }), 1);
  window.cancelIdleCallback = (id) => timers.delete(id);

  let s = 0x2545f491; // mulberry32
  Math.random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const drain = async () => {
    for (let i = 0; i < 8; i++) await null;
  };
  const call = (fn, args) => {
    try {
      fn(...args);
    } catch (e) {
      console.error("[vclock]", e && (e.stack || e));
    }
  };
  async function runTimersUpTo(target) {
    for (;;) {
      let pick = null;
      for (const [id, t] of timers) {
        if (t.at > target) continue;
        if (!pick || t.at < pick[1].at || (t.at === pick[1].at && t.order < pick[1].order))
          pick = [id, t];
      }
      if (!pick) return;
      const [id, t] = pick;
      now = Math.max(now, t.at);
      if (t.every) {
        t.at += t.every;
        t.order = ++seq;
      } else timers.delete(id);
      call(t.fn, t.args);
      await drain();
    }
  }
  // Advance the clock to `ms`, firing due timers in order, then one animation frame.
  window.__advanceTo = async (ms) => {
    await runTimersUpTo(ms);
    now = Math.max(now, ms);
    const frame = [...rafs.values()];
    rafs.clear();
    for (const fn of frame) call(fn, [now]);
    await drain();
    await runTimersUpTo(now); // zero-delay work scheduled by the frame
  };
  window.__vnow = () => now;
})();
