// 온라인 3D FPS 완전판 서버
// 기능: 회원가입/로그인/방파기/실시간 멀티플레이(3개 모드) + 봇 지원
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function loadUsers() {
  try {
    const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    let dirty = false;
    for (const u of arr) { if (ensureStats(u)) dirty = true; }
    if (dirty) fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2));
    return arr;
  }
  catch { return []; }
}
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

// 랭킹/경쟁전 스탯 보장 (구 계정 마이그레이션)
function ensureStats(u) {
  let touched = false;
  const defaults = { rating: 1000, wins: 0, losses: 0, kills: 0, deaths: 0, mvp: 0, matches: 0 };
  for (const [k, v] of Object.entries(defaults)) if (u[k] === undefined) { u[k] = v; touched = true; }
  return touched;
}
function getTier(rating) {
  if (rating >= 2000) return '그랜드마스터';
  if (rating >= 1800) return '마스터';
  if (rating >= 1600) return '다이아';
  if (rating >= 1400) return '플래티넘';
  if (rating >= 1200) return '골드';
  if (rating >= 1000) return '실버';
  return '브론즈';
}

// token -> userId
const sessions = new Map();
// roomId -> room
const rooms = new Map();
// socketId -> { userId, nickname, roomId, team, hp, alive, pos, kills, deaths }
const players = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Auth API ----------
app.post('/api/register', async (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (!username || !password || !nickname) return res.status(400).json({ error: '아이디, 비밀번호, 닉네임을 모두 입력하세요.' });
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: '아이디 3자 이상, 비밀번호 4자 이상' });
  const users = loadUsers();
  if (users.find(u => u.username === username)) return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });
  if (users.find(u => u.nickname === nickname)) return res.status(409).json({ error: '이미 존재하는 닉네임입니다.' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuidv4(), username, nickname, passwordHash: hash, kills: 0, deaths: 0, wins: 0, losses: 0, matches: 0, mvp: 0, rating: 1000, createdAt: Date.now() };
  users.push(user);
  saveUsers(users);
  return res.json({ ok: true, message: '회원가입 성공! 로그인하세요.' });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다.' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 틀렸습니다.' });
  // 같은 계정의 오래된 토큰 정리 (세션 누적 방지)
  for (const [tok, uid] of sessions) if (uid === user.id) sessions.delete(tok);
  const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  sessions.set(token, user.id);
  return res.json({ ok: true, token, nickname: user.nickname, username: user.username });
});

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const users = loadUsers();
  const user = users.find(u => u.id === sessions.get(token));
  if (!user) return res.status(401).json({ error: '세션 만료' });
  req.user = user; req.token = token;
  next();
}

app.get('/api/me', authMiddleware, (req, res) => {
  const { passwordHash, ...safe } = req.user;
  safe.tier = getTier(safe.rating || 1000);
  res.json({ ok: true, user: safe });
});

// ---------- 랭킹 API ----------
app.get('/api/rankings', (req, res) => {
  const users = loadUsers();
  const board = users
    .map(u => {
      const kd = u.deaths > 0 ? (u.kills / u.deaths) : u.kills;
      return { nickname: u.nickname, rating: u.rating || 1000, tier: getTier(u.rating || 1000), wins: u.wins || 0, losses: u.losses || 0, kills: u.kills || 0, deaths: u.deaths || 0, kd: Math.round(kd * 100) / 100, matches: (u.wins || 0) + (u.losses || 0) };
    })
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 30);
  res.json({ ok: true, rankings: board });
});

app.post('/api/logout', authMiddleware, (req, res) => {
  sessions.delete(req.token);
  res.json({ ok: true });
});

// roomId 소속 플레이어 공개 목록 (소켓/HTTP 공용)
function roomPlayersById(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.order.map(sid => {
    const pl = players.get(sid);
    return pl ? { nickname: pl.nickname, team: pl.team, hp: pl.hp, alive: pl.alive, kills: pl.kills, deaths: pl.deaths, pos: pl.pos, yaw: pl.yaw } : null;
  }).filter(Boolean);
}

