'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer, WebSocket } = require('ws');
const GameEngine = require('./authoritative-engine');
const SystemHost = require('./system-host');

const PORT = Number(process.env.PORT || 8787);
const RATOPOLIS_API_URL = String(process.env.RATOPOLIS_API_URL || 'https://ratopolis-api-dev-v30.juniorgmj69.workers.dev').replace(/\/+$/, '');
const RATO_SNACK_API_URL = String(process.env.RATO_SNACK_API_URL || 'https://rato-snack-api-dev.juniorgmj69.workers.dev').replace(/\/+$/, '');
const RATIVA_CORE_API_URL = String(process.env.RATIVA_CORE_API_URL || 'https://rativa-core-dev.juniorgmj69.workers.dev').replace(/\/+$/, '');
const ALLOWED_ORIGINS = new Set([
  'https://vt12gt.github.io',
  'https://ratopolis-cadastro-teste.pages.dev',
  'http://localhost:8158',
  'http://localhost:8787'
]);
const MAX_PLAYERS = 4;
const COUNTDOWN_MS = 5000;
const RECONNECT_GRACE_MS = 30000;

function roomKeyForMode(mode) { return String(mode || 'quick').toUpperCase(); }

const rooms = new Map();
const socketsByUser = new Map();
const roomByUser = new Map();
const wsTickets = new Map();

function json(res, status, data, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin && ALLOWED_ORIGINS.has(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin'
    } : {})
  });
  res.end(JSON.stringify({ s: status, ...data }));
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function upstream(path, method, body, token) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(RATOPOLIS_API_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  return { status: response.status, data };
}

async function snackUpstream(path, method, body, token) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(RATO_SNACK_API_URL + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { message: raw.slice(0, 500) }; }
  return { status: response.status, data };
}

function extractRatopolisPlayer(data) {
  if (!data || typeof data !== 'object') return null;
  const candidates = [
    data.jogador, data.player, data.user, data.usuario,
    data.data && data.data.jogador,
    data.data && data.data.player,
    data.data && data.data.user,
    data.data && data.data.usuario
  ];
  for (const user of candidates) {
    if (!user || typeof user !== 'object') continue;
    const id = user.id ?? user.user_id ?? user.userId;
    const nick = user.nickname ?? user.nick ?? user.username ?? user.nome;
    const level = Number(user.level ?? user.nivel ?? user.nível ?? 1) || 1;
    const xp = Number(user.xp ?? user.experience ?? 0) || 0;
    if (id != null && String(id).trim() && nick != null && String(nick).trim()) {
      return { id: String(id), nick: String(nick), level, xp };
    }
  }
  return null;
}

function extractOfficialAnnouncementRoles(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const data = raw.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  if (data.ok !== true || !Array.isArray(data.titles)) return [];
  const codes = new Set(data.titles.map(item => String(item && item.code || '').trim().toLowerCase()));
  return ['founder', 'spadmin', 'gm'].filter(role => codes.has(role));
}
async function officialAnnouncementRoles(token) {
  if (!token) return [];
  try {
    const response = await fetch(RATIVA_CORE_API_URL + '/api/core/titles/me', {
      method: 'GET', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store', signal: AbortSignal.timeout(8000)
    });
    const raw = await response.json().catch(() => ({}));
    return response.ok ? extractOfficialAnnouncementRoles(raw) : [];
  } catch (error) {
    console.warn('Rativa Core roles unavailable:', error.message);
    return [];
  }
}
async function authenticate(token) {
  if (!token || token.length > 4096) return null;
  const result = await upstream('/api/me', 'GET', undefined, token);
  const user = result.status === 200 ? extractRatopolisPlayer(result.data) : null;
  if (!user) {
    console.warn('Ratópolis session rejected for ticket; upstream status:', result.status,
      'response keys:', Object.keys(result.data || {}).join(','));
    return null;
  }
  const roles = await officialAnnouncementRoles(token);
  return { ...user, token, announcementRoles: roles };
}

