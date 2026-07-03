// Lógica de jogo do Mechinha — salas, fases, pontuação e bots.
// O "servidor" é dono do relógio, dos papéis, das tags e do placar.
// Roda em dois ambientes: no Node (multiplayer real via WebSocket) e no
// navegador (build estático, ex. GitHub Pages — modo solo com bots).

const MAP_W = 1600;
const MAP_H = 1200;

const PAINT_MS = 40_000;
const HUNT_MS = 90_000;
const REVEAL_MS = 12_000;

const MIN_PLAYERS = 6; // completa com bots até aqui
const MAX_PLAYERS = 10;

const VISION_RADIUS = 400;
const VISION_HALF = (50 * Math.PI) / 180;
const TAG_RANGE = 130; // alcance seeker -> hider
const TAG_TAP_SLOP = 80; // distância do toque até o hider
const TAG_COOLDOWN_MS = 1500;

const SEEKER_SPEED = 240; // px/s (bots)
const HIDER_SPEED = 190;

const BOT_NAMES = [
  'Camaleco', 'Pintado', 'Sumido', 'Rodolfo', 'Invisivel',
  'Tintinha', 'Mimetico', 'Peraí', 'Zé Parede', 'Fantasminha',
];

const PALETTE = [
  ['#58B94C', '#3E8F36'], // verde-folha
  ['#F5883D', '#C9661F'], // laranja
  ['#E85FA8', '#B93C82'], // rosa-tinta
  ['#4F9BE8', '#3572B5'], // azul-céu
  ['#F7C948', '#CFA22A'], // amarelo
  ['#9B6ED8', '#7549AF'], // roxo
  ['#4FC9C4', '#2E9B96'], // teal
  ['#E8655F', '#BC423C'], // vermelho suave
];
const PATTERNS = ['solid', 'stripes', 'dots', 'checker', 'zig'];

let nextPlayerId = 1;

function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function generateMap() {
  const cols = 4, rows = 3;
  const zw = MAP_W / cols, zh = MAP_H / rows;
  const zones = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [base, accent] = pick(PALETTE);
      zones.push({ x: c * zw, y: r * zh, w: zw, h: zh, pattern: pick(PATTERNS), base, accent });
    }
  }
  // caixotes/props — evita o círculo central onde os seekers nascem
  const obstacles = [];
  let guard = 0;
  while (obstacles.length < 14 && guard++ < 200) {
    const w = rand(70, 150), h = rand(70, 150);
    const x = rand(40, MAP_W - 40 - w), y = rand(40, MAP_H - 40 - h);
    const cx = x + w / 2, cy = y + h / 2;
    if (dist(cx, cy, MAP_W / 2, MAP_H / 2) < 240) continue;
    if (obstacles.some(o => Math.abs(o.x + o.w / 2 - cx) < (o.w + w) / 2 + 30 &&
                            Math.abs(o.y + o.h / 2 - cy) < (o.h + h) / 2 + 30)) continue;
    obstacles.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }
  const paintColors = [...new Set(zones.flatMap(z => [z.base, z.accent]))];
  return { w: MAP_W, h: MAP_H, zones, obstacles, paintColors };
}

class Player {
  constructor(name, bot, socket) {
    this.id = `p${nextPlayerId++}`;
    this.name = name;
    this.bot = bot;
    this.socket = socket || null;
    this.role = null; // 'seeker' | 'hider'
    this.x = MAP_W / 2; this.y = MAP_H / 2; this.a = 0; this.moving = false;
    this.found = false;
    this.roundScore = 0;
    this.totalScore = 0;
    this.paint = null; // dataURL (humanos)
    this.camo = null;  // qualidade 0..1 (bots)
    this.ready = false;
    this.lastTagAt = 0;
    // estado interno de bot
    this.botTarget = null;
    this.botChase = null;
  }
  summary() {
    return {
      id: this.id, name: this.name, bot: this.bot, role: this.role,
      found: this.found, roundScore: Math.round(this.roundScore),
      totalScore: Math.round(this.totalScore), ready: this.ready,
    };
  }
}

