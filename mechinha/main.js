// Mechinha 3D — cliente em terceira pessoa (Three.js).
// Ambiente: escritório real (fotos) bagunçado de festa de fim de ano.
// O servidor trabalha em unidades 2D (1600x1200); aqui cada unidade vale
// U metros. Posição do servidor (x, y) vira (x*U, 0, y*U).
import * as THREE from './vendor/three.module.min.js';

const U = 0.025;               // unidade do servidor → metros
const BEAN_R = 0.55, BEAN_H = 1.8;
const HIDER_SPEED = 190, SEEKER_SPEED = 240; // unidades/s (iguais ao servidor)
const VISION_RADIUS = 400, VISION_HALF = (50 * Math.PI) / 180;
const WALL_H = 3.2;
const PITCH_MIN = 0.08, PITCH_MAX = 0.42; // indoor: câmera não fura o teto

const $ = id => document.getElementById(id);
const screens = { home: $('home'), lobby: $('lobby'), reveal: $('reveal') };

// ---------- estado ----------
let myId = null;
let phase = 'home';
let phaseEndsAt = 0;
let serverOffset = 0;
let round = 0;
let hostId = null;
let mapSpec = null;
const players = new Map();
let adoptServerPos = false;
const me = () => players.get(myId);

const self = { x: 800, y: 600, a: 0, moving: false };
let camYaw = -Math.PI / 2, camPitch = 0.3;
let snapCamera = false;
let lastPosSend = 0;

// ---------- three ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a2e3d');
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.35));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(10, 22, 8);
scene.add(sun);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- mundo: escritório 3D + fotos reais como murais ----------
const texLoader = new THREE.TextureLoader();
const worldGroup = new THREE.Group();
scene.add(worldGroup);

const CONFETTI_COLORS = ['#ff5a5f', '#ffd166', '#06d6a0', '#4f9be8', '#e85fa8', '#9b6ed8', '#f5883d', '#4fc9c4'];
const MURAL_PHOTOS = ['wall2', 'wall3', 'wall4', 'wall1', 'floor1', 'floor2'];

// carpete de escritório coberto de restos de festa — desenhado, nítido
function makePartyCarpet(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#8d97a3';
  x.fillRect(0, 0, w, h);
  // fibra do carpete
  for (let i = 0; i < 16000; i++) {
    x.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,40,0.06)';
    x.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
  }
  // manchas de bebida derramada
  for (let i = 0; i < 10; i++) {
    x.fillStyle = `rgba(${60 + Math.random() * 40},${40 + Math.random() * 30},${30 + Math.random() * 60},0.18)`;
    x.beginPath();
    x.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 70, 20 + Math.random() * 50, Math.random() * Math.PI, 0, Math.PI * 2);
    x.fill();
  }
  // serpentinas caídas
  for (let i = 0; i < 16; i++) {
    x.strokeStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    x.lineWidth = 5;
    x.beginPath();
    let px = Math.random() * w, py = Math.random() * h;
    x.moveTo(px, py);
    for (let s = 0; s < 8; s++) {
      px += (Math.random() - 0.5) * 120;
      py += (Math.random() - 0.5) * 120;
      x.quadraticCurveTo(px + (Math.random() - 0.5) * 60, py + (Math.random() - 0.5) * 60, px, py);
    }
    x.stroke();
  }
  // confete
  for (let i = 0; i < 1600; i++) {
    x.save();
    x.translate(Math.random() * w, Math.random() * h);
    x.rotate(Math.random() * Math.PI);
    x.fillStyle = CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0];
    if (Math.random() < 0.5) x.fillRect(-5, -3, 10, 6);
    else { x.beginPath(); x.arc(0, 0, 4, 0, Math.PI * 2); x.fill(); }
    x.restore();
  }
  return c;
}

