// Padrões de superfície compartilhados: texturas do mundo 3D, fundo da
// tela de pintura e camuflagem procedural dos bots — tudo nasce daqui.
const PatternKit = (() => {
  const cache = new Map();

  function tile(pattern, base, accent, size = 128) {
    const key = `${pattern}|${base}|${accent}|${size}`;
    if (cache.has(key)) return cache.get(key);
    const t = document.createElement('canvas');
    t.width = size; t.height = size;
    const c = t.getContext('2d');
    const u = size / 64;
    c.fillStyle = base; c.fillRect(0, 0, size, size);
    c.fillStyle = accent;
    if (pattern === 'stripes') {
      c.save(); c.translate(size / 2, size / 2); c.rotate(Math.PI / 4); c.translate(-size * 0.72, -size * 0.72);
      for (let i = 0; i < 8; i++) c.fillRect(i * 24 * u, -20 * u, 12 * u, 132 * u);
      c.restore();
    } else if (pattern === 'dots') {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        c.beginPath();
        c.arc((x * 16 + (y % 2 ? 12 : 4) + 4) * u, (y * 16 + 8) * u, 5 * u, 0, Math.PI * 2);
        c.fill();
      }
    } else if (pattern === 'checker') {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++)
        if ((x + y) % 2) c.fillRect(x * 16 * u, y * 16 * u, 16 * u, 16 * u);
    } else if (pattern === 'zig') {
      c.lineWidth = 6 * u; c.strokeStyle = accent;
      for (let row = 0; row < 4; row++) {
        c.beginPath();
        for (let x = 0; x <= 64; x += 16) c.lineTo(x * u, (row * 16 + (x / 16 % 2 ? 2 : 14)) * u);
        c.stroke();
      }
    }
    cache.set(key, t);
    return t;
  }

  function crate(size = 128) {
    // caixa de papelão (mudança/festa de escritório)
    if (cache.has('crate')) return cache.get('crate');
    const t = document.createElement('canvas');
    t.width = size; t.height = size;
    const c = t.getContext('2d');
    c.fillStyle = '#c8a069'; c.fillRect(0, 0, size, size);
    c.fillStyle = '#bd9257'; c.fillRect(size * .06, size * .06, size * .88, size * .88);
    c.strokeStyle = '#a37c45'; c.lineWidth = size * .03;
    c.strokeRect(size * .02, size * .02, size * .96, size * .96);
    // fita adesiva
    c.fillStyle = 'rgba(160,140,110,0.85)';
    c.fillRect(size * .42, 0, size * .16, size);
    c.fillStyle = 'rgba(120,100,75,0.4)';
    c.fillRect(size * .42, 0, size * .02, size);
    c.fillRect(size * .56, 0, size * .02, size);
    // rabisco "FRÁGIL"
    c.fillStyle = 'rgba(90,60,30,0.55)';
    c.font = `bold ${size * .13}px sans-serif`;
    c.fillText('FRAGIL', size * .1, size * .3);
    cache.set('crate', t);
    return t;
  }

  // zona do mapa (unidades do servidor) em que um ponto cai
  function zoneAt(spec, x, y) {
    return spec.zones.find(z => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) || spec.zones[0];
  }

  // superfície de referência pra camuflagem num ponto: parede se estiver
  // encostado na borda, senão o chão da zona
  function surfaceAt(spec, x, y) {
    const MARGIN = 90;
    let zx = x, zy = y;
    if (x < MARGIN) zx = 1;
    else if (x > spec.w - MARGIN) zx = spec.w - 1;
    if (y < MARGIN) zy = 1;
    else if (y > spec.h - MARGIN) zy = spec.h - 1;
    const z = zoneAt(spec, zx, zy);
    return { pattern: z.pattern, base: z.base, accent: z.accent };
  }

  // textura de camuflagem procedural (bots / quem não pintou)
  function botCamo(spec, x, y, quality, w = 128, h = 160) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const s = surfaceAt(spec, x, y);
    ctx.fillStyle = ctx.createPattern(tile(s.pattern, s.base, s.accent, 64), 'repeat');
    ctx.fillRect(0, 0, w, h);
    const flaws = Math.round((1 - quality) * 26);
    for (let i = 0; i < flaws; i++) {
      ctx.fillStyle = `hsla(${Math.random() * 360}, 60%, ${40 + Math.random() * 30}%, ${0.25 + (1 - quality) * 0.4})`;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 16, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  }

  return { tile, crate, zoneAt, surfaceAt, botCamo };
})();
