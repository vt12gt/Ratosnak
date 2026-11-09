'use strict';

const ID = 'rativa-system-host';
const PROFILE = Object.freeze({
  id: ID,
  nick: 'Anfitrião Rativa',
  level: 99,
  online: true,
  system: true,
  role: 'host'
});

function attach(room, now = Date.now()) {
  room.hostId = ID;
  room.systemHost = { ...PROFILE, createdAt: now };
  if (room.idleSince == null) room.idleSince = now;
  return room;
}

function roster(room, realPlayers) {
  // O anfitrião aparece na lista, mas nunca ocupa vaga nem entra no ranking.
  return [{ ...PROFILE }, ...realPlayers];
}

function resetIdleRoom(room, GameEngine, now = Date.now()) {
  if (room.simTimer) clearInterval(room.simTimer);
  room.simTimer = null;
  if (room.simulation) GameEngine.stopSimulation(room.simulation);
  room.simulation = GameEngine.createSimulation(room.mode);
  room.started = false;
  room.lastTickAt = 0;
  room.snapshotAt = 0;
  room.idleSince = now;
  attach(room, room.systemHost && room.systemHost.createdAt || now);
  return room;
}

module.exports = { ID, PROFILE, attach, roster, resetIdleRoom };
