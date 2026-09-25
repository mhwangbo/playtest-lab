// Paste this whole file into ONE mcp__Claude_Browser__javascript_tool call (with your tabId) right after
// the game page loads. Then take one screenshot to flush the pending frame.
// Why: when the browser pane is hidden, requestAnimationFrame never fires, so real-time games freeze and
// only advance one frame per screenshot. Agents also lack a sustained mouse/key hold primitive.
// After this, use:  await __lab.holdKey(' ', 1500)   await __lab.holdPointer(x, y, ms, path)   __lab.wait(ms)
(() => {
  if (window.__lab) return 'already installed';
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const canvas = () => document.querySelector('canvas') || document.body;
  const ptr = (type, x, y) => {
    const el = document.elementFromPoint(x, y) || canvas();
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: type === 'pointerup' ? 0 : 1 }));
    el.dispatchEvent(new MouseEvent(type.replace('pointer', 'mouse'), { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
  };
  window.__lab = {
    wait,
    async holdKey(key = ' ', ms = 1000) {
      const code = key === ' ' ? 'Space' : key.length === 1 ? `Key${key.toUpperCase()}` : key;
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
      await wait(ms);
      window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true }));
    },
    /** Hold the pointer at (x,y) for ms, optionally moving through path [[x,y],...] evenly. Client coords. */
    async holdPointer(x, y, ms = 1000, path = []) {
      ptr('pointerdown', x, y);
      const steps = Math.max(1, path.length);
      for (let i = 0; i < steps; i++) { await wait(ms / steps); if (path[i]) ptr('pointermove', path[i][0], path[i][1]); }
      const [ex, ey] = path.length ? path[path.length - 1] : [x, y];
      ptr('pointerup', ex, ey);
    },
    move(x, y) { ptr('pointermove', x, y); },
  };
  return 'lab helpers installed (rAF → timer, holdKey, holdPointer, move, wait)';
})();