// ---------- 닉네임 변경 ----------
app.patch('/api/nickname', authMiddleware, (req, res) => {
  const nn = String((req.body || {}).nickname || '').trim().slice(0, 12);
  if (nn.length < 2) return res.status(400).json({ error: '닉네임은 2~12자로 입력하세요.' });
  if (/[&<>"']/.test(nn)) return res.status(400).json({ error: '특수문자 & < > " \' 는 사용 불가' });
  const users = loadUsers();
  const me = users.find(u => u.id === req.user.id);
  if (!me) return res.status(401).json({ error: '세션 만료' });
  if (users.find(u => u.nickname === nn && u.id !== me.id)) return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
  if (me.nickname === nn) return res.json({ ok: true, nickname: nn, message: '같은 닉네임입니다.' });
  const old = me.nickname;
  me.nickname = nn;
  saveUsers(users);
  // 개설한 방의 방장 표시 갱신
  for (const room of rooms.values()) if (room.host === old) room.host = nn;
  // 접속 중 플레이어 표시 갱신 + 소속 방에 알림
  const touched = new Set();
  for (const pl of players.values()) {
    if (pl.userId !== me.id) continue;
    pl.nickname = nn;
    if (pl.roomId && rooms.get(pl.roomId)) touched.add(pl.roomId);
  }
  for (const rid of touched) {
    io.to('room_' + rid).emit('room:players', roomPlayersById(rid));
    io.to('room_' + rid).emit('chat:msg', { sys: true, text: `✎ ${old} → ${nn} (닉네임 변경)` });
  }
  broadcastLobby();
  res.json({ ok: true, nickname: nn, message: `닉네임이 ${nn}(으)로 변경되었습니다.` });
});

// ---------- Room API ----------
const MODES = {
  conquest: { name: '정복전 (배틀필드식)', desc: 'A/B/C 거점 점령, 티켓 200', defaultMap: 'desert_storm', maxPlayers: 16 },
  operation: { name: '블랙호크 작전 (델타포스식)', desc: '광활한 밸리, 목표물 파괴 + 생존', defaultMap: 'delta_valley', maxPlayers: 12 },
  defuse: { name: '폭탄 해체전 (카스식)', desc: '5라운드, 폭탄 설치/해체, 경제 시스템', defaultMap: 'cs_dust', maxPlayers: 10 }
};

function publicRoom(r) {
  return { id: r.id, name: r.name, mode: r.mode, map: r.map, maxPlayers: r.maxPlayers, host: r.host, playerCount: r.order.length, status: r.status, createdAt: r.createdAt, ranked: !!r.ranked };
}

app.get('/api/modes', (req, res) => res.json({ ok: true, modes: MODES }));
app.get('/api/rooms', (req, res) => res.json({ ok: true, rooms: [...rooms.values()].map(publicRoom) }));

app.post('/api/rooms', authMiddleware, (req, res) => {
  let { name, mode, map, maxPlayers, ranked } = req.body || {};
  if (!MODES[mode]) return res.status(400).json({ error: '모드 선택 오류' });
  name = (name || `${req.user.nickname}의 방`).slice(0, 24);
  maxPlayers = Math.min(Math.max(parseInt(maxPlayers) || 10, 2), 20);
  ranked = !!ranked;
  if (ranked) maxPlayers = Math.min(maxPlayers, 12); // 경쟁전은 12명 이하 권장
  const id = uuidv4().slice(0, 8);
  const room = {
    id, name: ranked ? `[경쟁] ${name}` : name, mode, map: map || MODES[mode].defaultMap, maxPlayers,
    host: req.user.nickname, hostId: req.user.id, ranked,
    order: [], teams: {}, status: ranked ? 'ranked' : 'waiting', createdAt: Date.now(),
    state: initRoomState(mode)
  };
  rooms.set(id, room);
  broadcastLobby();
  res.json({ ok: true, room: publicRoom(room) });
});