function buildWorld(spec) {
  worldGroup.clear();
  const W = spec.w * U, H = spec.h * U;
  const WALL_T = 0.3;

  // chão (estende sob as paredes pra não abrir fresta)
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const carpet = new THREE.CanvasTexture(makePartyCarpet(3072, Math.round(3072 * H / W)));
  carpet.colorSpace = THREE.SRGBColorSpace;
  carpet.anisotropy = maxAniso;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 2, H + 2), new THREE.MeshBasicMaterial({ map: carpet }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(W / 2, 0, H / 2);
  worldGroup.add(floor);

  // paredes neutras de escritório + rodapé
  const wallMat = new THREE.MeshBasicMaterial({ color: 0xdedbd4 });
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x4a4f58 });
  const wallDefs = [
    { len: W + WALL_T * 2, cx: W / 2, cz: -WALL_T / 2, horiz: true, inward: 1 },
    { len: W + WALL_T * 2, cx: W / 2, cz: H + WALL_T / 2, horiz: true, inward: -1 },
    { len: H, cx: -WALL_T / 2, cz: H / 2, horiz: false, inward: 1 },
    { len: H, cx: W + WALL_T / 2, cz: H / 2, horiz: false, inward: -1 },
  ];
  for (const wd of wallDefs) {
    const geo = wd.horiz
      ? new THREE.BoxGeometry(wd.len, WALL_H, WALL_T)
      : new THREE.BoxGeometry(WALL_T, WALL_H, wd.len);
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set(wd.cx, WALL_H / 2, wd.cz);
    worldGroup.add(m);
    const bgeo = wd.horiz
      ? new THREE.BoxGeometry(wd.len, 0.14, 0.05)
      : new THREE.BoxGeometry(0.05, 0.14, wd.len);
    const b = new THREE.Mesh(bgeo, baseMat);
    b.position.set(
      wd.cx + (wd.horiz ? 0 : wd.inward * (WALL_T / 2 + 0.025)),
      0.07,
      wd.cz + (wd.horiz ? wd.inward * (WALL_T / 2 + 0.025) : 0),
    );
    worldGroup.add(b);
  }

  // murais: as fotos reais, emolduradas, na proporção certa — hotspots de camuflagem
  const frameMat = new THREE.MeshLambertMaterial({ color: 0x2b2e36 });
  let photoIdx = 0;
  for (const wd of wallDefs) {
    for (const frac of [0.25, 0.62, 0.87]) {
      const name = MURAL_PHOTOS[photoIdx++ % MURAL_PHOTOS.length];
      const mh = 1.9 + Math.random() * 0.4;
      const cy = 1.45;
      const along = wd.len * frac;
      const px = wd.horiz ? (wd.cx - wd.len / 2 + along) : wd.cx + wd.inward * (WALL_T / 2 + 0.03);
      const pz = wd.horiz ? wd.cz + wd.inward * (WALL_T / 2 + 0.03) : (wd.cz - wd.len / 2 + along);
      const rotY = wd.horiz ? (wd.inward === 1 ? 0 : Math.PI) : (wd.inward === 1 ? Math.PI / 2 : -Math.PI / 2);
      const t = texLoader.load(`assets/env/${name}.jpg`, tt => {
        tt.colorSpace = THREE.SRGBColorSpace;
        tt.anisotropy = maxAniso;
        const aspect = tt.image.width / tt.image.height;
        // não deixa o mural vazar pelos cantos da parede
        const maxW = Math.max(1.2, 2 * Math.min(along, wd.len - along) - 0.5);
        const mw = Math.min(mh * aspect, 6.5, maxW);
        const photo = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshBasicMaterial({ map: tt }));
        photo.position.set(px, cy, pz);
        photo.rotation.y = rotY;
        const frame = new THREE.Mesh(new THREE.BoxGeometry(mw + 0.12, mh + 0.12, 0.04), frameMat);
        frame.position.set(px, cy, pz);
        frame.rotation.y = rotY;
        frame.translateZ(-0.025);
        worldGroup.add(frame, photo);
      });
      void t;
    }
  }

  // teto de escritório (placas + luminárias)
  const ceil = document.createElement('canvas');
  ceil.width = ceil.height = 256;
  const cc = ceil.getContext('2d');
  cc.fillStyle = '#cfd2cd'; cc.fillRect(0, 0, 256, 256);
  cc.strokeStyle = '#9fa39e'; cc.lineWidth = 4;
  cc.strokeRect(0, 0, 256, 256);
  cc.fillStyle = '#f4f6f0'; cc.fillRect(64, 96, 128, 64);
  const ceilTex = new THREE.CanvasTexture(ceil);
  ceilTex.colorSpace = THREE.SRGBColorSpace;
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
  ceilTex.repeat.set(W / 2.4, H / 2.4);
  ceilTex.anisotropy = maxAniso;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W + 2, H + 2), new THREE.MeshBasicMaterial({ map: ceilTex }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(W / 2, WALL_H, H / 2);
  worldGroup.add(ceiling);

  // obstáculos viram mobília: mesas de trabalho e pilhas de caixa, alternando
  const deskTopMat = new THREE.MeshLambertMaterial({ color: 0xb08a5a });
  const deskLegMat = new THREE.MeshLambertMaterial({ color: 0x5a5f68 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0x1a2436 });
  const monitorMat = new THREE.MeshLambertMaterial({ color: 0x22252d });
  const cupMats = CONFETTI_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c }));
  const crateTex = new THREE.CanvasTexture(PatternKit.crate());
  crateTex.colorSpace = THREE.SRGBColorSpace;
  const crateMat = new THREE.MeshLambertMaterial({ map: crateTex });

  spec.obstacles.forEach((o, i) => {
    const ow = o.w * U, oh = o.h * U;
    const cx = (o.x + o.w / 2) * U, cz = (o.y + o.h / 2) * U;
    const g = new THREE.Group();
    if (i % 2 === 0) {
      // mesa de escritório
      const top = new THREE.Mesh(new THREE.BoxGeometry(ow, 0.06, oh), deskTopMat);
      top.position.y = 0.74;
      g.add(top);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.72, 0.07), deskLegMat);
        leg.position.set(sx * (ow / 2 - 0.09), 0.36, sz * (oh / 2 - 0.09));
        g.add(leg);
      }
      // monitor torto (festa...)
      const mon = new THREE.Group();
      const scr = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.32, 0.035), monitorMat);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.26), screenMat);
      face.position.z = 0.02;
      scr.add(face);
      scr.position.y = 0.34;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.16), deskLegMat);
      stand.position.y = 0.1;
      mon.add(scr, stand);
      mon.position.set((Math.random() - 0.5) * ow * 0.3, 0.77, (Math.random() - 0.5) * oh * 0.3);
      mon.rotation.y = Math.random() * Math.PI * 2;
      g.add(mon);
      // copos de festa esquecidos
      for (let k = 0; k < 2 + (i % 2); k++) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.1, 10), cupMats[(i + k) % cupMats.length]);
        cup.position.set((Math.random() - 0.5) * ow * 0.7, 0.82, (Math.random() - 0.5) * oh * 0.7);
        if (Math.random() < 0.35) { cup.rotation.z = Math.PI / 2; cup.position.y = 0.79; }
        g.add(cup);
      }
    } else {
      // pilha de caixas de papelão
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(ow, 0.7, oh), crateMat);
      b1.position.y = 0.35;
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(ow * 0.7, 0.55, oh * 0.7), crateMat);
      b2.position.set(ow * 0.06, 0.7 + 0.275, -oh * 0.05);
      b2.rotation.y = 0.3 + Math.random() * 0.5;
      g.add(b1, b2);
    }
    g.position.set(cx, 0, cz);
    worldGroup.add(g);
  });

  // balões perdidos pelo chão e no teto
  const balloonGeo = new THREE.SphereGeometry(0.16, 12, 12);
  const stringMat = new THREE.MeshBasicMaterial({ color: 0x666a72 });
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshLambertMaterial({ color: CONFETTI_COLORS[i % CONFETTI_COLORS.length] });
    const b = new THREE.Mesh(balloonGeo, mat);
    const onCeiling = i % 3 === 0;
    const bx = 0.8 + Math.random() * (W - 1.6);
    const bz = 0.8 + Math.random() * (H - 1.6);
    b.position.set(bx, onCeiling ? WALL_H - 0.18 : 0.16, bz);
    b.scale.y = 1.15;
    worldGroup.add(b);
    if (onCeiling) {
      // barbante pendurado — explica o balão no teto
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 4), stringMat);
      str.position.set(bx, WALL_H - 0.18 - 0.35 - 0.16, bz);
      worldGroup.add(str);
    }
  }
}

