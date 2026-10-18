import { FPSGame } from './game.js';

const socket = io();
let token = localStorage.getItem('fps_token') || null;
let myNick = localStorage.getItem('fps_nick') || '';
let currentRoom = null;
let myTeam = null;
let game = null;
let authed = false;
let pendingJoin = null;

const $ = (id) => document.getElementById(id);

// 소켓 연결될 때마다 인증 (재접속 대응)
socket.on('connect', () => {
  if (token) socket.emit('auth', { token });
});
socket.on('auth:ok', (d) => {
  authed = true;
  if (d && d.nickname) { myNick = d.nickname; localStorage.setItem('fps_nick', myNick); $('my-nick').textContent = '👤 ' + myNick; }
  if (pendingJoin) { const r = pendingJoin; pendingJoin = null; doJoin(r); }
});

// ---------- 탭 ----------
$('tab-login').onclick = () => { $('tab-login').classList.add('active'); $('tab-register').classList.remove('active'); $('login-form').classList.remove('hidden'); $('register-form').classList.add('hidden'); };
$('tab-register').onclick = () => { $('tab-register').classList.add('active'); $('tab-login').classList.remove('active'); $('register-form').classList.remove('hidden'); $('login-form').classList.add('hidden'); };

function msg(t) { $('auth-msg').textContent = t; }

// ---------- 인증 ----------
$('btn-register').onclick = async () => {
  const username = $('reg-id').value.trim(), nickname = $('reg-nick').value.trim(), password = $('reg-pw').value;
  const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, nickname, password }) });
  const j = await r.json();
  msg(j.error || j.message || '완료');
  if (j.ok) { $('tab-login').click(); $('login-id').value = username; }
};
$('btn-login').onclick = async () => {
  const username = $('login-id').value.trim(), password = $('login-pw').value;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json();
  if (!j.ok) return msg(j.error);
  token = j.token; myNick = j.nickname;
  localStorage.setItem('fps_token', token); localStorage.setItem('fps_nick', myNick);
  enterLobby();
  if (j.seasonNotice) setTimeout(() => alert(j.seasonNotice), 400);
};
$('btn-logout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  token = null; localStorage.removeItem('fps_token'); localStorage.removeItem('fps_nick');
  location.reload();
};
$('btn-nick').onclick = async () => {
  const nn = $('new-nick').value.trim();
  if (nn.length < 2) return alert('닉네임은 2~12자로 입력하세요.');
  const r = await fetch('/api/nickname', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ nickname: nn }) });
  const j = await r.json();
  if (!j.ok) return alert(j.error || '변경 실패');
  myNick = j.nickname;
  localStorage.setItem('fps_nick', myNick);
  $('my-nick').textContent = '👤 ' + myNick;
  $('new-nick').value = '';
  socket.emit('auth', { token }); // 소켓 표시명도 즉시 갱신
  loadRooms(); loadRankings();
  alert(j.message);
};

async function enterLobby() {
  $('auth-screen').classList.add('hidden');
  $('lobby-screen').classList.remove('hidden');
  $('game-screen').classList.add('hidden');
  $('my-nick').textContent = '👤 ' + myNick;
  authed = false;
  if (socket.connected) socket.emit('auth', { token });
  else socket.once('connect', () => socket.emit('auth', { token }));
  loadModes(); loadRooms(); loadMe(); loadRankings();
}

async function loadMe() {
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    if (j.ok) $('my-rating').textContent = `🏆 ${j.user.rating} ${j.user.tier}`;
  } catch (e) {}
  try {
    const r = await fetch('/api/season');
    const j = await r.json();
    if (j.ok) $('season-tag').textContent = `📅 ${j.season} 시즌 (D-${j.daysLeft})`;
  } catch (e) {}
}

async function loadRankings() {
  try {
    const r = await fetch('/api/rankings'); const j = await r.json();
    const rows = (j.rankings || []).map((u, i) =>
      `<tr class="${u.nickname === myNick ? 'me' : ''}"><td>${i + 1}</td><td>${escapeHtml(u.nickname)}</td><td>${u.tier}</td><td>${u.rating}</td><td>${u.wins}승 ${u.losses}패</td><td>K/D ${u.kd}</td></tr>`).join('');
    $('rank-list').innerHTML = `<table><tr><th>#</th><th>닉네임</th><th>티어</th><th>점수</th><th>전적</th><th>K/D</th></tr>${rows || '<tr><td colspan=6>아직 전적 없음</td></tr>'}</table>`;
  } catch (e) { $('rank-list').innerHTML = '랭킹 로드 실패'; }
}