function reselectPlayerHost(room) { room.playerHostId = null; room.hostId = SystemHost.ID; return null; }
function roomPlayers(room) {
  const realPlayers = [...room.players.values()].map(p => ({
    id: p.id, nick: p.nick, level: p.level || 1,
    online: !!(p.ws && p.ws.readyState === WebSocket.OPEN),
    system: false, role: p.staffRole || 'player', staffRole: p.staffRole || '',
    isRoomHost: false
  }));
  return SystemHost.roster(room, realPlayers);
}
function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function broadcast(room, message, exceptId) {
  for (const p of room.players.values()) if (p.id !== exceptId) send(p.ws, message);
}
function roster(room) {
  const players = roomPlayers(room);
  for (const p of room.players.values()) send(p.ws, {
    t: 'roster', mode: room.mode, roomKey: room.roomKey,
    authoritative: true, host: SystemHost.ID, players
  });
}
function clearCountdown(room) {
  if (room.countdown) clearTimeout(room.countdown);
  room.countdown = null;
}
function destroyRoom(room, notify = true) {
  clearCountdown(room);
  if (room.simTimer) clearInterval(room.simTimer);
  if (room.simulation) GameEngine.stopSimulation(room.simulation);
  rooms.delete(room.id);
  for (const p of room.players.values()) {
    roomByUser.delete(p.id);
    if (notify) send(p.ws, { t: 'end' });
  }
  room.players.clear();
}
function createRoom(mode) {
  const room = {
    mode, roomKey: roomKeyForMode(mode), id: crypto.randomUUID(),
    players: new Map(), hostId: SystemHost.ID, playerHostId: null,
    systemHost: null, started: false, countdown: null,
    createdAt: Date.now(), idleSince: Date.now(),
    simulation: GameEngine.createSimulation(mode), simTimer: null,
    lastTickAt: 0, snapshotAt: 0
  };
  SystemHost.attach(room);
  rooms.set(room.id, room);
  console.info('[room] system_host_ready', JSON.stringify({ roomId: room.id, hostId: room.hostId, mode }));
  return room;
}
function startRoomSimulation(room) {
  if (room.simTimer) return;
  if (!room.simulation || !room.simulation.running) room.simulation = GameEngine.createSimulation(room.mode);
  for (const p of room.players.values()) GameEngine.addPlayer(room.simulation, p);
  room.lastTickAt = Date.now();
  room.snapshotAt = 0;
  room.simTimer = setInterval(() => {
    if (!rooms.has(room.id) || !room.started || !room.simulation) return;
    const now = Date.now();
    const dt = Math.min(.08, Math.max(.01, (now - room.lastTickAt) / 1000));
    room.lastTickAt = now;
    GameEngine.tick(room.simulation, dt, now);
    if (now - room.snapshotAt < GameEngine.SNAPSHOT_MS) return;
    room.snapshotAt = now;
    for (const p of room.players.values()) {
      if (!p.ws || p.ws.readyState !== WebSocket.OPEN) continue;
      const state = GameEngine.snapshotFor(room.simulation, p.id);
      if (state) send(p.ws, { t: 'st', from: SystemHost.ID, d: JSON.stringify(state) });
    }
  }, GameEngine.TICK_MS);
  if (typeof room.simTimer.unref === 'function') room.simTimer.unref();
}
function firstAvailableRoom(mode) {
  for (const room of rooms.values()) {
    if (room.mode === mode && room.players.size < MAX_PLAYERS) return room;
  }
  return createRoom(mode);
}
function startCountdown(room) {
  if (room.started || room.countdown || room.players.size < 2) return;
  room.countdown = setTimeout(() => {
    room.countdown = null;
    if (!rooms.has(room.id) || room.players.size < 2) return;
    room.started = true;
    startRoomSimulation(room);
    broadcast(room, { t: 'start', mode: room.mode, roomKey: room.roomKey, authoritative: true });
  }, COUNTDOWN_MS);
  broadcast(room, { t: 'countdown', ms: COUNTDOWN_MS, mode: room.mode, roomKey: room.roomKey });
}
function addPlayer(room, user, ws) {
  const old = room.players.get(user.id);
  if (old && old.reconnectTimer) clearTimeout(old.reconnectTimer);
  const player = old || {
    id: user.id, nick: user.nick, level: user.level || 1, ws: null,
    reconnectTimer: null, slot: room.players.size, joinedAt: Date.now(),
    matchId: crypto.randomUUID(), matchStartedAt: Date.now(), recordSaved: false
  };
  player.nick = user.nick;
  player.level = user.level || 1;
  player.staffRole = (user.announcementRoles || []).includes('founder') ? 'founder' :
    (user.announcementRoles || []).includes('spadmin') ? 'spadmin' : '';
  player.ws = ws;
  player.reconnectTimer = null;
  room.players.set(user.id, player);
  roomByUser.set(user.id, room.id);
  room.idleSince = null;
  room.hostId = SystemHost.ID;
  if (!room.simulation || !room.simulation.running) room.simulation = GameEngine.createSimulation(room.mode);
  GameEngine.addPlayer(room.simulation, player);
  send(ws, {
    t: 'joined', roomId: room.id, host: SystemHost.ID,
    hostNick: SystemHost.PROFILE.nick, isHost: false, systemHost: true,
    authoritative: true, mode: room.mode, roomKey: room.roomKey,
    players: roomPlayers(room)
  });
  if (room.started) {
    send(ws, { t: 'start', mode: room.mode, roomKey: room.roomKey, authoritative: true });
    startRoomSimulation(room);
  } else {
    startCountdown(room);
  }
  roster(room);
}
function persistMatchResult(room, player) {
  if (!player || player.recordSaved || player.recordPending) return;
  const simPlayer = room.simulation && room.simulation.players.get(player.id);
  if (!simPlayer) return;
  const durationMs = Math.max(0, Date.now() - Number(player.matchStartedAt || Date.now()));
  const score = Math.max(0, Math.floor(Number(simPlayer.score) || 0));
  if (durationMs < 10000 || score <= 0) return;
  const secret = process.env.RATIVASNACK_SERVER_KEY;
  if (!secret) {
    console.warn('[ranking] server_key_missing; authoritative score not submitted', player.id);
    return;
  }
  const payload = {
    portal_user_id: player.id,
    match_id: player.matchId,
    score,
    duration_ms: durationMs,
    kills: Math.max(0, Math.floor(Number(simPlayer.kills) || 0)),
    food: Math.max(0, Math.floor(Number(simPlayer.foodEaten) || 0)),
    reason: 'player_exit'
  };
  player.recordPending = true;
  const submit = async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(RATO_SNACK_API_URL + '/api/rato-snack/internal/authoritative-record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Rativa-Server-Key': secret },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'HTTP ' + response.status);
        player.recordSaved = true;
        player.recordPending = false;
        console.info('[ranking] authoritative_record_saved', JSON.stringify({ userId: player.id, score, inserted: !!data.inserted }));
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    player.recordPending = false;
    console.error('[ranking] authoritative_record_failed', JSON.stringify({ userId: player.id, message: lastError && lastError.message }));
  };
  void submit();
}
function removePlayer(room, userId, deliberate = false) {
  const p = room.players.get(userId);
  if (!p) return;
  if (p.reconnectTimer) clearTimeout(p.reconnectTimer);
  if (!deliberate && p.ws) {
    p.ws = null;
    if (room.simulation) GameEngine.disconnectPlayer(room.simulation, userId, false);
    p.reconnectTimer = setTimeout(() => {
      if (p.ws) return;
      removePlayer(room, userId, true);
    }, RECONNECT_GRACE_MS);
    roster(room);
    return;
  }
  persistMatchResult(room, p);
  room.players.delete(userId);
  roomByUser.delete(userId);
  if (room.simulation) GameEngine.disconnectPlayer(room.simulation, userId, true);
  if (!room.players.size) {
    SystemHost.resetIdleRoom(room, GameEngine);
    console.info('[room] system_host_kept_idle_room', JSON.stringify({ roomId: room.id, hostId: SystemHost.ID, mode: room.mode }));
    return;
  }
  roster(room);
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  const origin = req.headers.origin || '';
  try {
    if (url.pathname === '/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true, service: 'rato-snack-realtime', version: '1.3.0-server-authoritative-system-host',
        rooms: rooms.size, onlinePlayers: socketsByUser.size,
        systemHost: { id: SystemHost.ID, nick: SystemHost.PROFILE.nick, alwaysPresent: true },
        authoritativeSimulation: true,
        idleRooms: [...rooms.values()].filter(room => room.players.size === 0).length
      }, origin);
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await upstream('/api/login', 'POST', {
        identifier: body.identifier,
        password: body.password
      });
      const user = result.data && result.data.jogador;
      if (result.status !== 200 || !result.data.ok || !result.data.token || !user) {
        const error = result.status === 401 ? 'credenciais' : result.status === 429 ? 'muitas_tentativas' : 'ratopolis_indisponivel';
        return json(res, result.status, { error }, origin);
      }
      return json(res, 200, {
        token: result.data.token,
        id: String(user.id),
        nick: String(user.nickname)
      }, origin);
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const result = await upstream('/api/me', 'GET', undefined, token);
      const user = result.status === 200 ? extractRatopolisPlayer(result.data) : null;
      if (!user) {
        console.warn('Ratópolis /api/me rejected; upstream status:', result.status,
          'response keys:', Object.keys(result.data || {}).join(','));
        return json(res, 401, { error: 'sessao_invalida' }, origin);
      }
      return json(res, 200, user, origin);
    }
    if (url.pathname === '/api/ws-ticket' && req.method === 'POST') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = await authenticate(token);
      if (!user) return json(res, 401, { error: 'sessao_invalida' }, origin);
      const now = Date.now();
      for (const [key, value] of wsTickets) if (value.expiresAt <= now) wsTickets.delete(key);
      const ticket = crypto.randomUUID();
      wsTickets.set(ticket, { user, expiresAt: now + 30000 });
      return json(res, 200, { ticket, expiresIn: 30 }, origin);
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const result = await upstream('/api/logout', 'POST', {}, token);
      return json(res, result.status, result.data, origin);
    }
    if (url.pathname.startsWith('/api/rato-snack/')) {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : undefined;
      const result = await snackUpstream(url.pathname + url.search, req.method, body, token);
      return json(res, result.status, result.data, origin);
    }
    return json(res, 404, { error: 'not_found' }, origin);
  } catch (error) {
    console.error('HTTP error:', error);
    return json(res, error.message === 'body_too_large' ? 413 : 502, { error: 'upstream_unavailable' }, origin);
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  try {
    const ticket = String(url.searchParams.get('ticket') || '');
    const issued = wsTickets.get(ticket);
    if (!issued || issued.expiresAt <= Date.now()) {
      if (ticket) wsTickets.delete(ticket);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wsTickets.delete(ticket); // ticket de uso único
    const user = issued.user;
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req, user);
    });
  } catch (error) {
    console.error('WebSocket auth error:', error);
    socket.destroy();
  }
});