// ---------- bean ----------
const beanBodies = []; // pra raycast de tag

function makeNameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = '900 34px sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.strokeStyle = 'rgba(0,0,0,0.7)'; x.lineWidth = 7;
  x.strokeText(name, 128, 32);
  x.fillStyle = '#fff';
  x.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // sizeAttenuation false = tamanho constante na tela (nunca fica gigante de perto)
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.12, 0.03, 1);
  s.position.y = 2.15;
  return s;
}

function makeBean(p) {
  const g = new THREE.Group();

  // corpo com textura pintável
  const texCanvas = document.createElement('canvas');
  texCanvas.width = 256; texCanvas.height = 160;
  const tc = texCanvas.getContext('2d');
  tc.fillStyle = p.role === 'seeker' ? '#333a52' : '#f4f2ec';
  tc.fillRect(0, 0, 256, 160);
  const bodyTex = new THREE.CanvasTexture(texCanvas);
  bodyTex.colorSpace = THREE.SRGBColorSpace;
  const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTex, transparent: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(BEAN_R, BEAN_H - 2 * BEAN_R, 6, 20), bodyMat);
  body.position.y = BEAN_H / 2;
  body.userData.pid = p.id;
  g.add(body);
  beanBodies.push(body);

  // olhos (frente local = +Z)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1b1e2b });
  const whites = [], pupils = [];
  for (const dx of [-0.17, 0.17]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), eyeMat);
    w.position.set(dx, 1.28, 0.44);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), pupilMat);
    pu.position.set(dx, 1.28, 0.515);
    g.add(w, pu);
    whites.push(w); pupils.push(pu);
  }

  // viseira de caçador
  if (p.role === 'seeker') {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAN_R + 0.04, BEAN_R + 0.04, 0.26, 20, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x14182a }),
    );
    band.position.y = 1.28;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.16, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xf7c948 }),
    );
    glass.position.set(0, 1.28, BEAN_R + 0.02);
    g.add(band, glass);
  }

  // anel "você está aqui" no próprio bean
  if (p.id === myId) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.76, 28),
      new THREE.MeshBasicMaterial({ color: p.role === 'seeker' ? 0xf7c948 : 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
  }

  // sombra blob
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  // cone de visão (só seekers, ligado na caçada)
  let cone = null;
  if (p.role === 'seeker') {
    cone = new THREE.Mesh(
      new THREE.CircleGeometry(VISION_RADIUS * U, 28, -VISION_HALF, VISION_HALF * 2),
      new THREE.MeshBasicMaterial({ color: 0xf7c948, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide }),
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.y = 0.04;
    scene.add(cone);
  }

  const tag = makeNameTag(p.name);
  g.add(tag);

  scene.add(g);
  Object.assign(p, { mesh: g, body, bodyMat, texCanvas, bodyTex, whites, pupils, tag, cone });
}

function disposeBean(p) {
  if (!p.mesh) return;
  scene.remove(p.mesh);
  if (p.cone) scene.remove(p.cone);
  const i = beanBodies.indexOf(p.body);
  if (i >= 0) beanBodies.splice(i, 1);
  p.mesh = null;
  p.cone = null;
}

// aplica pintura (imagem/canvas 128x160) espelhada nos dois lados do corpo
function applyBodyPaint(p, img) {
  const c = p.texCanvas.getContext('2d');
  c.clearRect(0, 0, 256, 160);
  c.drawImage(img, 0, 0, 128, 160);
  c.save();
  c.translate(256, 0); c.scale(-1, 1);
  c.drawImage(img, 0, 0, 128, 160);
  c.restore();
  p.bodyTex.needsUpdate = true;
  p.texApplied = true;
}

function blinkOpen(id, tMs) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 4500;
  return ((tMs + hash) % 4500) < 350;
}

