'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8787);
const RATOPOLIS_API_URL = String(process.env.RATOPOLIS_API_URL || 'https://ratopolis-api-dev-v30.juniorgmj69.workers.dev').replace(/\/+$/, '');
const RATO_SNACK_API_URL = String(process.env.RATO_SNACK_API_URL || 'https://rato-snack-api-dev.juniorgmj69.workers.dev').replace(/\/+$/, '');
const RATIVA_CORE_API_URL = String(process.env.RATIVA_CORE_API_URL || 'https://rativa-core-dev.juniorgmj69.workers.dev').replace(/\/+$/, '');
const UPSTREAM_TIMEOUT_MS = Math.max(3000, Math.min(20000, Number(process.env.UPSTREAM_TIMEOUT_MS) || 8000));
const ALLOWED_ORIGINS = new Set([
  'https://vt12gt.github.io',
  'https://ratopolis-cadastro-teste.pages.dev',
  'http://localhost:8158',
  'http://localhost:8787'
]);
const MAX_PLAYERS = 10;
const COUNTDOWN_MS = 5000;
const RECONNECT_GRACE_MS = 30000;
const WORLD_BOSS_TIME_ZONE = 'America/Recife';
const WORLD_BOSS_STARTS = [600, 1320];
const WORLD_BOSS_DURATION_MIN = 60;
const WORLD_BOSS_PREOPEN_MIN = 2;

function worldBossClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: WORLD_BOSS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { day: parts.year + '-' + parts.month + '-' + parts.day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
function worldBossWindow(now = new Date()) {
  const clock = worldBossClock(now);
  for (let i = 0; i < WORLD_BOSS_STARTS.length; i++) {
    const start = WORLD_BOSS_STARTS[i];
    if (clock.minute >= start && clock.minute < start + WORLD_BOSS_DURATION_MIN) {
      return { open: true, preparing: false, slot: i, day: clock.day, start, end: start + WORLD_BOSS_DURATION_MIN };
    }
    if (clock.minute >= start - WORLD_BOSS_PREOPEN_MIN && clock.minute < start) {
      return { open: false, preparing: true, slot: i, day: clock.day, start, end: start + WORLD_BOSS_DURATION_MIN };
    }
  }
  return { open: false, preparing: false, slot: -1, day: clock.day, start: null, end: null };
}
function worldBossMessage() {
  return 'Boss Mundial fechado. Próximos horários: 10:00 e 22:00 (horário de Recife). A entrada só é liberada no horário oficial.';
}
function roomKeyForMode(mode) {
  if (mode === 'mundial') return 'BOSS_MUNDIAL';
  if (mode === 'boss') return 'BOSS';
  return String(mode || 'quick').toUpperCase();
}

const rooms = new Map();
const socketsByUser = new Map();
const staffPresenceTimers = new Map();
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
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
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
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
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
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) return [];
    return extractOfficialAnnouncementRoles(raw);
  } catch (error) {
    console.warn('Rativa Core titles temporarily unavailable:', error.message);
    return [];
  }
}

async function authenticate(token) {
  if (!token || token.length > 4096) return null;
  const result = await upstream('/api/me', 'GET', undefined, token);
  if (result.status >= 500) {
    const error = new Error('ratopolis_upstream_temporarily_unavailable');
    error.upstreamStatus = result.status;
    throw error;
  }
  const user = result.status === 200 ? extractRatopolisPlayer(result.data) : null;
  if (!user) {
    console.warn('Ratópolis session rejected for ticket; upstream status:', result.status,
      'response keys:', Object.keys(result.data || {}).join(','));
    return null;
  }
  const announcementRoles = await officialAnnouncementRoles(token);
  return { ...user, token, announcementRoles };
}

function roomPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    nick: p.nick,
    level: p.level || 1,
    online: !!(p.ws && p.ws.readyState === WebSocket.OPEN),
    slot: p.slot,
    staffRole: p.staffRole || ''
  }));
}
function send(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}
function broadcast(room, message, exceptId) {
  for (const p of room.players.values()) if (p.id !== exceptId) send(p.ws, message);
}
function roster(room) {
  const players = roomPlayers(room);
  for (const p of room.players.values()) send(p.ws, { t: 'roster', mode: room.mode, roomKey: room.roomKey, hostType: room.hostType, hostLabel: 'Bot Pro', players });
}
function clearCountdown(room) {
  if (room.countdown) clearTimeout(room.countdown);
  room.countdown = null;
}
function destroyRoom(room, notify = true) {
  clearCountdown(room);
  rooms.delete(room.id);
  for (const p of room.players.values()) {
    roomByUser.delete(p.id);
    if (notify) send(p.ws, { t: 'end' });
  }
  room.players.clear();
}
function createRoom(mode) {
  const room = {
    mode,
    roomKey: roomKeyForMode(mode),
    id: crypto.randomUUID(),
    players: new Map(),
    results: new Map(),
    sharedDrops: new Map(),
    killCounts: new Map(),
    hostId: null,
    hostType: 'bot-pro',
    started: false,
    startedAt: 0,
    lastClockBroadcastAt: 0,
    countdown: null,
    createdAt: Date.now()
  };
  rooms.set(room.id, room);
  return room;
}
function firstAvailableRoom(mode) {
  const key = roomKeyForMode(mode);
  for (const room of rooms.values()) {
    if (room.roomKey === key && room.players.size < MAX_PLAYERS) return room;
  }
  return createRoom(mode);
}
function syncWorldBossRoom() {
  const state = worldBossWindow();
  let room = [...rooms.values()].find(item => item.roomKey === 'BOSS_MUNDIAL');
  if (state.preparing) {
    if (!room) room = createRoom('mundial');
    room.preparing = true;
    room.joinable = false;
    return;
  }
  if (state.open) {
    if (!room) room = createRoom('mundial');
    room.preparing = false;
    room.joinable = true;
    room.started = true;
    return;
  }
  if (room) destroyRoom(room, true);
}
function startCountdown(room) {
  if (room.started || room.countdown || room.players.size < 2) return;
  room.countdown = setTimeout(() => {
    room.countdown = null;
    if (!rooms.has(room.id) || room.players.size < 2) return;
    room.started = true;
    broadcast(room, { t: 'start', mode: room.mode, roomKey: room.roomKey });
  }, COUNTDOWN_MS);
  broadcast(room, { t: 'countdown', ms: COUNTDOWN_MS, mode: room.mode, roomKey: room.roomKey });
}
function addPlayer(room, user, ws) {
  if (room.roomKey === 'BOSS_MUNDIAL' && !worldBossWindow().open) {
    send(ws, { t: 'room_closed', mode: 'mundial', roomKey: 'BOSS_MUNDIAL', message: worldBossMessage() });
    return false;
  }
  const old = room.players.get(user.id);
  if (old && old.reconnectTimer) clearTimeout(old.reconnectTimer);
  const firstHuman = !room.hostId;
  const usedSlots = new Set([...room.players.values()].filter(p => p.id !== user.id).map(p => p.slot));
  let nextSlot = 1;
  while (nextSlot < MAX_PLAYERS && usedSlots.has(nextSlot)) nextSlot++;
  const slot = old ? old.slot : (firstHuman ? 0 : nextSlot);
  if (slot >= MAX_PLAYERS) { send(ws, { t: 'full' }); return; }
  const player = old || { id: user.id, nick: user.nick, level: user.level || 1, ws: null, reconnectTimer: null, slot };
  player.nick = user.nick;
  player.level = user.level || 1;
  player.staffRole = (user.announcementRoles || []).find(role => ['founder','spadmin','gm'].includes(role)) || '';
  player.ws = ws;
  player.reconnectTimer = null;
  room.players.set(user.id, player);
  roomByUser.set(user.id, room.id);
  if (room.started && !room.startedAt) room.startedAt = Date.now();
  if (!room.hostId) room.hostId = user.id;
  const isHost = room.hostId === user.id;
  send(ws, { t: 'joined', roomId: room.id, host: room.hostId, isHost, hostType: room.hostType, hostLabel: 'Bot Pro', mode: room.mode, roomKey: room.roomKey, roomElapsedMs: room.startedAt ? Math.max(0, Date.now() - room.startedAt) : 0, players: roomPlayers(room) });
  if (isHost) {
    // Host does not need a peer_join event for itself.
  } else {
    const host = room.players.get(room.hostId);
    if (host && host.ws) send(host.ws, { t: old ? 'peer_back' : 'peer_join', id: user.id, nick: user.nick, slot: player.slot });
    if (room.mode === 'treino') broadcast(room, { t: 'peer_join', id: user.id, nick: user.nick, slot: player.slot }, user.id);
  }
  if (room.started) {
    send(ws, { t: 'start', mode: room.mode, roomKey: room.roomKey });
  } else {
    startCountdown(room);
  }
  roster(room);
}
function removePlayer(room, userId, deliberate = false) {
  const p = room.players.get(userId);
  if (!p) return;
  if (p.reconnectTimer) clearTimeout(p.reconnectTimer);
  if (!deliberate && p.ws) {
    p.ws = null;
    const host = room.players.get(room.hostId);
    if (host && host.id !== userId) send(host.ws, { t: 'peer_offline', id: userId });
    p.reconnectTimer = setTimeout(() => {
      if (p.ws) return;
      removePlayer(room, userId, true);
    }, RECONNECT_GRACE_MS);
    roster(room);
    return;
  }
  room.players.delete(userId);
  roomByUser.delete(userId);
  if (userId === room.hostId) {
    destroyRoom(room, true);
    return;
  }
  const host = room.players.get(room.hostId);
  if (host) send(host.ws, { t: 'peer_leave', id: userId });
  if (room.mode === 'treino') broadcast(room, { t: 'peer_leave', id: userId });
  if (!room.started && room.players.size < 2) clearCountdown(room);
  roster(room);
  if (room.players.size === 0) destroyRoom(room, false);
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
      return json(res, 200, { ok: true, service: 'rato-snack-realtime', version: '1.0.0', rooms: rooms.size, onlinePlayers: socketsByUser.size }, origin);
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
      if (result.status >= 500) {
        console.error('Ratópolis /api/me temporarily unavailable; upstream status:', result.status,
          'response keys:', Object.keys(result.data || {}).join(','));
        return json(res, 503, { error: 'ratopolis_temporariamente_indisponivel' }, origin);
      }
      if (result.status === 401 || result.status === 403) {
        console.warn('Ratópolis session rejected; upstream status:', result.status);
        return json(res, 401, { error: 'sessao_invalida' }, origin);
      }
      const user = result.status === 200 ? extractRatopolisPlayer(result.data) : null;
      if (!user) {
        console.error('Ratópolis /api/me returned an invalid response; upstream status:', result.status,
          'response keys:', Object.keys(result.data || {}).join(','));
        return json(res, 502, { error: 'resposta_invalida_do_portal' }, origin);
      }
      return json(res, 200, user, origin);
    }
    if (url.pathname === '/api/admin/announcements/access' && req.method === 'GET') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = await authenticate(token);
      if (!user) return json(res, 401, { error: 'sessao_invalida' }, origin);
      const roles = user.announcementRoles || [];
      return json(res, 200, { ok: true, allowed: roles.some(role => ['founder','spadmin','gm'].includes(role)), roles: roles.filter(role => ['founder','spadmin','gm'].includes(role)) }, origin);
    }
    if (url.pathname === '/api/admin/announcements' && req.method === 'POST') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = await authenticate(token);
      if (!user) return json(res, 401, { error: 'sessao_invalida' }, origin);
      const roles = user.announcementRoles || [];
      if (!roles.some(role => ['founder','spadmin','gm'].includes(role))) return json(res, 403, { error: 'permissao_insuficiente' }, origin);
      const body = await readBody(req);
      const message = String(body.message || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (message.length < 3) return json(res, 400, { error: 'mensagem_muito_curta' }, origin);
      const announcement = { t: 'global_announcement', kind: 'manual', nickname: user.nick, roles, message, displayMs: 8000, issuedAt: Date.now() };
      for (const connected of socketsByUser.values()) send(connected, announcement);
      return json(res, 200, { ok: true, deliveredTo: socketsByUser.size }, origin);
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
    const timedOut = error && error.name === 'TimeoutError';
    const status = error.message === 'body_too_large' ? 413 : timedOut ? 504 : error.upstreamStatus >= 500 ? 503 : 502;
    const code = status === 504 ? 'upstream_timeout' : status === 503 ? 'ratopolis_temporariamente_indisponivel' : 'upstream_unavailable';
    return json(res, status, { error: code }, origin);
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
  if (Array.isArray(user.announcementRoles) && user.announcementRoles.length) {
    send(ws, { t: 'staff_panel_access', allowed: true, roles: user.announcementRoles });
    const announcement = {
      t: 'global_announcement',
      kind: 'staff_online',
      nickname: user.nick,
      roles: user.announcementRoles,
      displayMs: 8000,
      issuedAt: Date.now()
    };
    for (const connected of socketsByUser.values()) send(connected, announcement);
    if (user.announcementRoles.some(role => role === 'founder' || role === 'spadmin')) {
      const timer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN || socketsByUser.get(user.id) !== ws) { clearInterval(timer); staffPresenceTimers.delete(user.id); return; }
        const repeat = { ...announcement, issuedAt: Date.now(), repeat: true };
        for (const connected of socketsByUser.values()) send(connected, repeat);
      }, 300000);
      staffPresenceTimers.set(user.id, timer);
    }
  }

  const existingRoomId = roomByUser.get(user.id);
  const existingRoom = existingRoomId && rooms.get(existingRoomId);
  if (existingRoom && existingRoom.players.has(user.id)) {
    if (existingRoom.roomKey === 'BOSS_MUNDIAL' && !worldBossWindow().open) {
      send(ws, { t: 'room_closed', mode: 'mundial', roomKey: 'BOSS_MUNDIAL', message: worldBossMessage() });
      removePlayer(existingRoom, user.id, true);
    } else {
      addPlayer(existingRoom, user, ws);
    }
  }

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (_) { return; }
    let roomId = roomByUser.get(user.id);
    let room = roomId && rooms.get(roomId);

    if (m.t === 'play') {
      const allowedModes = new Set(['quick','survival','challenge','team','boss','infinite','daily','treino','mundial']);
      const requestedMode = String(m.mode || 'quick');
      const selectedMode = allowedModes.has(requestedMode) ? requestedMode : 'quick';
      if (selectedMode === 'mundial' && !worldBossWindow().open) {
        send(ws, { t: 'room_closed', mode: 'mundial', roomKey: 'BOSS_MUNDIAL', message: worldBossMessage() });
        return;
      }
      if (room && room.players.has(user.id)) {
        if (room.roomKey !== roomKeyForMode(selectedMode)) {
          send(ws, { t: 'room_mode_mismatch', requestedMode: selectedMode, roomMode: room.mode, roomKey: room.roomKey });
          return;
        }
        addPlayer(room, user, ws);
        return;
      }
      room = firstAvailableRoom(selectedMode);
      // A solo player starts immediately with local AI bots; later real players join this live room.
      room.started = true;
      if (!room.startedAt) room.startedAt = Date.now();
      addPlayer(room, user, ws);
      return;
    }
    if (!room || !room.players.has(user.id)) return;

    if (m.t === 'leave' || (m.t === 'ctl' && m.k === 'end')) {
      const leavingRoomId = room.id;
      const leavingMode = room.mode;
      const wasHost = room.hostId === user.id;
      removePlayer(room, user.id, true);
      console.info('[room] player_leave_ack', JSON.stringify({ userId: user.id, roomId: leavingRoomId, mode: leavingMode, wasHost, command: m.t === 'leave' ? 'leave' : 'end' }));
      send(ws, { t: 'left', roomId: leavingRoomId });
      return;
    }
    if (m.t === 'world_event') {
      const e = m.event && typeof m.event === 'object' ? m.event : {};
      const senderIsHost = user.id === room.hostId;
      if (e.kind === 'bot_death') {
        if (!senderIsHost) return;
        const botIndex = Math.floor(Number(e.botIndex));
        if (!Number.isInteger(botIndex) || botIndex < 0 || botIndex > 100) return;
        const killerId = String(e.killerId || '');
        if (killerId && !room.players.has(killerId)) return;
        if (killerId) room.killCounts.set(killerId, Number(room.killCounts.get(killerId) || 0) + 1);
        broadcast(room, { t: 'bot_death', botIndex, killerId, mode: room.mode, at: Date.now() });
        return;
      }
      if (e.kind === 'drops') {
        const source = String(e.source || '');
        if ((source === 'bot' && !senderIsHost) || (source === 'player' && !room.players.has(user.id))) return;
        if (!['bot', 'player'].includes(source)) return;
        const input = Array.isArray(e.items) ? e.items.slice(0, 180) : [];
        const items = [];
        for (const raw of input) {
          if (!raw || typeof raw !== 'object') continue;
          const x = Number(raw.x), y = Number(raw.y), radius = Number(raw.r);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius)) continue;
          const id = crypto.randomUUID();
          const item = {
            id, x: Math.max(-1000000, Math.min(1000000, x)),
            y: Math.max(-1000000, Math.min(1000000, y)),
            type: Math.max(0, Math.min(8, Math.floor(Number(raw.type) || 0))),
            color: /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? String(raw.color) : '#ffd23e',
            r: Math.max(3, Math.min(30, radius))
          };
          room.sharedDrops.set(id, { ...item, createdAt: Date.now(), claimedBy: null });
          items.push(item);
        }
        while (room.sharedDrops.size > 600) room.sharedDrops.delete(room.sharedDrops.keys().next().value);
        if (items.length) broadcast(room, { t: 'drops_spawned', items, source, sourceId: user.id });
        return;
      }
      return;
    }
    if (m.t === 'drop_claim') {
      const dropId = String(m.dropId || '');
      const drop = room.sharedDrops.get(dropId);
      if (!drop || drop.claimedBy) return;
      drop.claimedBy = user.id;
      drop.claimedAt = Date.now();
      room.sharedDrops.delete(dropId);
      broadcast(room, { t: 'drop_claimed', dropId, collectorId: user.id, nick: String(user.nick || 'Jogador').slice(0, 24) });
      return;
    }
    if (m.t === 'result') {
      const r = m.r && typeof m.r === 'object' ? m.r : {};
      const score = Math.max(0, Math.min(1000000000, Math.floor(Number(r.score) || 0)));
      const kills = Math.max(0, Math.min(1000000, Math.floor(Number(r.kills) || 0)));
      const size = Math.max(1, Math.min(1000000, Math.floor(Number(r.size) || 1)));
      const durationMs = Math.max(0, Math.min(86400000, Math.floor(Number(r.duration_ms) || 0)));
      room.results.set(user.id, {
        id: user.id, nick: String(user.nick || 'Jogador').slice(0, 24),
        score, kills: Math.max(kills, Number(room.killCounts.get(user.id) || 0)), size, duration_ms: durationMs,
        outcome: String(r.outcome || 'finished').slice(0, 24), updatedAt: Date.now()
      });
      const ranking = [...room.results.values()].sort((a, b) =>
        room.mode === 'survival'
          ? (b.duration_ms - a.duration_ms) || (b.kills - a.kills)
          : (b.score - a.score) || (b.kills - a.kills)
      ).slice(0, MAX_PLAYERS);
      broadcast(room, { t: 'match_ranking', roomId: room.id, mode: room.mode, ranking });
      return;
    }
    if (m.t === 'avatar') {
      // Retransmissão de estado visual: o cliente controla a própria cobra;
      // o servidor apenas valida o formato básico e distribui aos demais jogadores.
      const a = m.a && typeof m.a === 'object' ? m.a : null;
      const now = Date.now();
      const sender = room.players.get(user.id);
      if (!a || !sender || (sender.lastAvatarAt && now - sender.lastAvatarAt < 55)) return;
      const x = Number(a.x), y = Number(a.y), d = Number(a.d);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(d)) return;
      const g = Array.isArray(a.g) ? a.g.slice(0, 180).map(Number).filter(Number.isFinite) : [];
      const avatar = {
        x: Math.max(-1000000, Math.min(1000000, x)),
        y: Math.max(-1000000, Math.min(1000000, y)),
        d, l: Math.max(1, Math.min(10000, Math.floor(Number(a.l) || 1))),
        al: a.al ? 1 : 0, r: Math.max(4, Math.min(40, Number(a.r) || 10)),
        c: String(a.c || '').slice(0, 24), n: String(a.n || user.nick || 'Jogador').slice(0, 24),
        sk: String(a.sk || 'liso').slice(0, 24), ac: String(a.ac || 'nenhum').slice(0, 24),
        ta: String(a.ta || 'normal').slice(0, 24), rt: String(a.rt || 'nenhum').slice(0, 24),
        ht: String(a.ht || 'nenhum').slice(0, 24), cl: String(a.cl || 'nenhum').slice(0, 24), g
      };
      sender.lastAvatarAt = now;
      broadcast(room, { t: 'avatar', id: user.id, a: avatar }, user.id);
      if (!room.startedAt) room.startedAt = now;
      if (now - Number(room.lastClockBroadcastAt || 0) >= 1000) {
        room.lastClockBroadcastAt = now;
        broadcast(room, { t: 'room_clock', roomId: room.id, mode: room.mode, elapsedMs: Math.max(0, now - room.startedAt), serverTime: now });
      }
      return;
    }
    if (m.t === 'in') {
      const host = room.players.get(room.hostId);
      if (host && host.ws) send(host.ws, { t: 'in', from: user.id, d: String(m.d || '').slice(0, 60000) });
      return;
    }
    if (m.t === 'st') {
      const target = room.players.get(String(m.to || ''));
      if (target && target.ws) send(target.ws, { t: 'st', from: user.id, d: String(m.d || '').slice(0, 60000) });
      return;
    }
  });

  ws.on('close', () => {
    clearInterval(sessionCheck);
    const staffTimer = staffPresenceTimers.get(user.id);
    if (staffTimer) { clearInterval(staffTimer); staffPresenceTimers.delete(user.id); }
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

syncWorldBossRoom();
setInterval(syncWorldBossRoom, 5000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Rato Snack multiplayer server listening on port ' + PORT);
});

// Deploy signal: reapresenta o commit ao webhook do Render sem alterar a lógica.