async function loadModes() {
  const r = await fetch('/api/modes'); const j = await r.json();
  const icons = { conquest: '⚔️', operation: '🚁', defuse: '💣' };
  $('mode-cards').innerHTML = Object.entries(j.modes).map(([k, v]) =>
    `<div class="mode-card"><h3>${icons[k] || ''} ${v.name}</h3><p>${v.desc}</p><p>기본맵: ${v.defaultMap} · 최대 ${v.maxPlayers}명</p></div>`).join('');
}
async function loadRooms() {
  const r = await fetch('/api/rooms'); const j = await r.json();
  renderRooms(j.rooms || []);
}
function renderRooms(rooms) {
  const modeName = { conquest: '정복전', operation: '작전', defuse: '폭파전', tdm: '팀데매', ffa: '개인전', gungame: '건게임' };
  if (!rooms.length) { $('room-list').innerHTML = '<p style="color:#7d8ea0">개설된 방이 없습니다. 첫 방을 만들어보세요!</p>'; return; }
  $('room-list').innerHTML = rooms.map(rm =>
    `<div class="room${rm.ranked ? ' ranked' : ''}"><div class="info"><b>${escapeHtml(rm.name)}</b> ${rm.ranked ? '<span class="ranked-badge">🏆경쟁</span>' : ''} <span class="mode">[${modeName[rm.mode] || rm.mode} · ${escapeHtml(rm.map)}]</span><br><span class="mode">방장 ${escapeHtml(rm.host)} · ${rm.playerCount}/${rm.maxPlayers}명</span></div><button data-join="${rm.id}">입장</button></div>`).join('');
  document.querySelectorAll('[data-join]').forEach(b => b.onclick = () => joinRoom(b.dataset.join));
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

$('btn-refresh').onclick = () => { loadRooms(); loadRankings(); loadMe(); };
$('btn-rank-refresh').onclick = () => loadRankings();
$('btn-create').onclick = () => $('create-panel').classList.toggle('hidden');
$('btn-quick').onclick = async () => {
  const r = await fetch('/api/competitive/quick', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ mode: 'defuse' }) });
  const j = await r.json();
  if (!j.ok) return alert(j.error || '매칭 실패');
  joinRoom(j.room.id);
};
$('btn-do-create').onclick = async () => {
  const name = $('room-name').value.trim() || `${myNick}의 방`;
  const mode = $('room-mode').value, maxPlayers = parseInt($('room-max').value);
  const ranked = $('room-ranked').checked;
  const mapByMode = { conquest: 'desert_storm', operation: 'delta_valley', defuse: 'cs_dust', tdm: 'desert_storm', ffa: 'cs_dust', gungame: 'cs_dust' };
  const map = mapByMode[mode] || 'cs_dust';
  const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name, mode, map, maxPlayers, ranked }) });
  const j = await r.json();
  if (!j.ok) return alert(j.error);
  joinRoom(j.room.id);
};

function joinRoom(roomId) {
  if (!roomId) return alert('방 ID 오류');
  if (!authed) {
    // 인증 전이면 인증 후 자동 입장
    pendingJoin = roomId;
    socket.emit('auth', { token });
    setTimeout(() => { if (pendingJoin) { const r = pendingJoin; pendingJoin = null; doJoin(r); } }, 1200);
    return;
  }
  doJoin(roomId);
}
function doJoin(roomId) {
  socket.emit('room:join', { roomId });
}

// ---------- 소켓 ----------
socket.on('lobby:update', (d) => { if (!$('lobby-screen').classList.contains('hidden')) renderRooms(d.rooms); });
socket.on('error:msg', (t) => alert(t));
socket.on('auth:fail', () => { localStorage.removeItem('fps_token'); location.reload(); });

socket.on('room:joined', (d) => {
  try {
    currentRoom = d.room; myTeam = d.team;
    $('lobby-screen').classList.add('hidden');
    $('auth-screen').classList.add('hidden');
    $('game-screen').classList.remove('hidden');
    if (game) { try { game.dispose(); } catch (e) {} }
    game = new FPSGame({ canvas: $('game-canvas'), socket, room: currentRoom, team: myTeam, nick: myNick, state: d.state });
    game.start();
  } catch (e) {
    console.error(e);
    alert('게임 시작 오류: ' + e.message + '\n(인터넷 연결 필요: Three.js CDN)');
  }
});

socket.on('room:closed', (d) => { alert(d.message); location.reload(); });

// 자동 로그인
if (token) enterLobby();
