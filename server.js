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
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

// 영속 저장소: 기본 파일, DATABASE_URL이 있으면 무료 Postgres(Supabase/Neon 등)로 자동 전환
// → Render 무료(디스크 휘발)에서도 계정·세션·방이 재시작 후 유지됨
const usePgEnv = !!process.env.DATABASE_URL;
let pgPool = null, pgOk = false;
let userCache = null, sessCacheObj = null, roomsCacheArr = null;
const storeDirty = { users: false, sessions: false, rooms: false };
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function writeJson(f, v) { try { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); } catch {} }
function pgGet() {
  if (!pgPool) {
    const { Pool } = require('pg');
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pgPool;
}
async function storeInit() {
  if (usePgEnv) {
    try {
      const pool = pgGet();
      await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB)');
      const { rows } = await pool.query('SELECT key, value FROM kv');
      const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
      userCache = Array.isArray(m.users) ? m.users : [];
      sessCacheObj = m.sessions || {};
      roomsCacheArr = Array.isArray(m.rooms) ? m.rooms : [];
      pgOk = true;
      console.log('영속 저장소: Postgres 사용');
    } catch (e) { console.error('PG 접속 실패, 파일 모드로 대체:', e.message); }
  }
  if (!pgOk) {
    userCache = readJson(USERS_FILE, []);
    sessCacheObj = readJson(SESS_FILE, {});
    roomsCacheArr = readJson(ROOMS_FILE, []);
    console.log('영속 저장소: 파일 사용');
  }
  let dirty = false;
  for (const u of userCache) if (ensureStats(u)) dirty = true;
  for (const [k, v] of Object.entries(sessCacheObj)) sessions.set(k, v);
  for (const r of roomsCacheArr) rooms.set(r.id, { ...r, order: [], emptySince: null });
  if (dirty) persistUsers();
}
async function storeFlush() {
  if (!pgOk) return;
  try {
    const pool = pgGet();
    const up = (k, v) => pool.query('INSERT INTO kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
    if (storeDirty.users) { storeDirty.users = false; try { await up('users', JSON.stringify(userCache)); } catch (e) { storeDirty.users = true; throw e; } }
    if (storeDirty.sessions) { storeDirty.sessions = false; try { await up('sessions', JSON.stringify(sessCacheObj)); } catch (e) { storeDirty.sessions = true; throw e; } }
    if (storeDirty.rooms) { storeDirty.rooms = false; try { await up('rooms', JSON.stringify(roomsCacheArr)); } catch (e) { storeDirty.rooms = true; throw e; } }
  } catch (e) { console.error('store flush 실패:', e.message); }
}
setInterval(storeFlush, 10000);
function persistUsers() {
  storeDirty.users = true;
  if (!pgOk) writeJson(USERS_FILE, userCache);
}
function persistSessions() {
  sessCacheObj = Object.fromEntries(sessions);
  storeDirty.sessions = true;
  if (!pgOk) writeJson(SESS_FILE, sessCacheObj);
}
let roomsDirty = false;
function persistRooms() {
  roomsCacheArr = [...rooms.values()].map(r => ({ ...r, order: [] }));
  storeDirty.rooms = true;
  roomsDirty = false;
  if (!pgOk) writeJson(ROOMS_FILE, roomsCacheArr);
}
function markRoomsDirty() { roomsDirty = true; storeDirty.rooms = true; }
setInterval(() => { if (roomsDirty) persistRooms(); }, 15000);

function loadUsers() { return userCache || []; }
function saveUsers(u) { userCache = u; persistUsers(); }
function loadSessions() {} // 부팅 시 storeInit이 처리
function saveSessions() { persistSessions(); }
function saveRooms() { persistRooms(); }
function loadRooms() {} // 부팅 시 storeInit이 처리

// 랭킹/경쟁전 스탯 보장 (구 계정 마이그레이션)
function ensureStats(u) {
  let touched = false;
  const defaults = { rating: 1000, wins: 0, losses: 0, kills: 0, deaths: 0, mvp: 0, matches: 0 };
  for (const [k, v] of Object.entries(defaults)) if (u[k] === undefined) { u[k] = v; touched = true; }
  return touched;
}
// ---------- 치트 탐지 (로그 + 통계 + 경고만. 자동 킥/밴드 없음) ----------
const CHEAT_FILE = path.join(DATA_DIR, 'cheats.json');
const CHEAT_LABELS = {
  teleport: '비현실적 이동 속도',
  hsRatio: '의심스러운 헤드샷 비율',
  killRate: '비현실적 킬 속도',
  multiKill: '연속 다중 킬',
  dmgSpike: '과도한 피해량',
  teamKill: '아군 타격 시도',
  badTarget: '무효 타겟 공격',
  deadTarget: '사망한 유저 공격',
  forgedDmg: '위조 데미지 패킷',
  blastFar: '불가능한 거리 폭발',
};
const cheatStats = new Map(); // key -> 통계
let cheatLogs = [];           // 최근 로그 (최대 300)
let cheatDirty = false;
setInterval(() => { if (cheatDirty && !pgOk) { writeJson(CHEAT_FILE, { logs: cheatLogs, stats: [...cheatStats.values()] }); cheatDirty = false; } }, 10000);

function cheatOf(p) {
  const key = p.userId || p.socketId;
  let s = cheatStats.get(key);
  if (!s) {
    s = { key, nickname: p.nickname, kills: 0, hs: 0, dmg: 0, flags: {}, recent: [], lastWarn: 0, total: 0 };
    cheatStats.set(key, s);
  }
  s.nickname = p.nickname;
  return s;
}
// 위반 기록 + 개인 경고 (자동 처벌 없음)
function flagCheat(p, type, detail) {
  const s = cheatOf(p);
  s.flags[type] = (s.flags[type] || 0) + 1;
  s.total++;
  const rec = { t: Date.now(), nickname: p.nickname, type, label: CHEAT_LABELS[type] || type, detail: String(detail || '').slice(0, 60), count: s.flags[type] };
  cheatLogs.unshift(rec);
  if (cheatLogs.length > 300) cheatLogs.length = 300;
  cheatDirty = true;
  console.log(`[치트경고] ${p.nickname} · ${rec.label} · ${rec.detail} (${rec.count}회)`);
  // 같은 타입 경고는 15초에 1회만 (스팸 방지)
  const now = Date.now();
  if (now - s.lastWarn > 15000) {
    s.lastWarn = now;
    const sk = players.get(p.socketId);
    if (sk) sk.socketId && io.to(sk.socketId).emit('chat:msg', { sys: true, text: `⚠ 감지됨: ${rec.label} (${rec.detail}) — 이 기록은 관리자에게 전송됩니다.` });
  }
  return rec;
}
// 킬/헤드샷 통계 갱신 후 이상 징후 판정
function checkKillStats(p, headshot) {
  const s = cheatOf(p);
  const now = Date.now();
  s.recent.push(now);
  while (s.recent.length && now - s.recent[0] > 60000) s.recent.shift();
  if (s.recent.length >= 12) flagCheat(p, 'killRate', `60초 내 ${s.recent.length}킬`);
  if (s.recent.length >= 3) {
    const win = now - s.recent[s.recent.length - 3];
    if (win < 1500) flagCheat(p, 'multiKill', `1.5초 내 3킬`);
  }
  if (s.kills >= 20 && s.hs / s.kills > 0.65) flagCheat(p, 'hsRatio', `헤드샷 ${Math.round(s.hs / s.kills * 100)}%`);
}
// OP총: 지정 닉네임만 / 미친말총: 지정 닉네임 + 가입 시 ID / 관리자 갑옷: 지정 ID
// ---------- 전용 무기 권한 ----------
// OP총: 지정 닉네임만 / 미친말총: 지정 닉네임+ID / 관리자갑옷: 지정 ID
const PRIVY_NICKS = new Set(['맘마버거', '양웅빈']);
const MAD_NICKS = new Set(['spider men']);
const MAD_USERS = new Set(['Tlqkfsusemfdk69']);
const ADMIN_USERS = new Set(['Tlqkfsusemfdk69']);
const OP_WEAPON_INDEX = 10;
const MAD_WEAPON_INDEX = 11;
const ARMOR_WEAPON_INDEX = 12;
function isPrivy(nickname) { return PRIVY_NICKS.has(String(nickname || '').trim()); }
function isAdmin(username) { return ADMIN_USERS.has(String(username || '').trim()); }
// 무적 갑옷 장착 인덱스 (관리자 갑옷 + OP총) — 장착 중 외부 피해 무효
function isInvincibleWi(wi) { return wi === ARMOR_WEAPON_INDEX || wi === OP_WEAPON_INDEX; }
function isMad(nickname, username) {
  return MAD_NICKS.has(String(nickname || '').trim().toLowerCase()) || MAD_USERS.has(String(username || '').trim());
}
// 무기 슬롯 권한 클램프 (권한 없는 전용 무기 요청은 직전 일반 무기로 대체)
function clampWi(wi, p) {
  let w = Math.max(0, Math.min(ARMOR_WEAPON_INDEX, parseInt(wi, 10) || 0));
  if (w === ARMOR_WEAPON_INDEX && !p.admin) w = MAD_WEAPON_INDEX;
  if (w === MAD_WEAPON_INDEX && !p.mad) w = OP_WEAPON_INDEX;
  if (w === OP_WEAPON_INDEX && !p.op) w = OP_WEAPON_INDEX - 1;
  return w;
}

function getTier(rating) {
  if (rating >= 2500) return '신';
  if (rating >= 2200) return '초월자';
  if (rating >= 2000) return '그랜드마스터';
  if (rating >= 1800) return '마스터';
  if (rating >= 1600) return '다이아';
  if (rating >= 1400) return '플래티넘';
  if (rating >= 1200) return '골드';
  if (rating >= 1000) return '실버';
  if (rating >= 800) return '쓰레기';
  if (rating >= 600) return '음식물쓰레기';
  return '인간말종쓰레기버러지';
}

// ---------- 시즌제 (현실 1달 = 1시즌, 종료 시 최대 2티어까지만 강등) ----------
const TIER_ORDER = ['인간말종쓰레기버러지', '음식물쓰레기', '쓰레기', '실버', '골드', '플래티넘', '다이아', '마스터', '그랜드마스터', '초월자', '신'];
const TIER_FLOORS = [0, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
function seasonId(d = new Date()) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function checkSeasonRollover(u) {
  const cur = seasonId();
  if (!u.season) { u.season = cur; return null; } // 첫 기록: 강등 없음
  if (u.season === cur) return null;
  const from = u.rating || 1000;
  const idx = Math.max(0, TIER_ORDER.indexOf(getTier(from)));
  const floor2 = TIER_FLOORS[Math.max(0, idx - 2)];
  const to = Math.max(floor2, from - 250, 0);
  const res = { from, to, fromTier: TIER_ORDER[idx], toTier: getTier(to), oldSeason: u.season, season: cur };
  u.rating = to;
  u.season = cur;
  return res;
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
  const user = { id: uuidv4(), username, nickname, passwordHash: hash, kills: 0, deaths: 0, wins: 0, losses: 0, matches: 0, mvp: 0, rating: 1000, season: seasonId(), createdAt: Date.now() };
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
  const roll = checkSeasonRollover(user);
  if (roll) saveUsers(users);
  // 같은 계정의 오래된 토큰 정리 (세션 누적 방지)
  for (const [tok, uid] of sessions) if (uid === user.id) sessions.delete(tok);
  const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
  sessions.set(token, user.id);
  saveSessions();
  const out = { ok: true, token, nickname: user.nickname, username: user.username };
  if (roll) out.seasonNotice = `📅 새 시즌(${roll.season})! ${roll.oldSeason} ${roll.fromTier}(${roll.from}) → ${roll.toTier}(${roll.to})`;
  return res.json(out);
});

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const users = loadUsers();
  const user = users.find(u => u.id === sessions.get(token));
  if (!user) return res.status(401).json({ error: '세션 만료' });
  if (checkSeasonRollover(user)) saveUsers(users);
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
  saveSessions();
  res.json({ ok: true });
});