// 경쟁전 빠른 매칭: 비어있는 경쟁방 or 신규 생성
app.post('/api/competitive/quick', authMiddleware, (req, res) => {
  const { mode } = req.body || {};
  const m = MODES[mode] ? mode : 'defuse';
  const me = req.user;
  // 레이팅 ±300 이내, 자리 있는 경쟁방 우선
  const cand = [...rooms.values()]
    .filter(r => r.ranked && r.mode === m && r.order.length < r.maxPlayers)
    .sort((a, b) => a.order.length - b.order.length)[0];
  if (cand) return res.json({ ok: true, room: publicRoom(cand), quick: true });
  const id = uuidv4().slice(0, 8);
  const room = {
    id, name: `[경쟁] ${me.nickname}의 ${m} 매치`, mode: m, map: MODES[m].defaultMap,
    maxPlayers: m === 'defuse' ? 10 : 12, host: me.nickname, hostId: me.id, ranked: true,
    order: [], teams: {}, status: 'ranked', createdAt: Date.now(), state: initRoomState(m)
  };
  rooms.set(id, room);
  broadcastLobby();
  res.json({ ok: true, room: publicRoom(room), quick: true, created: true });
});

app.delete('/api/rooms/:id', authMiddleware, (req, res) => {
  const r = rooms.get(req.params.id);
  if (!r) return res.status(404).json({ error: '방 없음' });
  if (r.hostId !== req.user.id) return res.status(403).json({ error: '방장만 삭제 가능' });
  io.to('room_' + r.id).emit('room:closed', { message: '방장이 방을 폭파했습니다.' });
  rooms.delete(req.params.id);
  broadcastLobby();
  res.json({ ok: true });
});

function initRoomState(mode) {
  if (mode === 'conquest') return { tickets: { alpha: 200, bravo: 200 }, flags: { A: 'neutral', B: 'neutral', C: 'neutral' }, progress: { A: 0, B: 0, C: 0 } };
  if (mode === 'operation') return { objectiveHp: 1000, phase: 'combat', targetDestroyed: false };
  return { round: 1, maxRounds: 5, score: { CT: 0, T: 0 }, bomb: { planted: false, site: null, timeLeft: 0, exploded: false }, phase: 'buy', roundTimer: 100 };
}

function broadcastLobby() {
  io.emit('lobby:update', { rooms: [...rooms.values()].map(publicRoom) });
}

// 빈 방 정리 (5분 이상 0명 방 삭제, 로비 누적 방지)
setInterval(() => {
  let changed = false;
  for (const [id, room] of rooms) {
    if (room.order.length === 0) {
      if (!room.emptySince) room.emptySince = Date.now();
      else if (Date.now() - room.emptySince > 5 * 60 * 1000) { rooms.delete(id); changed = true; }
    } else room.emptySince = null;
  }
  if (changed) broadcastLobby();
}, 60 * 1000);

function assignTeam(room) {
  // defuse: CT/T, else alpha/bravo
  const counts = {};
  for (const sid of room.order) { const p = players.get(sid); if (p) counts[p.team] = (counts[p.team] || 0) + 1; }
  if (room.mode === 'defuse') return (counts['CT'] || 0) <= (counts['T'] || 0) ? 'CT' : 'T';
  return (counts['alpha'] || 0) <= (counts['bravo'] || 0) ? 'alpha' : 'bravo';
}

// 경쟁전 레이팅 정산 (승 +25, 패 -15, 무승부 +0, 최소 0)
// 킬/데스는 persistKill에서 즉시 반영되므로 여기선 승패/레이팅만 처리
function settleMatch(room, winner) {
  const users = loadUsers();
  let dirty = false;
  const changes = [];
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (!pl) continue;
    const u = users.find(x => x.id === pl.userId);
    if (!u) continue;
    ensureStats(u);
    if (room.ranked && winner && winner !== 'draw') {
      const won = pl.team === winner;
      const delta = won ? 25 : -15;
      u.rating = Math.max(0, (u.rating || 1000) + delta);
      if (won) u.wins = (u.wins || 0) + 1; else u.losses = (u.losses || 0) + 1;
      u.matches = (u.wins || 0) + (u.losses || 0);
      changes.push({ nickname: u.nickname, delta, rating: u.rating, tier: getTier(u.rating) });
      dirty = true;
    }
  }
  if (dirty) saveUsers(users);
  return changes;
}

// 매치 종료 공통 처리 (정산+브로드캐스트+상태리셋)
function endMatch(room, winner, reason) {
  const changes = settleMatch(room, winner);
  let mvp = null; // 세션 최다킬
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (pl && pl.kills > 0 && (!mvp || pl.kills > mvp.kills)) mvp = { nickname: pl.nickname, kills: pl.kills, team: pl.team };
  }
  io.to('room_' + room.id).emit('game:over', { winner, reason, state: room.state, ranked: !!room.ranked, ratingChanges: changes, mvp });
  room.state = initRoomState(room.mode);
  io.to('room_' + room.id).emit('game:reset', { state: room.state });
}