// ---------- snapshots do cenário (pintura + camo dos bots) ----------
// renderiza a cena de um ponto de vista a 3m do bean, olhando pra ele
function renderBeanContext(px, py, viewYaw, hideP, SIZE) {
  const target = new THREE.Vector3(px * U, BEAN_H / 2, py * U);
  const look = new THREE.Vector3(Math.cos(viewYaw), 0, Math.sin(viewYaw));
  const camPos = target.clone().addScaledVector(look, -3.0);
  camPos.y = 1.15;
  const tmpCam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  tmpCam.position.copy(camPos);
  tmpCam.lookAt(target);
  tmpCam.updateMatrixWorld();
  tmpCam.updateProjectionMatrix();

  const prevW = innerWidth, prevH = innerHeight;
  if (hideP?.mesh) hideP.mesh.visible = false;
  renderer.setSize(SIZE, SIZE, false);
  renderer.render(scene, tmpCam);

  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = SIZE; snapCanvas.height = SIZE;
  snapCanvas.getContext('2d').drawImage(renderer.domElement, 0, 0, SIZE, SIZE);

  renderer.setSize(prevW, prevH, false);
  if (hideP?.mesh) hideP.mesh.visible = true;

  const top = new THREE.Vector3(target.x, BEAN_H, target.z).project(tmpCam);
  const bot = new THREE.Vector3(target.x, 0, target.z).project(tmpCam);
  const yTop = (1 - top.y) / 2, yBot = (1 - bot.y) / 2;
  return { canvas: snapCanvas, cx: (top.x + 1) / 2, cy: (yTop + yBot) / 2, hFrac: Math.abs(yBot - yTop) };
}

function takePaintSnapshot() {
  return renderBeanContext(self.x, self.y, camYaw, me(), 768);
}