// roomId 소속 플레이어 공개 목록 (소켓/HTTP 공용)
function roomPlayersById(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.order.map(sid => {
    const pl = players.get(sid);
    return pl ? { nickname: pl.nickname, team: pl.team, hp: pl.hp, alive: pl.alive, kills: pl.kills, deaths: pl.deaths, pos: pl.pos, yaw: pl.yaw, pitch: pl.pitch || 0, wi: pl.wi || 0, fy: pl.fy || 0, crouch: !!pl.crouch, sl: !!pl.sliding, eid: pl.eid || 0 } : null;
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
  // 전용 닉네임은 등록된 본인만 보유 가능 (타인이 탈취 불가)
  if (isPrivy(nn) && !isPrivy(me.nickname)) return res.status(403).json({ error: '전용 닉네임은 사용할 수 없습니다.' });
  if (MAD_NICKS.has(nn.toLowerCase()) && !isMad(me.nickname, me.username)) return res.status(403).json({ error: '전용 닉네임은 사용할 수 없습니다.' });
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
    pl.op = isPrivy(nn); // 닉네임 변경 시 전용 무기 권한 즉시 갱신
    pl.mad = isMad(nn, me.username);
    pl.admin = isAdmin(me.username);
    pl.wi = clampWi(pl.wi, pl); // 권한 박탈 시 총 회수
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
  conquest: { name: '정복전 (배틀필드식)', desc: 'A/B/C 거점 점령, 티켓 150', defaultMap: 'desert_storm', maxPlayers: 16 },
  operation: { name: '블랙호크 작전 (델타포스식)', desc: '광활한 밸리, 목표물 파괴 + 생존', defaultMap: 'delta_valley', maxPlayers: 12 },
  defuse: { name: '폭탄 해체전 (카스식)', desc: '5라운드, 폭탄 설치/해체, 경제 시스템', defaultMap: 'cs_dust', maxPlayers: 10 },
  tdm: { name: '팀 데스매치', desc: '50킬 선취, 리스폰 빠름', defaultMap: 'desert_storm', maxPlayers: 16 },
  ffa: { name: '개인 데스매치 (FFA)', desc: '20킬 또는 5분 최고킬 우승', defaultMap: 'cs_dust', maxPlayers: 12 },
  gungame: { name: '건게임', desc: '킬마다 무기 변경, 나이프킬 완주 우승', defaultMap: 'cs_dust', maxPlayers: 12 }
};

function publicRoom(r) {
  return { id: r.id, name: r.name, mode: r.mode, map: r.map, maxPlayers: r.maxPlayers, host: r.host, playerCount: r.order.length, status: r.status, createdAt: r.createdAt, ranked: !!r.ranked };
}

app.get('/api/modes', (req, res) => res.json({ ok: true, modes: MODES }));
app.get('/api/admin/cheats', authMiddleware, (req, res) => {
  if (!isAdmin(req.user.username)) return res.status(403).json({ error: '관리자 전용' });
  const stats = [...cheatStats.values()]
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((s) => ({ nickname: s.nickname, kills: s.kills, hs: s.hs, hsRate: s.kills ? Math.round(s.hs / s.kills * 100) : 0, total: s.total, flags: s.flags }));
  res.json({ ok: true, total: stats.reduce((a, b) => a + b.total, 0), stats, logs: cheatLogs.slice(0, 60), labels: CHEAT_LABELS });
});
app.get('/api/season', (req, res) => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysLeft = Math.ceil((end - now) / 86400000);
  res.json({ ok: true, season: seasonId(now), daysLeft, tiers: TIER_ORDER });
});
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
  roomsDirty = true; saveRooms();
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
  roomsDirty = true; saveRooms();
  broadcastLobby();
  res.json({ ok: true, room: publicRoom(room), quick: true, created: true });
});