wss.on('connection', (ws, req, user) => {
  const previous = socketsByUser.get(user.id);
  if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) {
    previous.close(4001, 'account_in_use');
  }
  socketsByUser.set(user.id, ws);
  ws.user = user;
  // Revalida a sessão central periodicamente: logout no portal também derruba o multiplayer.
  const sessionCheck = setInterval(async () => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      const current = await authenticate(user.token);
      if (!current || current.id !== user.id) {
        ws.close(4003, 'central_session_expired');
      }
    } catch (error) {
      // Falha temporária da API central não encerra partidas de jogadores autenticados.
      console.warn('Session revalidation temporarily unavailable:', error.message);
    }
  }, 60000);
  if (typeof sessionCheck.unref === 'function') sessionCheck.unref();
  send(ws, { t: 'hello' });

  const existingRoomId = roomByUser.get(user.id);
  const existingRoom = existingRoomId && rooms.get(existingRoomId);
  if (existingRoom && existingRoom.players.has(user.id)) {
    addPlayer(existingRoom, user, ws);
  }

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (_) { return; }
    let roomId = roomByUser.get(user.id);
    let room = roomId && rooms.get(roomId);

    if (m.t === 'play') {
      if (room && room.players.has(user.id)) {
        addPlayer(room, user, ws);
        return;
      }
      const allowedModes = new Set(['quick', 'treino']);
      const requestedMode = String(m.mode || 'quick');
      if (!allowedModes.has(requestedMode)) {
        send(ws, { t: 'mode_unsupported', mode: requestedMode, supported: ['quick', 'treino'] });
        return;
      }
      const selectedMode = requestedMode;
      room = firstAvailableRoom(selectedMode);
      // A solo player starts immediately with local AI bots; later real players join this live room.
      room.started = true;
      addPlayer(room, user, ws);
      startRoomSimulation(room);
      return;
    }
    if (!room || !room.players.has(user.id)) return;

    if (m.t === 'leave' || (m.t === 'ctl' && m.k === 'end')) {
      const leavingRoomId = room.id;
      const leavingMode = room.mode;
      const wasHost = false; // O anfitrião permanente é interno ao servidor.
      removePlayer(room, user.id, true);
      console.info('[room] player_leave_ack', JSON.stringify({ userId: user.id, roomId: leavingRoomId, mode: leavingMode, wasHost, command: m.t === 'leave' ? 'leave' : 'end' }));
      send(ws, { t: 'left', roomId: leavingRoomId });
      return;
    }
    if (m.t === 'avatar') {
      const a = m.a;
      if (!a || typeof a !== 'object' || JSON.stringify(a).length > 12000) return;
      const clean = {
        x: Math.max(-100000, Math.min(100000, Number(a.x) || 0)),
        y: Math.max(-100000, Math.min(100000, Number(a.y) || 0)),
        d: Number.isFinite(Number(a.d)) ? Number(a.d) : 0,
        l: Math.max(1, Math.min(10000, Math.floor(Number(a.l) || 1))),
        al: a.al ? 1 : 0,
        r: Math.max(4, Math.min(40, Number(a.r) || 10)),
        c: /^#[0-9a-f]{6}$/i.test(String(a.c || '')) ? String(a.c) : '#ffffff',
        n: String(a.n || user.nick || 'Jogador').slice(0, 24),
        sk: String(a.sk || 'liso').slice(0, 20), ac: String(a.ac || 'nenhum').slice(0, 20),
        ta: String(a.ta || 'normal').slice(0, 20), rt: String(a.rt || 'nenhum').slice(0, 24),
        ht: String(a.ht || 'nenhum').slice(0, 24), cl: String(a.cl || 'nenhum').slice(0, 24),
        g: Array.isArray(a.g) ? a.g.slice(0, 240).map(v => Math.max(-100000, Math.min(100000, Math.round(Number(v) || 0)))) : []
      };
      const p = room.players.get(user.id); if (p) p.lastAvatarAt = Date.now();
      broadcast(room, { t: 'avatar', id: user.id, a: clean }, user.id);
      return;
    }
    if (m.t === 'result') {
      const p = room.players.get(user.id); if (!p) return;
      const r = m.r && typeof m.r === 'object' ? m.r : {};
      p.lastResult = { score: Math.max(0, Math.min(1000000000, Math.floor(Number(r.score) || 0))), kills: Math.max(0, Math.min(1000000, Math.floor(Number(r.kills) || 0))), size: Math.max(1, Math.min(10000, Math.floor(Number(r.size) || 1))), duration_ms: Math.max(0, Math.min(86400000, Math.floor(Number(r.duration_ms) || 0))), outcome: String(r.outcome || 'leave').slice(0, 20), receivedAt: Date.now() };
      console.info('[match] client_result_received', JSON.stringify({ userId: user.id, roomId: room.id, ...p.lastResult }));
      return;
    }
    if (m.t === 'in') {
      let input;
      try { input = JSON.parse(String(m.d || '{}')); } catch (_) { return; }
      if (!input || typeof input !== 'object' || JSON.stringify(input).length > 12000) return;
      if (room.simulation) {
        GameEngine.setAppearance(room.simulation, user.id, {
          color: input.col, skin: input.sk, rat: input.rat,
          hat: input.hat, cloth: input.cloth
        });
        GameEngine.setInput(room.simulation, user.id, {
          a: input.a, b: input.b, p: input.away === true
        }, Date.now());
      }
      return;
    }
    if (m.t === 'input') {
      if (!room.simulation) return;
      GameEngine.setInput(room.simulation, user.id, m.input || m, Date.now());
      return;
    }
    if (m.t === 'appearance') {
      if (room.simulation) GameEngine.setAppearance(room.simulation, user.id, m.a || {});
      return;
    }
    if (m.t === 'appearance') return;
  });

  ws.on('close', () => {
    clearInterval(sessionCheck);
    if (socketsByUser.get(user.id) === ws) socketsByUser.delete(user.id);
    const id = roomByUser.get(user.id);
    const room = id && rooms.get(id);
    if (room) {
      const p = room.players.get(user.id);
      if (p && p.ws === ws) {
        console.info('[room] socket_disconnected', JSON.stringify({ userId: user.id, roomId: room.id, mode: room.mode, reconnectGraceMs: RECONNECT_GRACE_MS }));
        removePlayer(room, user.id, false);
      }
    }
  });
  ws.on('error', error => console.error('WebSocket error:', error.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Rato Snack multiplayer server listening on port ' + PORT);
});