// camuflagem procedural dos bots: recorta do cenário real o que está atrás
// deles (visto do lado do centro do mapa) e suja com imperfeições
function snapshotBotCamo(p, quality) {
  const viewYaw = Math.atan2(mapSpec.h / 2 - p.y, mapSpec.w / 2 - p.x) + Math.PI;
  const s = renderBeanContext(p.x, p.y, viewYaw, p, 384);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const ctx = c.getContext('2d');
  const S = s.canvas.width;
  const bh = s.hFrac * S, bw = bh * 0.61;
  ctx.drawImage(s.canvas, s.cx * S - bw / 2, s.cy * S - bh / 2, bw, bh, 0, 0, 128, 160);
  const flaws = Math.round((1 - quality) * 26);
  for (let i = 0; i < flaws; i++) {
    ctx.fillStyle = `hsla(${Math.random() * 360}, 60%, ${40 + Math.random() * 30}%, ${0.25 + (1 - quality) * 0.4})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 160, 6 + Math.random() * 16, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

// ---------- colisão (unidades do servidor) ----------
function collide(x, y, r) {
  x = Math.max(r + 8, Math.min(mapSpec.w - r - 8, x));
  y = Math.max(r + 8, Math.min(mapSpec.h - r - 8, y));
  for (const o of mapSpec.obstacles) {
    const cx = Math.max(o.x, Math.min(o.x + o.w, x));
    const cy = Math.max(o.y, Math.min(o.y + o.h, y));
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d < r && d > 0.001) { x = cx + (dx / d) * r; y = cy + (dy / d) * r; }
    else if (d <= 0.001) y = o.y - r;
  }
  return { x, y };
}

// ---------- UI ----------
function show(name) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
  $('hud').classList.add('hidden');
}
function showGame() {
  for (const k in screens) screens[k].classList.add('hidden');
  $('hud').classList.remove('hidden');
}
function toast(txt, ms = 2200) {
  const t = $('toast');
  t.textContent = txt;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function banner(txt, ms = 3200) {
  const b = $('banner');
  b.innerHTML = txt;
  b.classList.remove('hidden');
  clearTimeout(b._t);
  if (ms) b._t = setTimeout(() => b.classList.add('hidden'), ms);
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

$('btnQuick').onclick = () => join({ room: 'PUB' });
$('btnCreate').onclick = () => join({ create: true });
$('btnJoin').onclick = () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 4) return toast('Código de 4 letras');
  join({ room: code });
};
$('btnStart').onclick = () => Net.send({ t: 'start' });

let joined = false;
function join(opts) {
  if (joined) return;
  joined = true;
  const name = $('nameInput').value.trim() || 'Jogador ' + Math.floor(Math.random() * 99);
  Net.connect(() => Net.send({ t: 'join', name, ...opts }));
}

function renderLobby() {
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of players.values()) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.id === myId ? '🫵 ' : ''}${esc(p.name)}</span>` +
      `<span class="tagBot">${p.bot ? '🤖 bot' : ''} ${p.totalScore ? '★' + p.totalScore : ''}</span>`;
    list.appendChild(li);
  }
  const isHost = hostId === myId;
  $('btnStart').classList.toggle('hidden', !isHost);
  $('waitHost').classList.toggle('hidden', isHost);
}

function updateRoleBadge() {
  const role = me()?.role;
  $('roleBadge').textContent =
    (phase === 'paint' || phase === 'hunt') ? (role === 'seeker' ? '🔍 caçador' : '🎨 camaleão') : '';
}
function updateHudCounts() {
  const hiders = [...players.values()].filter(p => p.role === 'hider');
  const found = hiders.filter(h => h.found).length;
  $('foundCount').textContent = hiders.length ? `${found}/${hiders.length} 🫥` : '';
}

// ---------- rede ----------
Net.on('error', m => { toast(m.error); joined = false; });
Net.on('_close', () => { toast('Conexão perdida'); setTimeout(() => location.reload(), 800); });

Net.on('joined', m => {
  myId = m.id;
  hostId = m.hostId;
  mapSpec = m.map;
  buildWorld(mapSpec);
  mergePlayers(m.players);
  $('roomCode').textContent = m.room;
  phase = m.phase;
  phaseEndsAt = m.phaseEndsAt;
  serverOffset = m.serverNow - Date.now();
  show('lobby');
  renderLobby();
  if (Net.isLocal()) toast('🤖 Demo solo: você + bots', 3500);
});

Net.on('players', m => {
  hostId = m.hostId;
  mergePlayers(m.players);
  if (phase === 'lobby') renderLobby();
  updateHudCounts();
});

function mergePlayers(list) {
  const seen = new Set();
  for (const s of list) {
    seen.add(s.id);
    let p = players.get(s.id);
    if (!p) {
      p = { x: -9999, y: -9999, a: 0, moving: false, camo: null, paint: null, paintImg: null, texApplied: false };
      players.set(s.id, p);
    }
    const roleChanged = p.role !== s.role && p.mesh;
    Object.assign(p, s);
    if (roleChanged) disposeBean(p); // recria com viseira/cor certa
    if (!p.mesh) makeBean(p);
  }
  for (const [id, p] of players) {
    if (!seen.has(id)) { disposeBean(p); players.delete(id); }
  }
}