app.delete('/api/rooms/:id', authMiddleware, (req, res) => {
  const r = rooms.get(req.params.id);
  if (!r) return res.status(404).json({ error: '방 없음' });
  if (r.hostId !== req.user.id) return res.status(403).json({ error: '방장만 삭제 가능' });
  io.to('room_' + r.id).emit('room:closed', { message: '방장이 방을 폭파했습니다.' });
  rooms.delete(req.params.id);
  roomsDirty = true; saveRooms();
  broadcastLobby();
  res.json({ ok: true });
});

function initRoomState(mode) {
  if (mode === 'conquest') return { tickets: { alpha: 150, bravo: 150 }, flags: { A: 'neutral', B: 'neutral', C: 'neutral' }, progress: { A: 0, B: 0, C: 0 } };
  if (mode === 'operation') return { objectiveHp: 1000, phase: 'combat', targetDestroyed: false };
  if (mode === 'tdm') return { score: {}, target: 50 };
  if (mode === 'ffa') return { scores: {}, target: 20, timeLeft: 300 };
  if (mode === 'gungame') return { target: 9 };
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
  if (changed) { roomsDirty = true; saveRooms(); broadcastLobby(); }
}, 60 * 1000);

function assignTeam(room) {
  if (room.mode === 'ffa') { room._ffaSeq = (room._ffaSeq || 0) + 1; return 'FFA' + room._ffaSeq; } // 개인전: 전원 적대 (고유번호)
  // defuse: CT/T, else alpha/bravo
  const counts = {};
  for (const sid of room.order) { const p = players.get(sid); if (p) counts[p.team] = (counts[p.team] || 0) + 1; }
  if (room.mode === 'defuse') return (counts['CT'] || 0) <= (counts['T'] || 0) ? 'CT' : 'T';
  return (counts['alpha'] || 0) <= (counts['bravo'] || 0) ? 'alpha' : 'bravo';
}

