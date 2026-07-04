// Tela de pintura: o jogador pinta o próprio bean com o dedo, vendo um
// snapshot 3D real do que está atrás dele. A cor vem do CENÁRIO, via
// conta-gotas — toque no fundo pra pegar a cor, depois pinte.
const PaintUI = (() => {
  const ui = document.getElementById('paintUI');
  const stage = document.getElementById('paintStage');
  const bgCanvas = document.getElementById('paintBg');
  const fgCanvas = document.getElementById('paintCanvas');
  const paletteEl = document.getElementById('palette');
  const timerEl = document.getElementById('paintTimer');
  const pickBtn = document.getElementById('toolPick');
  const chip = document.getElementById('colorChip');

  const TEX_W = 128, TEX_H = 160;
  const BEAN_RATIO = 0.61; // largura/altura do bean 3D (1.1m / 1.8m)

  // textura real que vai pro corpo do bean
  const tex = document.createElement('canvas');
  tex.width = TEX_W; tex.height = TEX_H;
  const tctx = tex.getContext('2d');

  let color = '#f4f2ec';
  let brush = 18;
  let drawing = false;
  let lastPt = null;
  let onDone = null;
  let pickMode = true;           // abre já no conta-gotas
  let recent = [];               // cores pegadas com o conta-gotas
  let snapRef = null;            // snapshot atual (pra avaliar a camuflagem)

  // ---- avaliação por pixel: quão perto a pintura está do fundo real ----
  const QW = 32, QH = 40;
  const qa = document.createElement('canvas'); qa.width = QW; qa.height = QH;
  const qb = document.createElement('canvas'); qb.width = QW; qb.height = QH;

  function computeQuality() {
    if (!snapRef) return 0.5;
    const S = snapRef.canvas.width;
    const bh = snapRef.hFrac * S, bw = bh * BEAN_RATIO;
    const bx = snapRef.cx * S - bw / 2, by = snapRef.cy * S - bh / 2;
    const ca = qa.getContext('2d');
    ca.drawImage(snapRef.canvas, bx, by, bw, bh, 0, 0, QW, QH);
    const cb = qb.getContext('2d');
    cb.clearRect(0, 0, QW, QH);
    cb.drawImage(tex, 0, 0, QW, QH);
    const da = ca.getImageData(0, 0, QW, QH).data;
    const db = cb.getImageData(0, 0, QW, QH).data;
    // máscara da cápsula: meia-altura 1, raio 0.8, trecho reto até 0.2
    const capR = QW / QH, cy0 = 1 - capR;
    let sum = 0, n = 0;
    for (let y = 0; y < QH; y++) {
      for (let xx = 0; xx < QW; xx++) {
        const nx = ((xx + 0.5) / QW) * 2 - 1;
        const ny = ((y + 0.5) / QH) * 2 - 1;
        const ay = Math.abs(ny);
        let inside;
        if (ay <= cy0) inside = Math.abs(nx) <= 1;
        else { const dy = (ay - cy0) / capR; inside = nx * nx + dy * dy <= 1; }
        if (!inside) continue;
        const i = (y * QW + xx) * 4;
        sum += Math.hypot(da[i] - db[i], da[i + 1] - db[i + 1], da[i + 2] - db[i + 2]);
        n++;
      }
    }
    const avg = n ? sum / n : 441;
    return Math.max(0, Math.min(1, 1 - avg / 150));
  }

  function updateMeter() {
    const q = computeQuality();
    const el = document.getElementById('camoScore');
    el.textContent = `🦎 ${Math.round(q * 100)}%`;
    el.style.color = q > 0.7 ? '#58B94C' : q > 0.4 ? '#F7C948' : '#E8655F';
    return q;
  }

  function setColor(c) {
    color = c;
    chip.style.background = c;
    paletteEl.querySelectorAll('.swatch').forEach(s => s.classList.toggle('sel', s.dataset.c === c));
  }

  function setPickMode(on) {
    pickMode = on;
    pickBtn.classList.toggle('sel', on);
    bgCanvas.style.cursor = fgCanvas.style.cursor = on ? 'crosshair' : 'auto';
  }
  pickBtn.onpointerdown = () => setPickMode(!pickMode);

  function texPath(ctx) {
    const w = TEX_W, h = TEX_H, r = w / 2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
  }

  function capsulePath(ctx, cx, cy, w, h) {
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + r, cy - h / 2);
    ctx.arcTo(cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, r);
    ctx.arcTo(cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2, r);
    ctx.arcTo(cx - w / 2, cy + h / 2, cx - w / 2, cy - h / 2, r);
    ctx.arcTo(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, r);
    ctx.closePath();
  }

  function renderPalette() {
    paletteEl.innerHTML = '';
    for (const c of [...recent, '#ffffff', '#1b1e2b']) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c === color ? ' sel' : '');
      b.dataset.c = c;
      b.style.background = c;
      b.onpointerdown = () => { setColor(c); setPickMode(false); };
      paletteEl.appendChild(b);
    }
  }

  function addRecent(c) {
    recent = [c, ...recent.filter(x => x !== c)].slice(0, 10);
    renderPalette();
  }

  // ---- conta-gotas ----
  function pickAt(clientX, clientY) {
    const r = bgCanvas.getBoundingClientRect();
    const x = Math.round(Math.max(0, Math.min(r.width - 1, clientX - r.left)));
    const y = Math.round(Math.max(0, Math.min(r.height - 1, clientY - r.top)));
    const d = bgCanvas.getContext('2d').getImageData(x, y, 1, 1).data;
    const c = `rgb(${d[0]},${d[1]},${d[2]})`;
    setColor(c);
    addRecent(c);
    setPickMode(false); // pegou a cor → volta pro pincel
    if (typeof SFX !== 'undefined') SFX.pick();
  }

  bgCanvas.addEventListener('pointerdown', e => {
    // tocar no cenário sempre pega cor (mesmo fora do pick mode: atalho natural)
    pickAt(e.clientX, e.clientY);
  });

  // snap: { canvas, cx, cy, hFrac } — posição/tamanho do bean em frações do snapshot
  function layout(snap) {
    const rect = stage.getBoundingClientRect();
    const size = Math.min(rect.width - 16, rect.height - 16);
    bgCanvas.width = size; bgCanvas.height = size;
    bgCanvas.style.width = size + 'px'; bgCanvas.style.height = size + 'px';
    bgCanvas.style.left = (rect.width - size) / 2 + 'px';
    bgCanvas.style.top = (rect.height - size) / 2 + 'px';

    const bctx = bgCanvas.getContext('2d');
    bctx.drawImage(snap.canvas, 0, 0, snap.canvas.width, snap.canvas.height, 0, 0, size, size);

    const bh = snap.hFrac * size;
    const bw = bh * BEAN_RATIO;
    const bx = snap.cx * size, by = snap.cy * size;

    // guia tracejada da silhueta
    bctx.save();
    bctx.setLineDash([6, 6]);
    bctx.strokeStyle = 'rgba(255,255,255,0.9)';
    bctx.lineWidth = 2;
    capsulePath(bctx, bx, by, bw, bh);
    bctx.stroke();
    bctx.restore();

    fgCanvas.width = TEX_W; fgCanvas.height = TEX_H;
    fgCanvas.style.width = bw + 'px'; fgCanvas.style.height = bh + 'px';
    fgCanvas.style.left = (rect.width - size) / 2 + bx - bw / 2 + 'px';
    fgCanvas.style.top = (rect.height - size) / 2 + by - bh / 2 + 'px';
    render();
  }

  function render() {
    const ctx = fgCanvas.getContext('2d');
    ctx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    ctx.drawImage(tex, 0, 0);
  }

  function texPoint(e) {
    const r = fgCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * TEX_W,
      y: ((e.clientY - r.top) / r.height) * TEX_H,
    };
  }

  function stroke(a, b) {
    tctx.save();
    texPath(tctx);
    tctx.clip();
    tctx.strokeStyle = color;
    tctx.lineWidth = brush * 2;
    tctx.lineCap = 'round';
    tctx.beginPath();
    tctx.moveTo(a.x, a.y);
    tctx.lineTo(b.x, b.y);
    tctx.stroke();
    tctx.restore();
    render();
  }

  fgCanvas.addEventListener('pointerdown', e => {
    if (pickMode) { pickAt(e.clientX, e.clientY); return; }
    fgCanvas.setPointerCapture(e.pointerId);
    drawing = true;
    lastPt = texPoint(e);
    stroke(lastPt, { x: lastPt.x + 0.1, y: lastPt.y + 0.1 });
  });
  fgCanvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = texPoint(e);
    stroke(lastPt, p);
    lastPt = p;
  });
  const stop = () => { if (drawing) updateMeter(); drawing = false; lastPt = null; };
  fgCanvas.addEventListener('pointerup', stop);
  fgCanvas.addEventListener('pointercancel', stop);

  document.querySelectorAll('.brushSize').forEach(b => {
    b.onpointerdown = () => {
      brush = +b.dataset.size;
      setPickMode(false);
      document.querySelectorAll('.brushSize').forEach(s => s.classList.remove('sel'));
      b.classList.add('sel');
    };
  });
  document.getElementById('toolFill').onpointerdown = () => {
    tctx.save(); texPath(tctx); tctx.clip();
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, TEX_W, TEX_H);
    tctx.restore();
    render();
    updateMeter();
    if (typeof SFX !== 'undefined') SFX.fill();
  };
  document.getElementById('toolClear').onpointerdown = () => {
    tctx.clearRect(0, 0, TEX_W, TEX_H);
    base();
    render();
    updateMeter();
    if (typeof SFX !== 'undefined') SFX.tap();
  };
  document.getElementById('btnPaintDone').onclick = () => {
    const q = computeQuality();
    close();
    if (typeof SFX !== 'undefined') SFX.done();
    if (onDone) onDone(tex.toDataURL('image/png'), q);
  };

  function base() {
    // corpo branco de fábrica
    tctx.save(); texPath(tctx); tctx.clip();
    tctx.fillStyle = '#f4f2ec';
    tctx.fillRect(0, 0, TEX_W, TEX_H);
    tctx.restore();
  }

  function open(snap, doneCb) {
    onDone = doneCb;
    snapRef = snap;
    base();
    renderPalette();
    setColor('#f4f2ec');
    setPickMode(true);
    ui.classList.remove('hidden');
    requestAnimationFrame(() => { layout(snap); updateMeter(); });
  }
  function close() { ui.classList.add('hidden'); }
  function isOpen() { return !ui.classList.contains('hidden'); }
  function setTimer(txt) { timerEl.textContent = txt; }

  return { open, close, isOpen, setTimer, TEX_W, TEX_H, BEAN_RATIO };
})();
