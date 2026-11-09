'use strict';

// Motor autoritativo do RativaSnack Online.
// O cliente envia somente comandos; posição, colisões, comida e pontuação nascem aqui.
const WORLD_W = 3600;
const WORLD_H = 2400;
const TICK_MS = 50;
const SNAPSHOT_MS = 100;
const MAX_FOOD = 150;
const MAX_LENGTH = 220;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function angleDelta(a, b) { return Math.atan2(Math.sin(b - a), Math.cos(b - a)); }
function random(min, max) { return min + Math.random() * (max - min); }
function makeFood() {
  const roll = Math.random();
  const type = roll < .78 ? 0 : roll < .91 ? 1 : roll < .95 ? 2 : roll < .98 ? 5 : 3;
  return { x: random(45, WORLD_W - 45), y: random(45, WORLD_H - 45), type, r: type === 1 ? 9 : 6, color: type === 1 ? '#ffd23e' : type === 2 ? '#7dd3fc' : type === 3 ? '#86efac' : type === 5 ? '#c4b5fd' : '#f9a8d4' };
}
function makePlayer(user) {
  const x = random(350, WORLD_W - 350), y = random(350, WORLD_H - 350);
  const angle = random(-Math.PI, Math.PI);
  return {
    id: String(user.id), nick: String(user.nick || 'Jogador').slice(0, 16),
    level: Math.max(1, Number(user.level) || 1), x, y, angle, length: 10,
    radius: 10, color: '#ffffff', alive: true, shield: 3, boostActive: false,
    paused: false, connected: true, respawnAt: 0, score: 0, kills: 0,
    boostEnergy: 100, magnetUntil: 0, growUntil: 0, segments: [],
    input: { angle, boost: false, paused: false }, lastInputAt: 0,
    isBot: false
  };
}
function makeNpc(i) {
  const p = makePlayer({ id: 'npc-' + i, nick: ['Rato Veloz', 'Queijinho', 'Mestre Ratão'][i % 3], level: 1 });
  p.isBot = true; p.color = ['#f97316', '#22c55e', '#60a5fa'][i % 3];
  p.length = 8 + i * 2; p.input.angle = p.angle;
  return p;
}
function createSimulation(mode) {
  const sim = {
    mode: String(mode || 'quick'), players: new Map(), npcs: [makeNpc(0), makeNpc(1), makeNpc(2)],
    foods: [], time: 0, scoreTick: 0, lastSnapshot: 0, running: true
  };
  for (let i = 0; i < 105; i++) sim.foods.push(makeFood());
  return sim;
}
function addPlayer(sim, user) {
  let p = sim.players.get(String(user.id));
  if (!p) { p = makePlayer(user); sim.players.set(p.id, p); }
  p.nick = String(user.nick || p.nick).slice(0, 16);
  p.level = Math.max(1, Number(user.level) || 1);
  p.connected = true; p.paused = false; p.input.paused = false;
  return p;
}
function disconnectPlayer(sim, id, deliberate) {
  const p = sim.players.get(String(id));
  if (!p) return;
  if (deliberate) sim.players.delete(String(id));
  else { p.connected = false; p.paused = true; p.input.paused = true; p.boostActive = false; }
}
function setInput(sim, id, input, now) {
  const p = sim.players.get(String(id));
  if (!p || !p.connected || !input || typeof input !== 'object') return false;
  const angle = Number(input.a);
  if (Number.isFinite(angle)) p.input.angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  p.input.boost = input.b === 1 || input.b === true;
  p.input.paused = input.p === true;
  p.lastInputAt = now || Date.now();
  return true;
}
function moveSnake(p, dt, now) {
  if (!p.alive) {
    if (p.connected && now >= p.respawnAt) {
      p.length = Math.max(3, Math.floor(p.length * .3));
      p.x = random(300, WORLD_W - 300); p.y = random(300, WORLD_H - 300);
      p.angle = random(-Math.PI, Math.PI); p.alive = true; p.shield = 3;
      p.segments = []; p.boostEnergy = 100; p.input.paused = false;
    }
    return;
  }
  if (p.paused || !p.connected) { p.boostActive = false; return; }
  const turn = angleDelta(p.angle, p.input.angle);
  p.angle += clamp(turn, -5.3 * dt, 5.3 * dt);
  const wantsBoost = p.input.boost && p.boostEnergy > 0;
  p.boostActive = !!wantsBoost;
  if (wantsBoost) p.boostEnergy = Math.max(0, p.boostEnergy - 34 * dt);
  else p.boostEnergy = Math.min(100, p.boostEnergy + 19 * dt);
  const speed = 150 * (wantsBoost ? 1.45 : 1);
  const oldX = p.x, oldY = p.y;
  p.x = (p.x + Math.cos(p.angle) * speed * dt + WORLD_W) % WORLD_W;
  p.y = (p.y + Math.sin(p.angle) * speed * dt + WORLD_H) % WORLD_H;
  p.segments.unshift({ x: oldX, y: oldY });
  if (p.segments.length > Math.min(MAX_LENGTH, p.length * 3)) p.segments.length = Math.min(MAX_LENGTH, p.length * 3);
  if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);
  p.radius = Math.min(40, 7 + Math.sqrt(p.length) * 1.25);
}
function distance2(a, b) {
  let dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  dx = Math.min(dx, WORLD_W - dx); dy = Math.min(dy, WORLD_H - dy);
  return dx * dx + dy * dy;
}
function kill(p, now) {
  if (!p.alive || p.shield > 0 || p.paused) return;
  p.alive = false; p.boostActive = false; p.respawnAt = now + 1200;
  p.score = Math.max(0, p.score);
}
function consume(sim, p) {
  if (!p.alive || p.paused || !p.connected) return;
  for (let i = sim.foods.length - 1; i >= 0; i--) {
    const f = sim.foods[i];
    if (distance2(p, f) > (p.radius + f.r + 5) ** 2) continue;
    sim.foods.splice(i, 1);
    const grow = f.type === 1 ? 3 : f.type === 3 ? 4 : f.type === 7 ? 6 : 1;
    p.length = Math.min(MAX_LENGTH, p.length + grow);
    const points = f.type === 1 ? 50 : f.type === 7 ? 100 : 10;
    p.score += points;
    if (f.type === 2) p.boostEnergy = Math.min(100, p.boostEnergy + 45);
    if (f.type === 3) p.growUntil = Date.now() + 6000;
    if (f.type === 5) p.shield = Math.max(p.shield, 4);
    break;
  }
}
function checkCollisions(sim, now) {
  const all = [...sim.players.values(), ...sim.npcs];
  for (const p of all) {
    if (!p.alive || p.paused || !p.connected) continue;
    for (const other of all) {
      if (other === p || !other.alive) continue;
      if (distance2(p, other) < (p.radius + other.radius + 3) ** 2) { kill(p, now); break; }
      for (let i = 2; i < other.segments.length; i += 3) {
        const seg = other.segments[i];
        if (distance2(p, seg) < (p.radius + 7) ** 2) { kill(p, now); break; }
      }
      if (!p.alive) break;
    }
  }
}
function serialize(p) {
  const g = [];
  const step = Math.max(1, Math.ceil(p.segments.length / 70));
  for (let i = 0; i < p.segments.length; i += step) g.push(Math.round(p.segments[i].x), Math.round(p.segments[i].y));
  return { x: Math.round(p.x), y: Math.round(p.y), a: +p.angle.toFixed(3), pz: !!p.paused,
    r: p.radius, c: p.color, n: p.nick, l: p.length, al: p.alive ? 1 : 0,
    sh: +p.shield.toFixed(1), ba: p.boostActive ? 1 : 0, sk: 'liso', ac: 'nenhum',
    ta: 'normal', sp: 0, st: 0, rt: 'nenhum', g };
}
function snapshotFor(sim, id) {
  const me = sim.players.get(String(id));
  if (!me) return null;
  const others = [...sim.players.values()].filter(p => p.id !== me.id && p.connected && p.alive).concat(sim.npcs.filter(p => p.alive));
  return { t: 'state', st: 1, ar: 0, gt: +sim.time.toFixed(1), sc: me.score,
    me: serialize(me), o: others.slice(0, 16).map(serialize),
    f: sim.foods.slice(0, MAX_FOOD).map(f => [Math.round(f.x), Math.round(f.y), f.type, f.r, f.color]) };
}
function tick(sim, dt, now) {
  if (!sim.running) return;
  dt = clamp(Number(dt) || .05, 0, .08);
  sim.time += dt;
  for (const p of sim.players.values()) {
    if (!p.connected) continue;
    if (now - p.lastInputAt > 1800) { p.input.boost = false; }
    if (p.input.paused !== p.paused) p.paused = p.input.paused;
    moveSnake(p, dt, now);
    consume(sim, p);
  }
  for (const bot of sim.npcs) {
    if (!bot.alive) { moveSnake(bot, dt, now); continue; }
    const target = sim.foods.reduce((best, f) => distance2(bot, f) < distance2(bot, best) ? f : best, sim.foods[0] || bot);
    if (target) bot.input.angle = Math.atan2(target.y - bot.y, target.x - bot.x);
    moveSnake(bot, dt, now); consume(sim, bot);
  }
  checkCollisions(sim, now);
  while (sim.foods.length < MAX_FOOD) sim.foods.push(makeFood());
}
function stopSimulation(sim) { sim.running = false; }
module.exports = { WORLD_W, WORLD_H, TICK_MS, SNAPSHOT_MS, createSimulation, addPlayer, disconnectPlayer, setInput, tick, snapshotFor, stopSimulation };