// 경쟁전 레이팅 정산 (승 +25, 패 -15, 무승부 +0, 최소 0)
// 킬/데스는 persistKill에서 즉시 반영되므로 여기선 승패/레이팅만 처리
// winnerNick이 있으면 개인전: 해당 유저만 +25, 나머지 -15
function settleMatch(room, winner, winnerNick = null) {
  const users = loadUsers();
  let dirty = false;
  const changes = [];
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (!pl) continue;
    const u = users.find(x => x.id === pl.userId);
    if (!u) continue;
    ensureStats(u);
    if (checkSeasonRollover(u)) dirty = true; // 월 경계 넘김 시 시즌 강등
    if (room.ranked && winner) {
      let won, delta;
      if (winnerNick) { won = pl.nickname === winnerNick; delta = won ? 25 : -15; }
      else if (winner === 'draw') { won = false; delta = 0; }
      else { won = pl.team === winner; delta = won ? 25 : -15; }
      u.rating = Math.max(0, (u.rating || 1000) + delta);
      if (winner === 'draw') { /* 무승부: 승패 없이 매치수만 */ }
      else if (won) u.wins = (u.wins || 0) + 1; else u.losses = (u.losses || 0) + 1;
      u.matches = (u.wins || 0) + (u.losses || 0);
      changes.push({ nickname: u.nickname, delta, rating: u.rating, tier: getTier(u.rating) });
      dirty = true;
    }
  }
  if (dirty) saveUsers(users);
  return changes;
}

// 매치 종료 공통 처리 (정산+브로드캐스트+상태리셋)
function endMatch(room, winner, reason, winnerNick = null) {
  const changes = settleMatch(room, winner, winnerNick);
  let mvp = null; // 세션 최다킬
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (pl && pl.kills > 0 && (!mvp || pl.kills > mvp.kills)) mvp = { nickname: pl.nickname, kills: pl.kills, team: pl.team };
  }
  io.to('room_' + room.id).emit('game:over', { winner, reason, state: room.state, ranked: !!room.ranked, ratingChanges: changes, mvp, winnerNick });
  room.state = initRoomState(room.mode);
  room._roundGen = (room._roundGen || 0) + 1; // 대기 중 라운드 타이머 무효화
  roomsDirty = true;
  // 새 매치: 세션 전적 초기화 (서버 권위)
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (pl) { pl.kills = 0; pl.deaths = 0; pl.money = 800; pl.hp = 100; pl.alive = true; }
  }
  io.to('room_' + room.id).emit('game:reset', { state: room.state });
  io.to('room_' + room.id).emit('room:players', roomPlayersById(room.id));
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
function validState(room) {
  const s = room.state;
  if (!s || typeof s !== 'object') return false;
  if (room.mode === 'conquest') return !!(s.flags && s.tickets && isFinite(s.tickets.alpha + s.tickets.bravo));
  if (room.mode === 'defuse') return !!(s.bomb && s.score);
  if (room.mode === 'ffa') return !!(s.scores && isFinite(s.timeLeft));
  return true;
}
setInterval(() => {
  for (const room of rooms.values()) {
    try {
      if (room.order.length === 0) continue;
      if (!validState(room)) { room.state = initRoomState(room.mode); continue; }
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
        scheduleNextRound(room);
      } else {
        io.to('room_' + room.id).emit('game:tick', { state: room.state });
      }
    }
    if (room.mode === 'ffa') { // 개인전 5분 타이머
      room.state.timeLeft -= 1;
      if (room.state.timeLeft <= 0) {
        const top = Object.entries(room.state.scores).sort((a, b) => b[1] - a[1])[0];
        if (!top) {
          room.state = initRoomState(room.mode);
          io.to('room_' + room.id).emit('game:reset', { state: room.state });
        } else {
          const who = [...players.values()].find(pl => pl.roomId === room.id && pl.userId === top[0]);
          const nick = who ? who.nickname : ((room.state.scoreNames || {})[top[0]] || '???');
          endMatch(room, who ? who.team : 'ffa', '시간 종료!', nick);
        }
      } else {
        io.to('room_' + room.id).emit('game:tick', { state: room.state });
      }
    }
    } catch (e) { console.error('room tick 오류:', room && room.id, e.message); }
  }
}, 1000);

