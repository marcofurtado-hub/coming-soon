// Joystick virtual (canto inferior esquerdo) com feedback em DOM
// + fallback WASD/setas no desktop.
const Joystick = (() => {
  const zone = document.getElementById('joyZone');
  let active = false, ox = 0, oy = 0, vx = 0, vy = 0, pid = null;
  const keys = {};
  const R = 55;

  const base = document.createElement('div');
  const knob = document.createElement('div');
  base.style.cssText = `position:fixed;width:${R * 2}px;height:${R * 2}px;border:3px solid rgba(255,255,255,.35);border-radius:50%;pointer-events:none;display:none;z-index:15;`;
  knob.style.cssText = `position:fixed;width:44px;height:44px;background:rgba(255,255,255,.4);border-radius:50%;pointer-events:none;display:none;z-index:15;`;
  document.body.append(base, knob);

  function refresh() {
    base.style.display = knob.style.display = active ? 'block' : 'none';
    if (!active) return;
    base.style.left = ox - R + 'px'; base.style.top = oy - R + 'px';
    knob.style.left = ox + vx * R - 22 + 'px'; knob.style.top = oy + vy * R - 22 + 'px';
  }

  function start(x, y, id) { active = true; ox = x; oy = y; pid = id; vx = 0; vy = 0; refresh(); }
  function move(x, y) {
    if (!active) return;
    let dx = x - ox, dy = y - oy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    vx = dx / R; vy = dy / R;
    refresh();
  }
  function end() { active = false; vx = 0; vy = 0; pid = null; refresh(); }

  zone.addEventListener('pointerdown', e => { zone.setPointerCapture(e.pointerId); start(e.clientX, e.clientY, e.pointerId); });
  zone.addEventListener('pointermove', e => { if (e.pointerId === pid) move(e.clientX, e.clientY); });
  zone.addEventListener('pointerup', e => { if (e.pointerId === pid) end(); });
  zone.addEventListener('pointercancel', e => { if (e.pointerId === pid) end(); });

  window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  function vec() {
    let x = vx, y = vy;
    if (!active) {
      x = (keys['d'] || keys['arrowright'] ? 1 : 0) - (keys['a'] || keys['arrowleft'] ? 1 : 0);
      y = (keys['s'] || keys['arrowdown'] ? 1 : 0) - (keys['w'] || keys['arrowup'] ? 1 : 0);
      const d = Math.hypot(x, y);
      if (d > 1) { x /= d; y /= d; }
    }
    return { x, y };
  }

  return { vec };
})();