// 킬 발생 시 영구 스탯 즉시 반영 (랭킹용)
function persistKill(killerUserId, victimUserId) {
  try {
    const users = loadUsers();
    let dirty = false;
    const k = users.find(x => x.id === killerUserId);
    const v = users.find(x => x.id === victimUserId);
    if (k) { ensureStats(k); k.kills = (k.kills || 0) + 1; dirty = true; }
    if (v) { ensureStats(v); v.deaths = (v.deaths || 0) + 1; dirty = true; }
    if (dirty) saveUsers(users);
  } catch (e) { /* 랭킹 저장 실패는 게임에 영향 없음 */ }
}

// 주기적 룸 상태 업데이트 (티켓 감소, 폭탄 타이머, 라운드 타이머)
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.order.length === 0) continue;
    if (room.mode === 'conquest') {
      const flagOwners = Object.values(room.state.flags);
      const a = flagOwners.filter(f => f === 'alpha').length;
      const b = flagOwners.filter(f => f === 'bravo').length;
      if (a > b) room.state.tickets.bravo = Math.max(0, room.state.tickets.bravo - a);
      else if (b > a) room.state.tickets.alpha = Math.max(0, room.state.tickets.alpha - b);
      if (room.state.tickets.alpha <= 0 || room.state.tickets.bravo <= 0) {
        const winner = room.state.tickets.alpha <= 0 ? 'bravo' : 'alpha';
        endMatch(room, winner, room.ranked ? '[경쟁] 티켓 소진' : '티켓 소진');
      } else {
        io.to('room_' + room.id).emit('game:tick', { state: room.state });
      }
    }
    if (room.mode === 'defuse' && room.state.bomb.planted) {
      room.state.bomb.timeLeft -= 1;
      if (room.state.bomb.timeLeft <= 0 && !room.state.bomb.exploded) {
        room.state.bomb.exploded = true;
        room.state.score.T++;
        io.to('room_' + room.id).emit('bomb:exploded', { state: room.state });
        setTimeout(() => nextRound(room), 3000);
      } else {
        io.to('room_' + room.id).emit('game:tick', { state: room.state });
      }
    }
  }
}, 1000);

function nextRound(room) {
  if (!rooms.get(room.id)) return;
  if (room.state.round >= room.state.maxRounds) {
    const winner = room.state.score.CT === room.state.score.T ? 'draw' : (room.state.score.CT > room.state.score.T ? 'CT' : 'T');
    endMatch(room, winner, room.ranked ? '[경쟁] 전 라운드 종료' : '전 라운드 종료');
  } else {
    room.state.round++;
    room.state.bomb = { planted: false, site: null, timeLeft: 0, exploded: false };
    room.state.phase = 'buy';
    room.state.roundTimer = 100;
  }
  io.to('room_' + room.id).emit('round:next', { state: room.state });
}