class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.phaseEndsAt = 0;
    this.map = generateMap();
    this.round = 0;
    this._tick = setInterval(() => this.tick(), 100);
    this._tickCount = 0;
  }

  destroy() { clearInterval(this._tick); }

  humans() { return [...this.players.values()].filter(p => !p.bot); }
  bots() { return [...this.players.values()].filter(p => p.bot); }
  hiders() { return [...this.players.values()].filter(p => p.role === 'hider'); }
  seekers() { return [...this.players.values()].filter(p => p.role === 'seeker'); }

  send(p, obj) {
    if (p.socket && p.socket.readyState === 1) p.socket.send(JSON.stringify(obj));
  }
  broadcast(obj, exceptId) {
    const raw = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.socket && p.socket.readyState === 1) p.socket.send(raw);
    }
  }
  broadcastPlayers() {
    this.broadcast({ t: 'players', hostId: this.hostId, players: [...this.players.values()].map(p => p.summary()) });
  }

  addHuman(name, socket) {
    if (this.humans().length >= MAX_PLAYERS) return null;
    const p = new Player(name, false, socket);
    this.players.set(p.id, p);
    if (!this.hostId) this.hostId = p.id;
    this.send(p, {
      t: 'joined', id: p.id, room: this.code, map: this.map,
      phase: this.phase, phaseEndsAt: this.phaseEndsAt, serverNow: Date.now(),
      hostId: this.hostId, players: [...this.players.values()].map(pl => pl.summary()),
    });
    this.broadcastPlayers();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.hostId === id) {
      const h = this.humans()[0];
      this.hostId = h ? h.id : null;
    }
    if (this.humans().length === 0) {
      this.destroy();
      this.onEmpty(this.code);
      return;
    }
    this.broadcastPlayers();
  }

  startRound(byId) {
    if (this.phase !== 'lobby' && this.phase !== 'reveal') return;
    if (byId && byId !== this.hostId) return;
    this.round++;
    // completa com bots
    while (this.players.size < MIN_PLAYERS) {
      const b = new Player(pick(BOT_NAMES) + ' ' + randInt(1, 99), true, null);
      this.players.set(b.id, b);
    }
    // papéis: ~1 seeker a cada 4, humanos preferem ser hiders na 1a rodada
    const all = [...this.players.values()];
    for (const p of all) { p.found = false; p.roundScore = 0; p.paint = null; p.camo = null; p.ready = false; p.botTarget = null; p.botChase = null; }
    const nSeekers = Math.max(1, Math.ceil(all.length / 4));
    const shuffled = all.slice().sort(() => Math.random() - 0.5);
    // na primeira rodada, bots viram seekers primeiro; depois é sorteio puro
    if (this.round === 1) shuffled.sort((a, b) => (b.bot ? 1 : 0) - (a.bot ? 1 : 0));
    shuffled.forEach((p, i) => { p.role = i < nSeekers ? 'seeker' : 'hider'; });
    // spawns
    for (const p of all) {
      if (p.role === 'seeker') {
        const ang = rand(0, Math.PI * 2);
        p.x = MAP_W / 2 + Math.cos(ang) * 60; p.y = MAP_H / 2 + Math.sin(ang) * 60; p.a = ang;
      } else {
        const s = this.randomFreeSpot();
        p.x = s.x; p.y = s.y; p.a = rand(0, Math.PI * 2);
      }
    }
    this.setPhase('paint', PAINT_MS);
  }

  randomFreeSpot() {
    for (let i = 0; i < 60; i++) {
      const x = rand(60, MAP_W - 60), y = rand(60, MAP_H - 60);
      if (dist(x, y, MAP_W / 2, MAP_H / 2) < 300) continue;
      if (this.map.obstacles.some(o => x > o.x - 30 && x < o.x + o.w + 30 && y > o.y - 30 && y < o.y + o.h + 30)) continue;
      return { x, y };
    }
    return { x: 100, y: 100 };
  }

  setPhase(phase, durMs) {
    this.phase = phase;
    this.phaseEndsAt = Date.now() + durMs;
    this.broadcast({
      t: 'phase', phase, endsAt: this.phaseEndsAt, serverNow: Date.now(), round: this.round,
      players: [...this.players.values()].map(p => p.summary()),
    });
    if (phase === 'paint') {
      // bots hider escolhem spot; qualidade da camuflagem
      for (const b of this.bots()) {
        if (b.role === 'hider') {
          b.botTarget = this.randomFreeSpot();
          b.camo = rand(0.55, 0.92);
        }
      }
    }
    if (phase === 'hunt') {
      for (const p of this.hiders()) {
        // humanos que não pintaram ganham camo procedural fraca
        if (!p.bot && !p.paint) { p.camo = 0.4; this.broadcast({ t: 'paintset', id: p.id, camo: p.camo }); }
        // garante camo de todo bot, mesmo que não tenha chegado ao esconderijo a tempo
        if (p.bot && p.camo != null) this.broadcast({ t: 'paintset', id: p.id, camo: p.camo });
      }
    }
    if (phase === 'reveal') {
      for (const p of this.players.values()) {
        if (p.role === 'hider' && !p.found) p.roundScore += 150; // sobreviveu
        p.totalScore += p.roundScore;
      }
      const results = [...this.players.values()]
        .map(p => ({ ...p.summary(), paint: p.paint, camo: p.camo, x: p.x, y: p.y }))
        .sort((a, b) => b.roundScore - a.roundScore);
      this.broadcast({ t: 'reveal', results });
    }
  }

  handleMessage(p, msg) {
    switch (msg.t) {
      case 'start': this.startRound(p.id); break;
      case 'pos':
        if (this.phase === 'hunt' || this.phase === 'paint') {
          // seekers não andam na fase de pintura
          if (this.phase === 'paint' && p.role === 'seeker') break;
          p.x = Math.max(20, Math.min(MAP_W - 20, +msg.x || 0));
          p.y = Math.max(20, Math.min(MAP_H - 20, +msg.y || 0));
          p.a = +msg.a || 0;
          p.moving = !!msg.m;
        }
        break;
      case 'paint':
        if (p.role === 'hider' && typeof msg.data === 'string' && msg.data.length < 300_000) {
          p.paint = msg.data;
          p.ready = true;
          this.broadcast({ t: 'paintset', id: p.id, paint: p.paint });
          this.broadcastPlayers();
          // se todos os hiders humanos pintaram, encurta a fase pra 5s
          const pending = this.hiders().filter(h => !h.bot && !h.ready);
          if (this.phase === 'paint' && pending.length === 0 && this.phaseEndsAt - Date.now() > 5000) {
            this.phaseEndsAt = Date.now() + 5000;
            this.broadcast({ t: 'phase', phase: 'paint', endsAt: this.phaseEndsAt, serverNow: Date.now(), round: this.round, players: [...this.players.values()].map(pl => pl.summary()) });
          }
        }
        break;
      case 'tag': this.handleTag(p, +msg.x, +msg.y); break;
    }
  }

  handleTag(seeker, tx, ty) {
    if (this.phase !== 'hunt' || seeker.role !== 'seeker' || seeker.found) return;
    const now = Date.now();
    if (now - seeker.lastTagAt < TAG_COOLDOWN_MS) return;
    seeker.lastTagAt = now;
    let best = null, bestD = TAG_TAP_SLOP;
    for (const h of this.hiders()) {
      if (h.found) continue;
      if (dist(seeker.x, seeker.y, h.x, h.y) > TAG_RANGE) continue;
      const d = dist(tx, ty, h.x, h.y);
      if (d < bestD) { best = h; bestD = d; }
    }
    if (best) {
      best.found = true;
      seeker.roundScore += 100;
      this.broadcast({ t: 'found', id: best.id, by: seeker.id, x: best.x, y: best.y });
      this.broadcastPlayers();
      if (this.hiders().every(h => h.found)) this.setPhase('reveal', REVEAL_MS);
    } else {
      this.broadcast({ t: 'miss', by: seeker.id, x: tx, y: ty });
    }
  }

  inCone(seeker, hider) {
    const d = dist(seeker.x, seeker.y, hider.x, hider.y);
    if (d > VISION_RADIUS) return false;
    const ang = Math.atan2(hider.y - seeker.y, hider.x - seeker.x);
    let diff = Math.abs(ang - seeker.a);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    return diff < VISION_HALF;
  }

  tick() {
    this._tickCount++;
    const now = Date.now();

    // transições de fase por tempo
    if (this.phase !== 'lobby' && now >= this.phaseEndsAt) {
      if (this.phase === 'paint') this.setPhase('hunt', HUNT_MS);
      else if (this.phase === 'hunt') this.setPhase('reveal', REVEAL_MS);
      else if (this.phase === 'reveal') {
        this.phase = 'lobby';
        this.broadcast({ t: 'phase', phase: 'lobby', endsAt: 0, serverNow: now, round: this.round, players: [...this.players.values()].map(p => p.summary()) });
      }
    }

    if (this.phase === 'paint' || this.phase === 'hunt') this.tickBots();

    // pontuação "na cara do perigo": hider vivo dentro de cone de visão ganha 2/s
    if (this.phase === 'hunt' && this._tickCount % 5 === 0) {
      for (const h of this.hiders()) {
        if (h.found) continue;
        if (this.seekers().some(s => this.inCone(s, h))) h.roundScore += 1; // 1 a cada 500ms
      }
    }

    // broadcast de posições (10Hz)
    if (this.phase === 'paint' || this.phase === 'hunt') {
      const ps = [...this.players.values()].map(p => [p.id, Math.round(p.x), Math.round(p.y), +p.a.toFixed(2), p.moving ? 1 : 0]);
      this.broadcast({ t: 'pos', ps });
    }
  }

  moveBotTowards(b, tx, ty, speed, dt) {
    const d = dist(b.x, b.y, tx, ty);
    if (d < 6) { b.moving = false; return true; }
    const step = Math.min(d, speed * dt);
    const ang = Math.atan2(ty - b.y, tx - b.x);
    let nx = b.x + Math.cos(ang) * step;
    let ny = b.y + Math.sin(ang) * step;
    // desvio tosco de obstáculo: se entrar num caixote, contorna
    for (const o of this.map.obstacles) {
      if (nx > o.x - 20 && nx < o.x + o.w + 20 && ny > o.y - 20 && ny < o.y + o.h + 20) {
        nx = b.x + Math.cos(ang + Math.PI / 2) * step;
        ny = b.y + Math.sin(ang + Math.PI / 2) * step;
        break;
      }
    }
    b.x = Math.max(20, Math.min(MAP_W - 20, nx));
    b.y = Math.max(20, Math.min(MAP_H - 20, ny));
    b.a = ang; b.moving = true;
    return false;
  }

  tickBots() {
    const dt = 0.1;
    for (const b of this.bots()) {
      if (b.role === 'hider') {
        if (b.found) { b.moving = false; continue; }
        if (this.phase === 'paint' && b.botTarget) {
          const arrived = this.moveBotTowards(b, b.botTarget.x, b.botTarget.y, HIDER_SPEED, dt);
          if (arrived && !b.ready) {
            b.ready = true;
            this.broadcast({ t: 'paintset', id: b.id, camo: b.camo });
            this.broadcastPlayers();
          }
        } else {
          b.moving = false; // na caçada, congela e reza
        }
      } else if (b.role === 'seeker' && this.phase === 'hunt') {
        if (b.botChase) {
          const target = this.players.get(b.botChase);
          if (!target || target.found) { b.botChase = null; continue; }
          this.moveBotTowards(b, target.x, target.y, SEEKER_SPEED, dt);
          if (dist(b.x, b.y, target.x, target.y) < 90) this.handleTag(b, target.x, target.y);
        } else {
          if (!b.botTarget || this.moveBotTowards(b, b.botTarget.x, b.botTarget.y, SEEKER_SPEED, dt)) {
            b.botTarget = this.randomFreeSpot();
          }
          // detecção probabilística: quanto pior a camuflagem, mais fácil notar
          for (const h of this.hiders()) {
            if (h.found || !this.inCone(b, h)) continue;
            const quality = h.camo != null ? h.camo : 0.65; // humanos pintados: chute médio
            const p = (1 - quality) * 0.05 + (h.moving ? 0.35 : 0);
            if (Math.random() < p) { b.botChase = h.id; break; }
          }
        }
      }
    }
  }
}

class GameServer {
  constructor() { this.rooms = new Map(); }

  getOrCreateRoom(code) {
    let room = this.rooms.get(code);
    if (!room) {
      room = new Room(code, c => this.rooms.delete(c));
      this.rooms.set(code, room);
    }
    return room;
  }

  makeCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    do { code = Array.from({ length: 4 }, () => chars[randInt(0, chars.length - 1)]).join(''); }
    while (this.rooms.has(code));
    return code;
  }
}

const MechServerAPI = { GameServer, Room, MAP_W, MAP_H };
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') module.exports = MechServerAPI;
if (typeof window !== 'undefined') window.MechServer = MechServerAPI;
