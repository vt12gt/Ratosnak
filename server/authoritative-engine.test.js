'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('./authoritative-engine');

test('cria uma partida com comida e bots controlados pelo servidor', () => {
  const sim = Engine.createSimulation('quick');
  assert.equal(sim.players.size, 0);
  assert.ok(sim.foods.length >= 100);
  assert.equal(sim.npcs.length, 3);
});
test('somente entradas de direção/boost/pausa são aceitas', () => {
  const sim = Engine.createSimulation('quick');
  const p = Engine.addPlayer(sim, { id: 'p1', nick: 'Teste' });
  assert.equal(Engine.setInput(sim, 'p1', { a: 1.2, b: true, p: false }, Date.now()), true);
  assert.equal(p.input.angle, 1.2);
  assert.equal(p.input.boost, true);
  assert.equal(Engine.setInput(sim, 'intruso', { a: 0 }, Date.now()), false);
});
test('o servidor movimenta o jogador e não aceita posição enviada pelo cliente', () => {
  const sim = Engine.createSimulation('quick');
  const p = Engine.addPlayer(sim, { id: 'p1', nick: 'Teste' });
  const before = { x: p.x, y: p.y };
  Engine.setInput(sim, 'p1', { a: 0, b: false, p: false, x: 999999, y: 999999, score: 999999 }, Date.now());
  for (let i = 0; i < 20; i++) Engine.tick(sim, .05, Date.now() + i * 50);
  assert.notDeepEqual({ x: p.x, y: p.y }, before);
  assert.ok(p.x < Engine.WORLD_W && p.x >= 0);
  assert.ok(p.y < Engine.WORLD_H && p.y >= 0);
  assert.ok(p.score < 999999);
});
test('snapshot é individual e calculado pelo servidor', () => {
  const sim = Engine.createSimulation('quick');
  Engine.addPlayer(sim, { id: 'p1', nick: 'Um' });
  Engine.addPlayer(sim, { id: 'p2', nick: 'Dois' });
  const a = Engine.snapshotFor(sim, 'p1');
  const b = Engine.snapshotFor(sim, 'p2');
  assert.equal(a.t, 'state');
  assert.equal(a.me.n, 'Um');
  assert.equal(a.o.some(p => p.n === 'Dois'), true);
  assert.equal(b.me.n, 'Dois');
});
test('pausa congela apenas o jogador e desconexão não apaga a sala', () => {
  const sim = Engine.createSimulation('quick');
  const p1 = Engine.addPlayer(sim, { id: 'p1', nick: 'Um' });
  const p2 = Engine.addPlayer(sim, { id: 'p2', nick: 'Dois' });
  Engine.setInput(sim, 'p1', { a: 0, p: true }, Date.now());
  const before = { x: p1.x, y: p1.y };
  for (let i = 0; i < 10; i++) Engine.tick(sim, .05, Date.now() + i * 50);
  assert.deepEqual({ x: p1.x, y: p1.y }, before);
  assert.equal(p2.connected, true);
  Engine.disconnectPlayer(sim, 'p1', false);
  assert.equal(sim.players.has('p1'), true);
  assert.equal(sim.players.get('p1').connected, false);
});
test('morte reaparece com 30 por cento do tamanho e escudo', () => {
  const sim = Engine.createSimulation('quick');
  const p = Engine.addPlayer(sim, { id: 'p1', nick: 'Teste' });
  p.length = 30; p.alive = false; p.respawnAt = 0;
  Engine.tick(sim, .05, Date.now());
  assert.equal(p.alive, true);
  assert.equal(p.length, 9);
  assert.equal(p.shield, 3);
});