Net.on('phase', m => {
  phase = m.phase;
  phaseEndsAt = m.endsAt;
  serverOffset = m.serverNow - Date.now();
  round = m.round || round;
  mergePlayers(m.players);
  updateHudCounts();
  updateRoleBadge();

  const role = me()?.role;
  $('blindfold').classList.toggle('hidden', !(phase === 'paint' && role === 'seeker'));

  if (phase === 'paint') {
    for (const p of players.values()) {
      p.paint = null; p.paintImg = null; p.camo = null; p.texApplied = false;
      if (p.texCanvas) {
        const c = p.texCanvas.getContext('2d');
        c.fillStyle = p.role === 'seeker' ? '#333a52' : '#f4f2ec';
        c.fillRect(0, 0, 256, 160);
        p.bodyTex.needsUpdate = true;
      }
      if (p.bodyMat) p.bodyMat.opacity = 1;
    }
    adoptServerPos = true;
    showGame();
    if (role === 'hider') {
      banner('🎨 Você é <b>CAMALEÃO</b>!<br>Encoste numa parede ou num canto, aperte <b>Pintar</b> e use o conta-gotas 💧 pra copiar o cenário.', 5500);
      $('btnPaint').classList.remove('hidden');
    } else {
      $('btnPaint').classList.add('hidden');
    }
  } else if (phase === 'hunt') {
    adoptServerPos = false;
    PaintUI.close();
    $('btnPaint').classList.add('hidden');
    showGame();
    if (role === 'seeker') banner('🔍 <b>CAÇA LIBERADA!</b><br>Toque num camaleão pra pegar. Errou = espera.', 4000);
    else banner('🫥 <b>Fique parado e ganhe pontos na frente dos caçadores.</b><br>Não pisque…', 4000);
  } else if (phase === 'lobby') {
    show('lobby');
    renderLobby();
  }
});

Net.on('pos', m => {
  for (const [id, x, y, a, mv] of m.ps) {
    const p = players.get(id);
    if (!p) continue;
    if (id === myId) {
      if (adoptServerPos) {
        self.x = x; self.y = y;
        adoptServerPos = false;
        camYaw = pickSpawnYaw(x, y);
        snapCamera = true; // sem lerp vindo de posição velha
      }
      continue;
    }
    p.x = x; p.y = y; p.a = a; p.moving = !!mv;
  }
});

// escolhe um ângulo inicial de câmera cujo ponto de câmera fique livre
// (dentro da sala e sem parede/mobília no caminho)
function pickSpawnYaw(x, y) {
  const base = Math.atan2(mapSpec.h / 2 - y, mapSpec.w / 2 - x);
  const target = new THREE.Vector3(x * U, 1.25, y * U);
  for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
    const yaw = base + off;
    const distH = 4.4 * Math.cos(camPitch);
    const cx = target.x - Math.cos(yaw) * distH;
    const cz = target.z - Math.sin(yaw) * distH;
    if (cx < 0.6 || cz < 0.6 || cx > mapSpec.w * U - 0.6 || cz > mapSpec.h * U - 0.6) continue;
    const dir = new THREE.Vector3(cx - target.x, 4.4 * Math.sin(camPitch), cz - target.z);
    const len = dir.length();
    camRay.set(target, dir.normalize());
    camRay.far = len;
    if (camRay.intersectObjects(worldGroup.children, true).length === 0) return yaw;
  }
  return base;
}

Net.on('paintset', m => {
  const p = players.get(m.id);
  if (!p) return;
  if (m.paint) {
    p.paint = m.paint;
    const img = new Image();
    img.onload = () => { p.paintImg = img; if (p.mesh) applyBodyPaint(p, img); };
    img.src = m.paint;
  } else if (m.camo != null) {
    p.camo = m.camo;
    p.texApplied = false; // snapshot na posição final, no começo da caçada
  }
});

Net.on('found', m => {
  const p = players.get(m.id);
  if (p) {
    p.found = true;
    if (p.bodyMat) p.bodyMat.opacity = 0.35;
  }
  if (m.id === myId) banner('😵 <b>Te acharam!</b> Agora você assiste como fantasma.', 3500);
  else if (m.by === myId) toast('🎯 Pegou! +100');
  else toast(`${players.get(m.id)?.name || '?'} foi encontrado!`);
  updateHudCounts();
});

Net.on('miss', m => {
  if (m.by === myId) toast('❌ Errou! Espera 1,5s…', 1400);
});

Net.on('reveal', m => showRevealScreen(m.results));