function scheduleNextRound(room, ms = 3000) {
  room._roundGen = (room._roundGen || 0) + 1;
  const g = room._roundGen;
  setTimeout(() => {
    const rm = rooms.get(room.id);
    if (!rm || rm._roundGen !== g) return; // 무효화된 예약 무시
    nextRound(rm);
  }, ms);
}

function nextRound(room) {
  if (!rooms.get(room.id)) return;
  room._elimDone = false;
  if (room.state.round >= room.state.maxRounds) {
    const winner = room.state.score.CT === room.state.score.T ? 'draw' : (room.state.score.CT > room.state.score.T ? 'CT' : 'T');
    endMatch(room, winner, room.ranked ? '[경쟁] 전 라운드 종료' : '전 라운드 종료');
  } else {
    room.state.round++;
    room.state.bomb = { planted: false, site: null, timeLeft: 0, exploded: false };
    room.state.phase = 'buy';
    room.state.roundTimer = 100;
  }
  // 다음 라운드 전원 부활 (서버/클라 동기화)
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (pl) { pl.hp = 100; pl.alive = true; }
  }
  io.to('room_' + room.id).emit('room:players', roomPlayersById(room.id));
  io.to('room_' + room.id).emit('round:next', { state: room.state });
  roomsDirty = true;
}