// ---------- Socket ----------
io.on('connection', (socket) => {
  // 로그인 토큰 검증
  socket.on('auth', (d) => {
    const token = d && d.token;
    if (!token) return socket.emit('auth:fail');
    const uid = sessions.get(token);
    const users = loadUsers();
    const user = users.find(u => u.id === uid);
    if (!user) return socket.emit('auth:fail');
    players.set(socket.id, { socketId: socket.id, userId: user.id, nickname: user.nickname, roomId: null, team: null, hp: 100, alive: true, kills: 0, deaths: 0, money: 800, pos: { x: 0, y: 1.7, z: 0 }, yaw: 0 });
    socket.emit('auth:ok', { nickname: user.nickname });
    socket.emit('lobby:update', { rooms: [...rooms.values()].map(publicRoom) });
  });

  socket.on('room:join', (d) => {
    const roomId = d && d.roomId;
    const p = players.get(socket.id);
    const room = roomId && rooms.get(roomId);
    if (!p) return socket.emit('error:msg', '서버 로그인 동기화 안됨. 1초 뒤 다시 입장 눌러주세요. (소켓 재접속 중)');
    if (!room) return socket.emit('error:msg', '방이 존재하지 않습니다. 새로고침 후 다시 시도하세요.');
    if (room.order.includes(socket.id)) {
      // 이미 입장 상태면 상태만 재전송 (중복입장 방지)
      socket.join('room_' + roomId);
      return socket.emit('room:joined', { room: publicRoom(room), team: p.team, state: room.state, you: p.nickname });
    }
    if (room.order.length >= room.maxPlayers) return socket.emit('error:msg', '방이 가득 찼습니다.');
    // 기존 방 떠나기
    if (p.roomId) leaveRoom(socket);
    p.roomId = roomId;
    p.team = assignTeam(room);
    p.hp = 100; p.alive = true;
    room.order.push(socket.id);
    socket.join('room_' + roomId);
    socket.emit('room:joined', { room: publicRoom(room), team: p.team, state: room.state, you: p.nickname });
    io.to('room_' + roomId).emit('room:players', roomPlayers(roomId));
    io.to('room_' + roomId).emit('chat:msg', { sys: true, text: `▶ ${p.nickname} (${p.team}) 입장` });
    broadcastLobby();
  });

  function leaveRoom(sock) {
    const pl = players.get(sock.id);
    if (!pl || !pl.roomId) return;
    const room = rooms.get(pl.roomId);
    if (room) {
      room.order = room.order.filter(id => id !== sock.id);
      sock.leave('room_' + room.id);
      io.to('room_' + room.id).emit('player:left', { nickname: pl.nickname });
      io.to('room_' + room.id).emit('room:players', roomPlayers(room.id));
      if (room.order.length === 0) { /* 빈방 유지 (목록용) */ }
      broadcastLobby();
    }
    pl.roomId = null; pl.team = null;
  }
  socket.on('room:leave', () => leaveRoom(socket));

  function roomPlayers(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    return room.order.map(sid => {
      const pl = players.get(sid);
      return pl ? { nickname: pl.nickname, team: pl.team, hp: pl.hp, alive: pl.alive, kills: pl.kills, deaths: pl.deaths, pos: pl.pos, yaw: pl.yaw } : null;
    }).filter(Boolean);
  }

  // 위치 동기화 (20Hz로 클라이언트가 전송)
  socket.on('player:state', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !d || !d.pos) return;
    p.pos = d.pos; p.yaw = d.yaw;
    socket.to('room_' + p.roomId).emit('player:move', { nickname: p.nickname, team: p.team, pos: d.pos, yaw: d.yaw, hp: p.hp, alive: p.alive });
  });

  // 피해 적용 공용 (총탄·수류탄): HP 차감→사망/데미지 브로드캐스트→리스폰
  function strike(room, shooter, targetEntry, damage, weapon) {
    if (!room || !targetEntry || !targetEntry.alive) return;
    targetEntry.hp -= damage;
    if (targetEntry.hp <= 0) {
      targetEntry.hp = 0; targetEntry.alive = false;
      targetEntry.deaths++; shooter.kills++;
      shooter.money = (shooter.money || 800) + 300;
      persistKill(shooter.userId, targetEntry.userId); // 랭킹 영구 반영
      io.to('room_' + room.id).emit('player:killed', {
        killer: shooter.nickname, victim: targetEntry.nickname, weapon,
        killerTeam: shooter.team, victimTeam: targetEntry.team
      });
      io.to('room_' + room.id).emit('room:players', roomPlayers(room.id));
      // 3초 후 리스폰 (defuse 모드는 라운드 종료까지 리스폰 없음)
      if (room.mode !== 'defuse') {
        setTimeout(() => {
          if (!rooms.get(room.id)) return;
          targetEntry.hp = 100; targetEntry.alive = true;
          io.to('room_' + room.id).emit('player:respawned', { nickname: targetEntry.nickname });
          io.to('room_' + room.id).emit('room:players', roomPlayers(room.id));
        }, 3000);
      }
    } else {
      io.to('room_' + room.id).emit('player:damaged', { target: targetEntry.nickname, hp: targetEntry.hp, attacker: shooter.nickname });
    }
  }

  // 피격 판정 (슈터가 raycast 후 전송 → 서버가 HP 차감 후 브로드캐스트)
  socket.on('player:hit', (d) => {
    const { target, damage, weapon } = d || {};
    if (!target || !damage) return;
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.roomId) return;
    const room = rooms.get(shooter.roomId);
    if (!room) return;
    const targetEntry = [...players.values()].find(pl => pl.roomId === shooter.roomId && pl.nickname === target && pl.alive);
    if (!targetEntry) return;
    if (targetEntry.team === shooter.team) return; // 아군 오사 방지
    strike(room, shooter, targetEntry, damage, weapon);
  });

  // 수류탄 투척 중계 (타인 화면 투사체 표시용)
  socket.on('player:throw', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive || !d || !d.from || !d.vel) return;
    socket.to('room_' + p.roomId).emit('player:nade', { nickname: p.nickname, from: d.from, vel: d.vel });
  });

  // 수류탄 폭발 범위 피해 (반경 9m, 거리 감쇠)
  socket.on('player:blast', (d) => {
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.roomId || !d || !d.pos) return;
    const room = rooms.get(shooter.roomId);
    if (!room) return;
    for (const pl of players.values()) {
      if (pl.roomId !== shooter.roomId || !pl.alive) continue;
      if (pl.nickname === shooter.nickname || pl.team === shooter.team) continue;
      const dx = pl.pos.x - d.pos.x, dy = (pl.pos.y || 1.7) - d.pos.y, dz = pl.pos.z - d.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 9) strike(room, shooter, pl, Math.max(12, Math.round(105 * (1 - dist / 10))), '수류탄💣');
    }
  });

  socket.on('flag:capture', (d) => {
    const flag = d && d.flag;
    if (!flag) return;
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room || room.mode !== 'conquest') return;
    room.state.flags[flag] = p.team;
    io.to('room_' + room.id).emit('game:tick', { state: room.state });
    io.to('room_' + room.id).emit('chat:msg', { sys: true, text: `◈ ${p.nickname}이(가) 거점 ${flag} 점령!` });
  });

  socket.on('objective:damage', (d) => {
    const amount = d && d.amount;
    if (!amount) return;
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room || room.mode !== 'operation') return;
    room.state.objectiveHp = Math.max(0, room.state.objectiveHp - amount);
    io.to('room_' + room.id).emit('game:tick', { state: room.state });
    if (room.state.objectiveHp <= 0 && !room.state.targetDestroyed) {
      room.state.targetDestroyed = true;
      endMatch(room, 'alpha', room.ranked ? '[경쟁] 목표물 파괴 성공!' : '목표물 파괴 성공!');
    }
  });

  socket.on('bomb:plant', (d) => {
    const site = d && d.site;
    if (!site) return;
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room || room.mode !== 'defuse' || p.team !== 'T') return;
    if (room.state.bomb.planted) return;
    room.state.bomb = { planted: true, site, timeLeft: 40, exploded: false };
    room.state.phase = 'planted';
    io.to('room_' + room.id).emit('bomb:planted', { by: p.nickname, site, state: room.state });
  });

  socket.on('bomb:defuse', () => {
    const p = players.get(socket.id);
    if (!p || !p.roomId) return;
    const room = rooms.get(p.roomId);
    if (!room || room.mode !== 'defuse' || p.team !== 'CT') return;
    if (!room.state.bomb.planted || room.state.bomb.exploded) return;
    room.state.bomb.planted = false;
    room.state.score.CT++;
    io.to('room_' + room.id).emit('bomb:defused', { by: p.nickname, state: room.state });
    setTimeout(() => nextRound(room), 3000);
  });

  // 사격 릴레이: 다른 클라에서 총구 섬광/자세 재생용 (스팸 방지: 클라에서 스로틀)
  socket.on('player:shoot', () => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive) return;
    socket.to('room_' + p.roomId).emit('player:shot', { nickname: p.nickname });
  });

  socket.on('chat:msg', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !d) return;
    let text = String(d.text || '').slice(0, 120);
    if (!text) return;
    io.to('room_' + p.roomId).emit('chat:msg', { nickname: p.nickname, team: p.team, text });
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
    players.delete(socket.id);
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, () => console.log(`FPS 서버 실행: http://localhost:${PORT}`));