// ---------- pintura ----------
$('btnPaint').onclick = () => {
  PaintUI.open(takePaintSnapshot(), dataURL => {
    Net.send({ t: 'paint', data: dataURL });
    const p = me();
    if (p) {
      p.paint = dataURL;
      const img = new Image();
      img.onload = () => { p.paintImg = img; applyBodyPaint(p, img); };
      img.src = dataURL;
    }
    toast('Camuflagem enviada! Fica parado aí… 🤫');
  });
};

// ---------- input: girar câmera / tag ----------
const gameCanvas = $('game');
let drag = null;
gameCanvas.addEventListener('pointerdown', e => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 };
  gameCanvas.setPointerCapture(e.pointerId);
});
gameCanvas.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  camYaw += dx * 0.0055;
  camPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, camPitch + dy * 0.004));
});
gameCanvas.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const quick = performance.now() - drag.t0 < 280 && drag.moved < 12;
  if (quick) handleTap(e.clientX, e.clientY);
  drag = null;
});
gameCanvas.addEventListener('pointercancel', () => { drag = null; });

const raycaster = new THREE.Raycaster();
const camRay = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function handleTap(sx, sy) {
  if (phase !== 'hunt') return;
  const p = me();
  if (!p || p.role !== 'seeker' || p.found) return;
  const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(beanBodies, false);
  let wx, wy;
  const hit = hits.find(h => h.object.userData.pid !== myId);
  if (hit) {
    const tp = players.get(hit.object.userData.pid);
    wx = tp.x; wy = tp.y;
  } else {
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, pt)) return;
    wx = pt.x / U; wy = pt.z / U;
  }
  Net.send({ t: 'tag', x: Math.round(wx), y: Math.round(wy) });
}

// ---------- revelação ----------
function showRevealScreen(results) {
  show('reveal');
  const g = $('gallery');
  g.innerHTML = '';
  for (const r of results.filter(r => r.role === 'hider')) {
    const card = document.createElement('div');
    card.className = 'revealCard';
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 160;
    const c = cv.getContext('2d');
    c.fillStyle = '#22252f';
    c.fillRect(0, 0, 128, 160);
    const p = players.get(r.id);
    c.save();
    capsule2D(c, 64, 82, 84, 130);
    c.clip();
    if (p?.texCanvas) c.drawImage(p.texCanvas, 0, 0, 128, 160, 64 - 42, 82 - 65, 84, 130);
    else { c.fillStyle = '#f4f2ec'; c.fillRect(0, 0, 128, 160); }
    c.restore();
    capsule2D(c, 64, 82, 84, 130);
    c.strokeStyle = r.found ? '#E8655F' : '#58B94C';
    c.lineWidth = 4;
    c.stroke();
    for (const dx of [-14, 14]) {
      c.fillStyle = '#fff';
      c.beginPath(); c.ellipse(64 + dx, 52, 8, 10, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1b1e2b';
      c.beginPath(); c.arc(64 + dx, 54, 4, 0, Math.PI * 2); c.fill();
    }
    card.appendChild(cv);
    const info = document.createElement('div');
    info.innerHTML = `<div class="nm">${esc(r.name)}</div><div>${r.found ? '😵' : '🏆'} ${r.roundScore}pts</div>`;
    card.appendChild(info);
    g.appendChild(card);
  }
  const sb = $('scoreboard');
  sb.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    li.innerHTML = `${esc(r.name)} ${r.role === 'seeker' ? '🔍' : '🎨'} — <span class="pts">${r.roundScore}pts</span> (total ${r.totalScore})`;
    sb.appendChild(li);
  }
}

function capsule2D(ctx, cx, cy, w, h) {
  const r = w / 2;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2 + r, cy - h / 2);
  ctx.arcTo(cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2, r);
  ctx.arcTo(cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2, r);
  ctx.arcTo(cx - w / 2, cy + h / 2, cx - w / 2, cy - h / 2, r);
  ctx.arcTo(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2, r);
  ctx.closePath();
}