// 폭파전 전멸 승패 (한 팀 전멸 시 생존팀 득점 → 3초 후 다음 라운드)
function checkDefuseElimination(room) {
  if (!room || room.mode !== 'defuse' || room._elimDone) return;
  const alive = { CT: 0, T: 0 };
  for (const sid of room.order) {
    const pl = players.get(sid);
    if (pl && pl.alive) alive[pl.team] = (alive[pl.team] || 0) + 1;
  }
  if (alive.CT + alive.T === 0) {
    room._elimDone = true;
    io.to('room_' + room.id).emit('chat:msg', { sys: true, text: '💀 양 팀 전멸! 무승부, 다음 라운드' });
    io.to('room_' + room.id).emit('round:end', { winner: 'draw', reason: '양 팀 전멸', state: room.state });
    scheduleNextRound(room);
  } else if (alive.CT === 0 || alive.T === 0) {
    room._elimDone = true;
    const winner = alive.CT === 0 ? 'T' : 'CT';
    room.state.score[winner]++;
    io.to('room_' + room.id).emit('chat:msg', { sys: true, text: `💀 ${winner} 팀 적 전멸 승리! (${room.state.score.CT}:${room.state.score.T})` });
    io.to('room_' + room.id).emit('round:end', { winner, reason: '적 전멸', state: room.state });
    scheduleNextRound(room);
  }
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
    if (checkSeasonRollover(user)) saveUsers(users);
    players.set(socket.id, { socketId: socket.id, userId: user.id, nickname: user.nickname, op: isPrivy(user.nickname), mad: isMad(user.nickname, user.username), admin: isAdmin(user.username), roomId: null, team: null, hp: 100, alive: true, kills: 0, deaths: 0, money: 800, pos: { x: 0, y: 1.7, z: 0 }, yaw: 0 });
    socket.emit('auth:ok', { nickname: user.nickname, op: isPrivy(user.nickname), mad: isMad(user.nickname, user.username), admin: isAdmin(user.username) });
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
      return socket.emit('room:joined', { room: publicRoom(room), team: p.team, state: room.state, you: p.nickname, op: !!p.op, mad: !!p.mad, admin: !!p.admin });
    }
    if (room.order.length >= room.maxPlayers) return socket.emit('error:msg', '방이 가득 찼습니다.');
    // 기존 방 떠나기
    if (p.roomId) leaveRoom(socket);
    p.roomId = roomId;
    p.team = assignTeam(room);
    p.hp = 100; p.alive = true;
    room.order.push(socket.id);
    socket.join('room_' + roomId);
    socket.emit('room:joined', { room: publicRoom(room), team: p.team, state: room.state, you: p.nickname, op: !!p.op, mad: !!p.mad, admin: !!p.admin });
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
      // 방장 승계 (방장 나가면 첫 번째 멤버에게)
      if (room.hostId && pl.userId && room.hostId === pl.userId && room.order.length) {
        const np = players.get(room.order[0]);
        if (np) { room.host = np.nickname; room.hostId = np.userId; markRoomsDirty(); }
      }
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
      return pl ? { nickname: pl.nickname, team: pl.team, hp: pl.hp, alive: pl.alive, kills: pl.kills, deaths: pl.deaths, pos: pl.pos, yaw: pl.yaw, pitch: pl.pitch || 0, wi: pl.wi || 0, fy: pl.fy || 0, crouch: !!pl.crouch, sl: !!pl.sliding, eid: pl.eid || 0 } : null;
    }).filter(Boolean);
  }

  // 위치 동기화 (20Hz로 클라이언트가 전송)
  const lastStateAt = new Map(); // 소켓별 스로틀
  socket.on('player:state', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !d || !d.pos) return;
    if (!isFinite(d.pos.x + d.pos.y + d.pos.z)) return;
    const now = Date.now();
    if (lastStateAt.get(socket.id) && now - lastStateAt.get(socket.id) < 25) return;
    lastStateAt.set(socket.id, now);
    const cx = (v) => Math.max(-160, Math.min(160, v));
    // 순간이동/스피드핵 탐지 (실제 물리 한계 대비 여유 2배)
    if (p._st && p._st.pos) {
      const dt = (now - p._st.t) / 1000;
      if (dt > 0.02 && dt < 2) {
        const dist = Math.hypot(d.pos.x - p._st.pos.x, d.pos.z - p._st.pos.z);
        const v = dist / dt;
        if (v > 26) flagCheat(p, 'teleport', `${v.toFixed(1)} m/s`);
      }
    }
    p._st = { t: now, pos: { x: d.pos.x, z: d.pos.z } };
    p.pos = { x: cx(d.pos.x), y: cx(d.pos.y), z: cx(d.pos.z) };
    p.yaw = d.yaw; p.pitch = d.pitch || 0;
    // 무기 인덱스 클램프: 전용 무기(OP총/미친말총)는 권한자만 보유 가능
    p.wi = clampWi(d.wi, p);
    p.fy = d.fy || 0; p.crouch = !!d.crouch;
    p.sliding = !!d.sl; p.eid = Math.max(0, Math.min(999999, parseInt(d.eid, 10) || 0)); // 슬라이드/이모트(신호 순번)
    if (!p.alive) return; // 사망자는 중계 안 함
    socket.to('room_' + p.roomId).emit('player:move', { nickname: p.nickname, team: p.team, pos: p.pos, yaw: d.yaw, hp: p.hp, alive: p.alive, pitch: p.pitch, wi: p.wi, fy: p.fy, crouch: p.crouch, sl: p.sliding, eid: p.eid });
  });

  // 피해 적용 공용 (총탄·수류탄): HP 차감→사망/데미지 브로드캐스트→리스폰
  // ignoreCap=true 는 서버 권한 전용 무기(OP총) 처형에만 사용
  function strike(room, shooter, targetEntry, damage, weapon, stun = false, ignoreCap = false) {
    if (!room || !rooms.get(room.id)) return;
    if (!shooter || !shooter.alive) return;
    if (!targetEntry || !targetEntry.alive) return;
    damage = Number(damage);
    if (!isFinite(damage) || damage < 1) { flagCheat(shooter, 'forgedDmg', String(damage).slice(0, 20)); return; } // 음수/NaN 데미지 거부
    damage = Math.min(ignoreCap ? 100000 : 160, Math.round(damage));
    const suicide = shooter === targetEntry;
    // 킬/피해 통계 + 이상 징후 탐지 (경고만)
    if (!suicide) {
      const cs = cheatOf(shooter); cs.dmg += damage;
      if (damage >= 900) flagCheat(shooter, 'dmgSpike', `단일 피해 ${damage}`);
    }
    // 무적갑옷 장착(관리자 갑옷 / OP총) 중에는 외부 피해 전부 무효 (자폭·자해는 유효)
    if (!suicide && targetEntry.admin && isInvincibleWi(targetEntry.wi)) {
      targetEntry.hp = Math.max(targetEntry.hp, 1);
      io.to('room_' + room.id).emit('player:blocked', { target: targetEntry.nickname, attacker: shooter.nickname });
      io.to('room_' + room.id).emit('player:damaged', { target: targetEntry.nickname, hp: targetEntry.hp, attacker: shooter.nickname, stun: false, blocked: true });
      return;
    }
    if (!suicide && targetEntry.op && isInvincibleWi(targetEntry.wi)) {
      targetEntry.hp = Math.max(targetEntry.hp, 1);
      io.to('room_' + room.id).emit('player:blocked', { target: targetEntry.nickname, attacker: shooter.nickname });
      io.to('room_' + room.id).emit('player:damaged', { target: targetEntry.nickname, hp: targetEntry.hp, attacker: shooter.nickname, stun: false, blocked: true });
      return;
    }
    targetEntry.hp -= damage;
    if (targetEntry.hp <= 0) {
      targetEntry.hp = 0; targetEntry.alive = false;
      targetEntry.deaths++;
      if (!suicide) { shooter.kills++; shooter.money = (shooter.money || 800) + 300; }
      if (!suicide) {
        const ks = cheatOf(shooter); ks.kills++;
        if (String(weapon || '').includes('헤드샷')) ks.hs++;
        checkKillStats(shooter, String(weapon || '').includes('헤드샷'));
      }
      persistKill(shooter.userId, targetEntry.userId); // 랭킹 영구 반영
      io.to('room_' + room.id).emit('player:killed', {
        killer: shooter.nickname, victim: targetEntry.nickname, weapon,
        killerTeam: shooter.team, victimTeam: targetEntry.team
      });
      io.to('room_' + room.id).emit('room:players', roomPlayers(room.id));
      // 2초 후 리스폰 (defuse 모드는 라운드 종료까지 리스폰 없음)
      if (room.mode !== 'defuse') {
        setTimeout(() => {
          const rm = rooms.get(room.id);
          if (!rm) return;
          if (targetEntry.roomId !== room.id || !rm.order.includes(targetEntry.socketId)) return;
          targetEntry.hp = 100; targetEntry.alive = true;
          io.to('room_' + room.id).emit('player:respawned', { nickname: targetEntry.nickname });
          io.to('room_' + room.id).emit('room:players', roomPlayers(room.id));
        }, 2000);
      }
    } else {
      io.to('room_' + room.id).emit('player:damaged', { target: targetEntry.nickname, hp: targetEntry.hp, attacker: shooter.nickname, stun });
    }
    checkDefuseElimination(room);
    // 팀 데스매치: 50킬 선취
    if (room.mode === 'tdm' && shooter.team) {
      const s = room.state.score;
      s[shooter.team] = (s[shooter.team] || 0) + 1;
      if (s[shooter.team] >= room.state.target) endMatch(room, shooter.team, '팀 데스매치 목표 달성!');
      else io.to('room_' + room.id).emit('game:tick', { state: room.state });
    }
    // 개인전: 20킬 선취 (실제 플레이어만 집계, userId 키)
    if (room.mode === 'ffa' && shooter.userId) {
      const sc = room.state.scores;
      sc[shooter.userId] = (sc[shooter.userId] || 0) + 1;
      room.state.scoreNames = room.state.scoreNames || {};
      room.state.scoreNames[shooter.userId] = shooter.nickname;
      if (sc[shooter.userId] >= room.state.target) endMatch(room, shooter.team, '개인전 목표 달성!', shooter.nickname);
      else io.to('room_' + room.id).emit('game:tick', { state: room.state });
    }
    // 건게임: 9레벨(나이프킬) 완주
    if (room.mode === 'gungame' && shooter.kills >= 9) {
      endMatch(room, shooter.team, '건게임 완주!', shooter.nickname);
    }
  }

  // 피격 판정 (슈터가 raycast 후 전송 → 서버가 HP 차감 후 브로드캐스트)
  socket.on('player:hit', (d) => {
    const { target, damage, weapon, stun } = d || {};
    if (!target || !damage) return;
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.roomId) return;
    const room = rooms.get(shooter.roomId);
    if (!room) return;
    const targetEntry = [...players.values()].find(pl => pl.roomId === shooter.roomId && pl.nickname === target && pl.alive);
    if (!targetEntry) {
      // 방에 없거나 이미 죽은 대상 공격 시도 → 위조패킷 suspected
      const dead = [...players.values()].find(pl => pl.roomId === shooter.roomId && pl.nickname === target);
      flagCheat(shooter, dead ? 'deadTarget' : 'badTarget', String(target).slice(0, 16));
      return;
    }
    if (targetEntry.team === shooter.team) { flagCheat(shooter, 'teamKill', String(target).slice(0, 16)); return; } // 아군 오사 방지
    // OP총: 전용 유저만 사용 가능 + 데미지는 서버가 강제 (클라 조작 무효)
    const wName = String(weapon || '');
    if (d.op === true || wName.startsWith('OP총')) {
      if (!shooter.op || !isPrivy(shooter.nickname)) return;
      strike(room, shooter, targetEntry, 999, 'OP총', false, true);
      return;
    }
    // 미친말총: 전용 유저만 + 데미지 서버 강제
    if (d.mad === true || wName.startsWith('미친말총')) {
      if (!shooter.mad) return;
      strike(room, shooter, targetEntry, 999, '미친말총🐴', false, true);
      return;
    }
    // 관리자 갑옷: 전용 유저만 + 데미지 서버 강제
    if (d.armor === true || wName.startsWith('무적개뇌')) {
      if (!shooter.admin) return;
      strike(room, shooter, targetEntry, 999, '무적개뇌절개초딩개잼민이갑옷', false, true);
      return;
    }
    strike(room, shooter, targetEntry, damage, weapon, !!stun);
  });

  // 미친말총 일괄 저격 (적 팀 전원 즉사 — 전용 유저 전용, 스로틀 400ms)
  const madBlastAt = new Map();
  socket.on('mad:blast', () => {
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.roomId || !shooter.alive || !shooter.mad) return;
    const now = Date.now();
    if (madBlastAt.get(socket.id) && now - madBlastAt.get(socket.id) < 400) return;
    madBlastAt.set(socket.id, now);
    const room = rooms.get(shooter.roomId);
    if (!room) return;
    for (const pl of players.values()) {
      if (pl.roomId !== shooter.roomId || !pl.alive) continue;
      if (pl.nickname === shooter.nickname || pl.team === shooter.team) continue;
      strike(room, shooter, pl, 999, '미친말총🐴', false, true);
    }
  });

  // 봇 공격 판정 (클라 봇이 원격 플레이어를 맞췄을 때, 킬러=BOT 이름)
  const botHitAt = new Map(); // 소켓별 봇타격 스로틀 (위조 킬파밍 방지)
  socket.on('bot:hit', (d) => {
    const { bot, target, damage, team } = d || {};
    const dmg = Number(damage);
    if (!bot || !target || !isFinite(dmg)) return;
    const reporter = players.get(socket.id);
    if (!reporter || !reporter.roomId || !reporter.alive) return;
    const now = Date.now();
    if (botHitAt.get(socket.id) && now - botHitAt.get(socket.id) < 500) return;
    botHitAt.set(socket.id, now);
    const room = rooms.get(reporter.roomId);
    if (!room) return;
    const targetEntry = [...players.values()].find(pl => pl.roomId === reporter.roomId && pl.nickname === target && pl.alive);
    if (!targetEntry || targetEntry.socketId === socket.id) return;
    strike(room, { nickname: String(bot).slice(0, 16), team: team || null, kills: 0, deaths: 0, money: 800, userId: null, alive: true }, targetEntry, Math.max(1, Math.min(60, Math.round(dmg))), 'BOT');
  });
  socket.on('player:throw', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive || !d || !d.from || !d.vel) return;
    socket.to('room_' + p.roomId).emit('player:nade', { nickname: p.nickname, from: d.from, vel: d.vel });
  });

  // 수류탄/RPG 폭발 범위 피해 (반경·위력 상한, 슈터 근방만 유효)
  socket.on('player:blast', (d) => {
    const shooter = players.get(socket.id);
    if (!shooter || !shooter.roomId || !shooter.alive || !d || !d.pos) return;
    if (!shooter.pos || !isFinite(shooter.pos.x + shooter.pos.y + shooter.pos.z)) return;
    if (!isFinite(d.pos.x + d.pos.y + d.pos.z)) return;
    const sdx = shooter.pos.x - d.pos.x, sdy = shooter.pos.y - d.pos.y, sdz = shooter.pos.z - d.pos.z;
    if (sdx * sdx + sdy * sdy + sdz * sdz > 40 * 40) { flagCheat(shooter, 'blastFar', `${Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz).toFixed(0)}m`); return; } // 슈터 40m 밖 폭발 무효
    const room = rooms.get(shooter.roomId);
    if (!room) return;
    const radius = Math.min(Math.max(Number(d.radius) || 9, 1), 14);
    const power = Math.min(Math.max(Number(d.power) || 105, 1), 160);
    for (const pl of players.values()) {
      if (pl.roomId !== shooter.roomId || !pl.alive) continue;
      if (pl.nickname === shooter.nickname || pl.team === shooter.team) continue;
      const dx = pl.pos.x - d.pos.x, dy = (pl.pos.y || 1.7) - d.pos.y, dz = pl.pos.z - d.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < radius) strike(room, shooter, pl, Math.max(12, Math.round(power * (1 - dist / (radius + 1)))), power > 120 ? 'RPG🚀' : '수류탄💣');
    }
  });

  // 자폭/자해 (수류탄·RPG 자폭 데미지 서버 판정 — 팀체크 우회, 본인만)
  socket.on('player:selfhit', (d) => {
    const dmg = d && Number(d.damage);
    if (!isFinite(dmg)) return;
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive) return;
    const room = rooms.get(p.roomId);
    if (!room) return;
    strike(room, p, p, Math.max(1, Math.min(160, Math.round(dmg))), (d && d.weapon) || '자폭');
  });
  socket.on('player:rocket', (d) => {
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive || !d || !d.from || !d.vel) return;
    socket.to('room_' + p.roomId).emit('player:rocketfly', { nickname: p.nickname, from: d.from, vel: d.vel });
  });

  socket.on('flag:capture', (d) => {
    const flag = d && d.flag;
    if (flag !== 'A' && flag !== 'B' && flag !== 'C') return;
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive) return;
    const room = rooms.get(p.roomId);
    if (!room || room.mode !== 'conquest') return;
    room.state.flags[flag] = p.team;
    io.to('room_' + room.id).emit('game:tick', { state: room.state });
    io.to('room_' + room.id).emit('chat:msg', { sys: true, text: `◈ ${p.nickname}이(가) 거점 ${flag} 점령!` });
  });

  socket.on('objective:damage', (d) => {
    let amount = d && Number(d.amount);
    if (!isFinite(amount)) return;
    amount = Math.max(1, Math.min(50, Math.round(amount)));
    const p = players.get(socket.id);
    if (!p || !p.roomId || !p.alive) return;
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
    scheduleNextRound(room);
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
    botHitAt.delete(socket.id);
    lastStateAt.delete(socket.id);
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

storeInit().then(() => {
  server.listen(PORT, () => console.log(`FPS 서버 실행: http://localhost:${PORT}`));
}).catch((e) => {
  console.error('store 초기화 실패, 빈 상태로 시작:', e.message);
  server.listen(PORT, () => console.log(`FPS 서버 실행: http://localhost:${PORT}`));
});
