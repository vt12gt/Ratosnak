'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Host = require('./system-host');
const Engine = require('./authoritative-engine');

test('cada sala recebe um anfitrião virtual permanente, sem ocupar vaga real', () => {
  const room = { id: 'room-1', mode: 'quick', players: new Map(), simulation: Engine.createSimulation('quick') };
  Host.attach(room, 1000);
  assert.equal(room.hostId, Host.ID);
  assert.equal(room.systemHost.nick, 'Anfitrião Rativa');
  assert.equal(room.systemHost.online, true);
  assert.equal(room.players.size, 0);
});

test('o anfitrião aparece no roster e não é um jogador ranqueável', () => {
  const room = { hostId: Host.ID };
  const humans = [{ id: 'p1', nick: 'Jogador', level: 4, online: true, system: false }];
  const rows = Host.roster(room, humans);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, Host.ID);
  assert.equal(rows[0].system, true);
  assert.equal(rows[1].id, 'p1');
  assert.equal(rows.filter(p => !p.system).length, 1);
});

test('quando todos saem, a sala fica pronta para reutilização com o mesmo anfitrião', () => {
  const room = {
    id: 'room-2', mode: 'quick', hostId: 'player-old',
    players: new Map(), started: true, simTimer: null,
    simulation: Engine.createSimulation('quick'), idleSince: null
  };
  Host.resetIdleRoom(room, Engine, 5000);
  assert.equal(room.hostId, Host.ID);
  assert.equal(room.started, false);
  assert.equal(room.idleSince, 5000);
  assert.equal(room.simulation.running, true);
  assert.equal(room.players.size, 0);
});