// ---------- loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  update(dt, now);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function update(dt, now) {
  const p = me();
  const inGame = p && (phase === 'paint' || phase === 'hunt');

  if (inGame) {
    const canMove = !adoptServerPos && !PaintUI.isOpen() &&
      (phase === 'hunt' || p.role === 'hider');

    if (canMove) {
      const v = Joystick.vec();
      if (v.x || v.y) {
        const speed = p.role === 'seeker' ? SEEKER_SPEED : HIDER_SPEED;
        const lookX = Math.cos(camYaw), lookZ = Math.sin(camYaw);
        const mx = v.x * -lookZ + -v.y * lookX;
        const mz = v.x * lookX + -v.y * lookZ;
        self.x += mx * speed * dt;
        self.y += mz * speed * dt;
        const c = collide(self.x, self.y, 24);
        self.x = c.x; self.y = c.y;
        self.moving = true;
        if (p.role !== 'seeker') self.a = Math.atan2(mz, mx);
      } else self.moving = false;
    } else self.moving = false;

    if (p.role === 'seeker') self.a = camYaw; // cone segue a câmera

    if (!adoptServerPos && now - lastPosSend > 66) {
      lastPosSend = now;
      Net.send({ t: 'pos', x: Math.round(self.x), y: Math.round(self.y), a: +self.a.toFixed(2), m: self.moving ? 1 : 0 });
    }

    const remain = Math.max(0, phaseEndsAt - (Date.now() + serverOffset));
    const mm = Math.floor(remain / 60000), ss = Math.floor((remain % 60000) / 1000);
    const txt = `${mm}:${String(ss).padStart(2, '0')}`;
    $('timer').textContent = txt;
    if (PaintUI.isOpen()) PaintUI.setTimer(txt);
  }

  // posiciona beans
  let camoBudget = 1; // no máx. 1 snapshot de camo por frame
  for (const pl of players.values()) {
    if (!pl.mesh) continue;
    const isMe = pl.id === myId;
    const sx = isMe ? self.x : pl.x;
    const sy = isMe ? self.y : pl.y;
    if (sx < -1000) { pl.mesh.visible = false; continue; }
    pl.mesh.visible = true;
    const wx = sx * U, wz = sy * U;
    if (isMe) pl.mesh.position.set(wx, 0, wz);
    else {
      pl.mesh.position.x += (wx - pl.mesh.position.x) * Math.min(1, dt * 12);
      pl.mesh.position.z += (wz - pl.mesh.position.z) * Math.min(1, dt * 12);
    }
    const a = isMe ? (me()?.role === 'seeker' ? camYaw : self.a) : pl.a;
    pl.mesh.rotation.y = Math.PI / 2 - a;

    // camo procedural: recorte do cenário real atrás do bot, na posição final
    if (pl.role === 'hider' && pl.camo != null && !pl.texApplied && phase === 'hunt' && camoBudget > 0 && !PaintUI.isOpen()) {
      camoBudget--;
      applyBodyPaint(pl, snapshotBotCamo(pl, pl.camo));
    }

    // olhos: hider na caçada fica de olho fechado, só piscadas entregam
    const hiddenMode = pl.role === 'hider' && phase === 'hunt' && !pl.found;
    const open = !hiddenMode || blinkOpen(pl.id, now);
    for (const w of pl.whites) w.scale.y = open ? 1 : 0.16;
    for (const pu of pl.pupils) pu.visible = open;

    // nametag: seekers sempre; hiders só fora da caçada, ou se for você/fantasma
    // (e some além de 14m pra não virar sopa de texto)
    const tagDist = camera.position.distanceTo(pl.mesh.position);
    pl.tag.visible = (pl.role === 'seeker' || phase !== 'hunt' || pl.found || isMe) && tagDist < 14;

    // cone de visão
    if (pl.cone) {
      const active = phase === 'hunt' && !pl.found;
      pl.cone.visible = active;
      if (active) {
        pl.cone.position.set(isMe ? wx : pl.mesh.position.x, 0.04, isMe ? wz : pl.mesh.position.z);
        pl.cone.rotation.z = -a;
      }
    }
  }

  // câmera terceira pessoa com "spring arm" (encurta se algo bloquear)
  if (mapSpec) {
    const target = new THREE.Vector3(self.x * U, 1.25, self.y * U);
    const distH = 4.4 * Math.cos(camPitch);
    const desired = new THREE.Vector3(
      target.x - Math.cos(camYaw) * distH,
      target.y + 4.4 * Math.sin(camPitch),
      target.z - Math.sin(camYaw) * distH,
    );
    const dir = desired.clone().sub(target);
    const len = dir.length();
    dir.normalize();
    camRay.set(target, dir);
    camRay.far = len;
    const hits = camRay.intersectObjects(worldGroup.children, true);
    if (hits.length) desired.copy(target).addScaledVector(dir, Math.max(0.7, hits[0].distance - 0.35));
    if (snapCamera) { camera.position.copy(desired); snapCamera = false; }
    else camera.position.lerp(desired, Math.min(1, dt * 14));
    camera.lookAt(target);
  }
}

requestAnimationFrame(frame);

// hook de inspeção (debug em dev)
window.__mech = {
  self,
  camState: () => ({ cam: camera.position.toArray().map(v => +v.toFixed(2)), yaw: +camYaw.toFixed(2), pitch: +camPitch.toFixed(2) }),
  players: () => [...players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, x: p.x, y: p.y, mesh: p.mesh ? p.mesh.position.toArray().map(v => +v.toFixed(2)) : null })),
  myId: () => myId,
  phase: () => phase,
};
