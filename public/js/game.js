import * as THREE from 'three';

// 무기 정의 (배틀필드/카스/델타포스 기반, 상점 무료)
const WEAPONS = [
  { id: 'M4A1', dmg: 25, rpm: 600, mag: 30, reserve: 700, auto: true, spread: 0.015 },
  { id: 'AK47', dmg: 32, rpm: 540, mag: 30, reserve: 700, auto: true, spread: 0.02 },
  { id: 'MP5', dmg: 20, rpm: 800, mag: 32, reserve: 700, auto: true, spread: 0.02 },
  { id: 'M870', dmg: 12, pellets: 8, rpm: 70, mag: 6, reserve: 700, auto: false, spread: 0.03 },
  { id: 'AWP', dmg: 95, rpm: 42, mag: 5, reserve: 700, auto: false, spread: 0.001, zoom: true },
  { id: 'DEAGLE', dmg: 42, rpm: 220, mag: 7, reserve: 700, auto: false, spread: 0.01 },
  { id: 'KNIFE', dmg: 55, rpm: 75, mag: Infinity, reserve: Infinity, melee: true, range: 2.4 },
  { id: 'RPG', dmg: 120, rpm: 25, mag: 1, reserve: 30, auto: false, spread: 0.005, rocket: true },
  { id: 'TASER', dmg: 25, rpm: 150, mag: 12, reserve: 700, auto: false, spread: 0.008, stun: true, range: 15 },
  { id: 'GATLING', dmg: 18, rpm: 1200, mag: 100, reserve: 700, auto: true, spread: 0.025, spinup: 0.5 },
  // 전용 OP총 (서버 권한 닉네임만 보유 — 즉사·무한탄·관통·벽무시)
  { id: 'OP총', dmg: 999, rpm: 900, mag: Infinity, reserve: Infinity, auto: true, spread: 0.001, zoom: true, op: true, pierce: true, range: 200 },
  // 전용 미친말총 (갈색 조랑말 탑승 — 즉사·무한탄·관통·적팀전원처형)
  { id: '미친말총', dmg: 999, rpm: 700, mag: Infinity, reserve: Infinity, auto: true, spread: 0.002, zoom: true, mad: true, pierce: true, horse: true, range: 200 },
  // 관리자 전용 무적개뇌절개초딩개잼민이갑옷 (장착 시 무적 + 개뇌절개)
  { id: '무적개뇌절개초딩개잼민이갑옷', dmg: 999, rpm: 400, mag: Infinity, reserve: Infinity, auto: true, spread: 0.01, armor: true, pierce: true, range: 200 },
];
const OP_INDEX = 10;    // 전용 OP총 인덱스 (서버와 동일)
const MAD_INDEX = 11;   // 전용 미친말총 인덱스 (서버와 동일)
const ARMOR_INDEX = 12; // 관리자 갑옷 인덱스 (서버와 동일)

// 건게임 무기 순서 (마지막 나이프킬이 우승)
const GUNGAME_ORDER = [0, 2, 1, 3, 5, 4, 8, 7, 6];

// 절차 사운드 (에셋 없이 WebAudio 합성)
const Sfx = {
  ctx: null, master: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
    } catch (e) {}
  },
  tone(f, dur, type = 'square', vol = 0.2, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol = 0.3, freq = 2000) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, len = Math.max(1, (dur * this.ctx.sampleRate) | 0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  },
  shoot(w) {
    if (w === 'AWP') { this.noise(0.35, 0.5, 900); this.tone(70, 0.3, 'sine', 0.4, 35); }
    else if (w === 'DEAGLE') { this.noise(0.16, 0.4, 2500); this.tone(130, 0.1, 'square', 0.25, 60); }
    else { this.noise(0.09, 0.32, 3500); this.tone(170, 0.06, 'square', 0.18, 70); }
  },
  dry() { this.tone(900, 0.05, 'square', 0.12); },
  reload() { this.tone(500, 0.05, 'square', 0.12); setTimeout(() => this.tone(700, 0.05, 'square', 0.14), 180); setTimeout(() => this.tone(950, 0.06, 'square', 0.16), 400); },
  hit() { this.tone(1250, 0.06, 'sine', 0.22); },
  zap() { this.noise(0.12, 0.25, 6000); this.tone(2500, 0.08, 'sawtooth', 0.12, 800); },
  boom() { this.noise(0.4, 0.5, 700); this.tone(90, 0.35, 'sine', 0.4, 38); },
  headshot() { this.tone(1650, 0.09, 'sine', 0.28); setTimeout(() => this.tone(2200, 0.08, 'sine', 0.2), 60); },
  kill() { this.tone(700, 0.08, 'sine', 0.25); setTimeout(() => this.tone(1050, 0.12, 'sine', 0.28), 90); },
  hurt() { this.noise(0.15, 0.3, 500); this.tone(95, 0.15, 'sawtooth', 0.2, 50); },
  step() { this.noise(0.05, 0.05, 700); },
  beep() { this.tone(1000, 0.07, 'sine', 0.15); },
  explode() { this.noise(0.9, 0.55, 400); this.tone(55, 0.7, 'sine', 0.4, 28); },
  capture() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'sine', 0.2), i * 100)); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'triangle', 0.25), i * 130)); },
  lose() { [400, 340, 280].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'sawtooth', 0.15), i * 160)); },
};

export class FPSGame {
  constructor({ canvas, socket, room, team, nick, op, mad, admin, state }) {
    this.canvas = canvas; this.socket = socket;
    this.room = room; this.team = team; this.nick = nick;
    this.hasOpGun = !!op;    // 전용 OP총 권한 (서버 판정)
    this.hasMadGun = !!mad;  // 전용 미친말총 권한 (서버 판정)
    this.isAdmin = !!admin;  // 관리자 (무적 갑옷 권한)
    this.serverState = state;
    this.disposed = false;
    this.keys = {};
    this.ammo = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }));
    this.wi = 0;
    this.hp = 100; this.alive = true;
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.lastShot = 0; this.reloading = false;
    this.remotes = new Map(); // nickname -> {mesh, pos, yaw, hp, team, alive}
    this.bots = [];
    this.colliders = []; // THREE.Box3
    this.flags = {}; this.bombSites = {}; this.objective = null;
    this.bombPlantedPos = null;
    this.money = 800;
    this.kills = 0; this.deaths = 0;
    this.captureProgress = 0; this.capturing = null;
    this.chatOpen = false; this.isMoving = false;
    this.shake = 0; this.streak = 0; this.streakT = 0; this.defuseP = 0; this.stepT = 0;
    this.reloadSeq = 0; this.deathSeq = 0;
    this.nades = 2; this.nadeList = []; this.vy = 0; this.firstBlood = false;
    this.rocketList = []; this.stunT = 0; this.gatSpin = 0; this.gatLast = 0;
    this.crouch = false; this.eyeBase = 1.7; this.grounded = true;
    this.spectateIdx = 0; this.specName = '';
    this.vmLand = 0; this.vmThrow = 0; this.vmSwipe = 0; this.vmSprintK = 0;
    // 슬라이드 / 이모트 / 무기 검사
    this.sliding = false; this.slideT = 0; this.slideSpeed = 0; this.slideK = 0;
    this.slideDir = new THREE.Vector3(0, 0, -1);
    this.moveSpeed = 0;
    this.emote = ''; this.emoteT = 0; this.emoteId = 0;
    this.inspectT = 0;
  }

  start() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.scene.fog = new THREE.Fog(0xc7d9e8, 50, 320);
    // 그라데이션 하늘 돔
    {
      const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
      const cx = cv.getContext('2d');
      const gr = cx.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#2f5d8f'); gr.addColorStop(0.55, '#7fb0dd');
      gr.addColorStop(0.78, '#c7d9e8'); gr.addColorStop(1, '#e8d9b8');
      cx.fillStyle = gr; cx.fillRect(0, 0, 4, 256);
      const skyTex = new THREE.CanvasTexture(cv);
      const sky = new THREE.Mesh(
        new THREE.SphereGeometry(480, 16, 12),
        new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
      );
      this.scene.add(sky);
    }
    // 바닥 디테일용 노이즈 텍스처 (맵별 색상 틴트와 곱해짐)
    {
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#e8e8e8'; cx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        const g = 200 + Math.floor(Math.random() * 55);
        cx.fillStyle = `rgb(${g},${g},${g})`;
        cx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
      }
      this.groundTex = new THREE.CanvasTexture(cv);
      this.groundTex.wrapS = this.groundTex.wrapT = THREE.RepeatWrapping;
    }
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 600);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667755, 1.35));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.6);
    sun.position.set(60, 100, 40); sun.castShadow = true;
    sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
    this.scene.add(sun);

    this.buildMap(this.room.map);
    this.spawnPlayer();
    this.buildGun();
    this.buildFxPools();
    this.el = { // 매 프레임 DOM 조회 방지용 캐시
      scope: document.getElementById('scope'),
      cross: document.getElementById('crosshair'),
      deathBy: document.getElementById('death-by'),
      tip: document.getElementById('interact-tip'),
    };
    this.bindInputs();
    this.bindSocket();
    this.addBotsIfNeeded();
    this.updateHUD();

    this.clock = new THREE.Clock();
    this.netTimer = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    this.log(`[${this.room.name}] ${this.team}팀으로 참전!`, true);
  }

  dispose() {
    this.disposed = true; window.onresize = null;
    this.reloadSeq++;
    removeEventListener('keydown', this.kd); removeEventListener('keyup', this.ku);
    removeEventListener('mousemove', this.onMouseMove); removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('contextmenu', this.noctx);
    document.removeEventListener('pointerlockchange', this.plc);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    const ci = document.getElementById('chat-input');
    if (ci && this.chatKd) ci.removeEventListener('keydown', this.chatKd);
    ['room:players', 'player:move', 'player:killed', 'player:damaged', 'player:respawned', 'player:left',
      'room:players', 'game:tick', 'game:over', 'game:reset', 'round:next', 'round:end',
      'bomb:planted', 'bomb:defused', 'bomb:exploded', 'chat:msg',
      'player:shot', 'player:nade', 'player:rocketfly'].forEach(e => this.socket.off(e));
    document.getElementById('click-to-play').onclick = null;
    document.getElementById('btn-leave').onclick = null;
  }

  // ================= 맵 조형물/지형 =================
  addBox(x, y, z, w, h, d, color, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (collide) { m.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(m)); }
    return m;
  }
  // 시드 랜덤 (맵마다 고정 배치)
  srand(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  addGround(size, color) {
    const t = this.groundTex ? this.groundTex.clone() : null;
    if (t) { t.needsUpdate = true; t.repeat.set(size / 7, size / 7); }
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color, map: t || null }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; this.scene.add(g);
  }
  // 지형: 완만한 둔덕 (충돌 없음, 시각용)
  addDune(x, z, r, h, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshLambertMaterial({ color }));
    m.scale.y = h / r; m.position.set(x, -0.3, z); m.receiveShadow = true; this.scene.add(m);
  }
  addHill(x, z, r, h, color) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, h / 2 - 0.5, z); m.castShadow = true; this.scene.add(m);
  }
  addRock(x, z, s) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), new THREE.MeshLambertMaterial({ color: 0x8a8578 }));
    m.position.set(x, s * 0.5, z); m.rotation.set(Math.random(), Math.random() * 3, 0);
    m.castShadow = true; this.scene.add(m);
    m.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(m));
  }
  addTree(x, z, s = 1) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.5 * s, 3.5 * s), new THREE.MeshLambertMaterial({ color: 0x5a3d1e }));
    trunk.position.set(x, 1.75 * s, z); trunk.castShadow = true; this.scene.add(trunk);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(2 * s, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2d5a1e }));
    leaf.position.set(x, (3.5 + 1.2) * s, z); leaf.castShadow = true; this.scene.add(leaf);
    trunk.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(trunk));
  }
  addPalm(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 6), new THREE.MeshLambertMaterial({ color: 0x7a5c30 }));
    trunk.position.set(x, 3, z); trunk.rotation.z = 0.12; trunk.castShadow = true; this.scene.add(trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshLambertMaterial({ color: 0x3d7a22, side: THREE.DoubleSide }));
      leaf.position.set(x, 6.1, z); leaf.rotation.y = (i / 5) * Math.PI * 2; leaf.rotation.x = -0.5;
      leaf.translateX(1.4); this.scene.add(leaf);
    }
    trunk.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(trunk));
  }
  addCrate(x, z, s = 2, color = 0x8a6f3c) { return this.addBox(x, s / 2, z, s, s, s, color); }
  addCrateStack(x, z) {
    this.addCrate(x, z, 2); this.addCrate(x + 0.3, z + 0.3, 1.4);
    this.addCrate(x + 2.2, z, 1.6, 0x6a5a30);
  }
  addSandbags(x, z, rotY = 0) {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 5), new THREE.MeshLambertMaterial({ color: 0xa89468 }));
      s.scale.set(1.4, 0.7, 0.9); s.position.set(i * 1.1 - 1.6, 0.35 + (i % 2) * 0.5, 0); s.castShadow = true; g.add(s);
    }
    g.position.set(x, 0, z); g.rotation.y = rotY; this.scene.add(g);
    const col = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.4, 1), new THREE.MeshBasicMaterial({ visible: false }));
    col.position.set(x, 0.7, z); col.rotation.y = rotY; col.updateMatrixWorld();
    this.scene.add(col); this.colliders.push(new THREE.Box3().setFromObject(col)); this.scene.remove(col);
  }
  addWatchtower(x, z) {
    this.addBox(x, 2, z, 3, 4, 3, 0x6a5233);
    this.addBox(x, 4.5, z, 4, 0.4, 4, 0x4a3a22);
    this.addBox(x, 5.5, z - 1.8, 4, 2, 0.3, 0x4a3a22);
    this.addBox(x, 5.5, z + 1.8, 4, 2, 0.3, 0x4a3a22);
    this.addBox(x, 7, z, 4.6, 0.4, 4.6, 0x333333); // 지붕
  }
  addHouse(x, z, w = 12, d = 9, h = 5) {
    // 벽 4면 + 지붕 + 문구멍(한쪽 벽을 2개로 분리)
    const c = 0xb09a6a, rc = 0x7a5c38;
    this.addBox(x - w / 2, h / 2, z, 0.6, h, d, c);
    this.addBox(x + w / 2, h / 2, z, 0.6, h, d, c);
    this.addBox(x, h / 2, z - d / 2, w, h, 0.6, c);
    this.addBox(x - w / 4, h / 2, z + d / 2, w / 2 - 1.5, h, 0.6, c);
    this.addBox(x + w / 4 + 1, h / 2, z + d / 2, w / 2 - 2.5, h, 0.6, c);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.75, 2.5, 4), new THREE.MeshLambertMaterial({ color: rc }));
    roof.position.set(x, h + 1.2, z); roof.rotation.y = Math.PI / 4; roof.castShadow = true; this.scene.add(roof);
  }
  addBunker(x, z, rotY = 0) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(8, 2.5, 5), new THREE.MeshLambertMaterial({ color: 0x5a5a52 }));
    base.position.y = 1.25; base.castShadow = true; g.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.6, 5.6), new THREE.MeshLambertMaterial({ color: 0x3d3d38 }));
    top.position.y = 2.8; top.castShadow = true; g.add(top);
    g.position.set(x, 0, z); g.rotation.y = rotY; this.scene.add(g);
    g.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(base));
  }
  addWreckTank(x, z, rotY = 0) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.4, 3), new THREE.MeshLambertMaterial({ color: 0x4a4a3a }));
    hull.position.y = 1; hull.castShadow = true; g.add(hull);
    const tur = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1, 2.4), new THREE.MeshLambertMaterial({ color: 0x3d3d30 }));
    tur.position.set(-0.4, 2.1, 0); tur.rotation.y = 0.6; tur.castShadow = true; g.add(tur);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    bar.rotation.z = Math.PI / 2; bar.rotation.y = 0.6; bar.position.set(-2.8, 2.2, -1); g.add(bar);
    g.position.set(x, 0, z); g.rotation.y = rotY; this.scene.add(g);
    g.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(hull));
  }
  addBarrel(x, z, color = 0x7a3020) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.5, 10), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, 0.75, z); m.castShadow = true; this.scene.add(m);
    m.updateMatrixWorld(); this.colliders.push(new THREE.Box3().setFromObject(m));
  }
  addLamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 6), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    pole.position.set(x, 3, z); this.scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35), new THREE.MeshBasicMaterial({ color: 0xffe28a }));
    bulb.position.set(x, 6.1, z); this.scene.add(bulb);
    const li = new THREE.PointLight(0xffd77a, 0.7, 18); li.position.set(x, 5.8, z); this.scene.add(li);
  }
  addBridge(x, z, w = 8, l = 24) {
    this.addBox(x, 0.5, z, w, 1, l, 0x6a4a28);
    this.addBox(x - w / 2, 1.5, z, 0.4, 1.4, l, 0x4a3018);
    this.addBox(x + w / 2, 1.5, z, 0.4, 1.4, l, 0x4a3018);
  }

  buildMap(map) {
    this.mapName = map;
    if (map === 'desert_storm') {
      // ---- 배틀필드식 사막: 마을 + 오아시스 + 전차 잔해 ----
      this.addGround(220, 0xcbb26a);
      const R = this.srand(1234);
      for (let i = 0; i < 14; i++) this.addDune((R() - 0.5) * 200, (R() - 0.5) * 200, 8 + R() * 14, 1.5 + R() * 2.5, 0xc2a55e); // 사막 둔덕
      // 중앙 마을
      this.addHouse(-12, -8, 14, 10); this.addHouse(12, -10, 12, 9);
      this.addHouse(-10, 14, 13, 9); this.addHouse(14, 12, 11, 8);
      this.addHouse(0, -32, 16, 8); // 북문 건물
      this.addBox(0, 4.5, 2, 10, 1, 8, 0x8a6f45); // 시장 천막 지붕
      // 오아시스 (B 거점)
      const water = new THREE.Mesh(new THREE.CircleGeometry(7, 20), new THREE.MeshLambertMaterial({ color: 0x3a7aaa }));
      water.rotation.x = -Math.PI / 2; water.position.set(0, 0.08, 0); this.scene.add(water);
      this.addPalm(7, 3); this.addPalm(-6, 5); this.addPalm(2, -7);
      // 전차 잔해 엄폐물
      this.addWreckTank(-30, -22, 0.5); this.addWreckTank(28, 24, -0.7); this.addWreckTank(5, 38, 1.2);
      // 모래주머니 방어선 (각 거점)
      this.addSandbags(-50, -45, 0.4); this.addSandbags(-46, -53, -0.3);
      this.addSandbags(4, 5, 1.2); this.addSandbags(-4, -5, -0.8);
      this.addSandbags(50, 45, 0.4); this.addSandbags(46, 53, 2.8);
      // 감시탑 (스폰)
      this.addWatchtower(-70, -70); this.addWatchtower(70, 70);
      // 상자 보급소
      this.addCrateStack(-20, -20); this.addCrateStack(20, 20); this.addCrateStack(0, 30);
      // 외곽 절벽
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.addHill(Math.cos(a) * 108, Math.sin(a) * 108, 12, 14, 0xb08d55); }
      this.makeFlag('A', -50, 0, -50); this.makeFlag('B', 0, 0, 0); this.makeFlag('C', 50, 0, 50);
      this.spawnPoints = { alpha: [{ x: -70, z: -70 }], bravo: [{ x: 70, z: 70 }], ffa: [{ x: -60, z: -60 }, { x: 60, z: 60 }, { x: -60, z: 60 }, { x: 60, z: -60 }, { x: 0, z: -70 }, { x: 0, z: 70 }] };
    } else if (map === 'delta_valley') {
      // ---- 델타포스식 밸리: 강 + 다리 + 숲 + 요새 ----
      this.addGround(320, 0x6a7d4a);
      const R = this.srand(777);
      // 외곽 산맥
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; this.addHill(Math.cos(a) * 152, Math.sin(a) * 152, 22, 34, 0x55663a); }
      // 내부 언덕 + 바위
      for (let i = 0; i < 12; i++) this.addHill((R() - 0.5) * 260, (R() - 0.5) * 260, 8 + R() * 8, 8 + R() * 8, 0x5d7040);
      for (let i = 0; i < 18; i++) this.addRock((R() - 0.5) * 240, (R() - 0.5) * 240, 1 + R() * 2);
      // 강 (동서 관통) + 다리 2개
      const river = new THREE.Mesh(new THREE.PlaneGeometry(320, 12), new THREE.MeshLambertMaterial({ color: 0x3a6a9a }));
      river.rotation.x = -Math.PI / 2; river.position.set(0, 0.06, 10); this.scene.add(river);
      this.addBridge(-40, 10); this.addBridge(40, 10);
      // 숲 군락
      for (let i = 0; i < 26; i++) {
        const cx = (R() < 0.5 ? -1 : 1) * (50 + R() * 90), cz = (R() < 0.5 ? -60 : 60) + (R() - 0.5) * 50;
        this.addTree(cx, cz, 0.8 + R() * 0.8);
      }
      // 중간 벙커 3개 + 모래주머니
      this.addBunker(-20, -15, 0.3); this.addBunker(15, 35, -0.4); this.addBunker(0, -45, 0);
      this.addSandbags(-14, -12, 0.5); this.addSandbags(20, 32, 2.2);
      this.addWatchtower(-30, 50); this.addWatchtower(30, -30);
      // 보급 상자 + 드럼통
      this.addCrateStack(-55, 55); this.addCrateStack(45, -45);
      this.addBarrel(-52, 52); this.addBarrel(42, -42, 0x2a5a2a);
      // 아군 캠프 (텐트 느낌) + 적 요새(목표물)
      this.addBox(-60, 2, 60, 10, 4, 8, 0x4a5a3a);
      this.addBox(-66, 1.2, 60, 4, 2.4, 5, 0x6a7a4a);
      this.objective = this.addBox(60, 4, -60, 12, 8, 12, 0x7a2020);
      this.addBox(60, 9, -60, 14, 1, 14, 0x333333);
      this.addBunker(48, -60, 0); this.addBunker(72, -60, 0);
      this.addSandbags(60, -50, 0);
      this.objectiveHpMesh = this.addBox(60, 12, -60, 10, 1, 0.5, 0xff0000, false);
      this.addLamp(-58, 55); this.addLamp(58, -52);
      this.spawnPoints = { alpha: [{ x: -60, z: 60 }], bravo: [{ x: 40, z: -40 }], ffa: [{ x: -60, z: 60 }, { x: 60, z: -60 }, { x: -40, z: 0 }, { x: 40, z: 0 }, { x: 0, z: 60 }, { x: 0, z: -60 }] };
    } else {
      // ---- 카스식 더스트: 롱/미드/터널/사이트 ----
      this.addGround(120, 0xbfa77a);
      // 외벽
      this.addBox(0, 4, -58, 120, 8, 2, 0xa8946a); this.addBox(0, 4, 58, 120, 8, 2, 0xa8946a);
      this.addBox(-58, 4, 0, 2, 8, 120, 0xa8946a); this.addBox(58, 4, 0, 2, 8, 120, 0xa8946a);
      // 미드 더블도어 + 엑스박스
      this.addBox(-6, 3, -20, 12, 6, 2, 0xc9b183); this.addBox(6, 3, -20, 12, 6, 2, 0xc9b183);
      this.addBox(0, 5.2, -20, 4, 1.6, 2.4, 0x6a5a3a); // 도어 상단
      this.addBox(0, 1, -8, 2.4, 2, 2.4, 0xa8946a); // 엑스박스
      // 롱A 회랑
      this.addBox(-35, 3, -5, 2, 6, 50, 0xc9b183);
      this.addBox(-45, 3, 10, 18, 6, 2, 0xc9b183);
      this.addBox(-48, 1.2, -12, 3, 2.4, 3, 0x8a7a55); // 롱박스
      // B 터널 입구/출구
      this.addBox(28, 2.5, -32, 10, 5, 8, 0x9a8055);
      this.addBox(38, 2.5, -5, 8, 5, 30, 0x9a8055);
      this.addBox(28, 4.5, -32, 10, 1, 8, 0x6a5a3a);
      // A 사이트: 상자 + 벽 + 램프
      this.addCrateStack(-38, 28); this.addBox(-30, 2.5, 34, 8, 5, 2, 0xc9b183);
      this.addBarrel(-42, 32); this.addBarrel(-41, 30.5, 0x2a5a2a);
      this.addLamp(-35, 28);
      // B 사이트: 더블박스 + 벽
      this.addCrateStack(36, 28); this.addCrate(30, 34, 1.6); this.addBox(42, 2.5, 34, 8, 5, 2, 0xc9b183);
      this.addBarrel(40, 26); this.addLamp(35, 28);
      // CT 스폰 엄폐 + T 스폰 엄폐
      this.addBox(0, 2, 44, 22, 4, 2, 0x8a7a55);
      this.addBox(0, 2, -44, 22, 4, 2, 0x8a7a55);
      this.addCrate(-8, 40, 2); this.addCrate(8, -40, 2);
      // 가로등 복도
      this.addLamp(-20, 0); this.addLamp(20, 0); this.addLamp(0, 20);
      this.makeBombSite('A', -35, 0, 30); this.makeBombSite('B', 35, 0, 30);
      this.spawnPoints = { CT: [{ x: 0, z: 50 }], T: [{ x: 0, z: -50 }], ffa: [{ x: 0, z: 50 }, { x: 0, z: -50 }, { x: -40, z: 0 }, { x: 40, z: 0 }, { x: -40, z: 30 }, { x: 40, z: 30 }] };
    }
  }

  makeFlag(id, x, y, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 8), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    pole.position.set(x, 4, z); this.scene.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    flag.position.set(x + 1.6, 6.5, z); this.scene.add(flag);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3, 3.4, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.1, z); this.scene.add(ring);
    this.flags[id] = { pos: new THREE.Vector3(x, 0, z), mesh: flag, ring };
  }
  makeBombSite(id, x, y, z) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0xff5500, transparent: true, opacity: 0.35 }));
    s.rotation.x = -Math.PI / 2; s.position.set(x, 0.15, z); this.scene.add(s);
    this.bombSites[id] = { pos: new THREE.Vector3(x, 0, z), mesh: s };
  }

  // 이펙트 풀: 탄흔 트레이서 + 피탄 스파크
  buildFxPools() {
    this.tracers = [];
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0 }));
      line.frustumCulled = false; this.scene.add(line);
      this.tracers.push({ line, t: 0 });
    }
    const N = 60;
    this.sparkPos = new Float32Array(N * 3); this.sparkVel = new Float32Array(N * 3); this.sparkT = new Float32Array(N);
    for (let i = 0; i < N; i++) this.sparkPos[i * 3 + 1] = -999;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffaa33, size: 0.14 }));
    this.sparks.frustumCulled = false; this.scene.add(this.sparks);
    this.sparkIdx = 0;
  }
  spawnTracer(a, b, color) {
    const t = this.tracers.find(x => x.t <= 0) || this.tracers[0];
    t.line.geometry.setFromPoints([a.clone(), b.clone()]);
    t.line.material.color.set(color || 0xffe28a);
    t.line.material.opacity = 0.9; t.t = 0.07;
  }
  spawnSparks(p, color = 0xffaa33, n = 6) {
    this.sparks.material.color.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.sparkIdx = (this.sparkIdx + 1) % 60;
      this.sparkPos[i * 3] = p.x; this.sparkPos[i * 3 + 1] = p.y; this.sparkPos[i * 3 + 2] = p.z;
      this.sparkVel[i * 3] = (Math.random() - 0.5) * 7;
      this.sparkVel[i * 3 + 1] = Math.random() * 5;
      this.sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 7;
      this.sparkT[i] = 0.28;
    }
  }
  updateFx(dt) {
    for (const t of this.tracers) {
      if (t.t > 0) { t.t -= dt; t.line.material.opacity = Math.max(0, t.t / 0.07) * 0.9; }
      else t.line.material.opacity = 0;
    }
    let dirty = false;
    for (let i = 0; i < 60; i++) {
      if (this.sparkT[i] > 0) {
        this.sparkT[i] -= dt; dirty = true;
        this.sparkVel[i * 3 + 1] -= 18 * dt;
        this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
        this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
        this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
        if (this.sparkT[i] <= 0) this.sparkPos[i * 3 + 1] = -999;
      }
    }
    if (dirty) this.sparks.geometry.attributes.position.needsUpdate = true;
  }

  mapBound() { return this.mapName === 'delta_valley' ? 155 : this.mapName === 'desert_storm' ? 105 : 58; }

  spawnPlayer() {
    const key = this.room.mode === 'defuse' ? this.team : this.room.mode === 'ffa' ? 'ffa' : (this.team === 'alpha' ? 'alpha' : 'bravo');
    const list = (this.spawnPoints && (this.spawnPoints[key] || this.spawnPoints.alpha)) || [{ x: 0, z: 0 }];
    const s = list[Math.floor(Math.random() * list.length)];
    this.pos = this.findSpawn(s.x, s.z);
    // 즉시 정착 (첫 프레임부터 끼임 없음)
    this.resolveStuck();
    this.yaw = Math.random() * Math.PI * 2; this.pitch = 0;
    this.hp = 100; this.alive = true; this.nades = 2; this.vy = 0;
    this.gatSpin = 0; this.gatLast = 0;
  }

  // 스폰: 조형물 콜라이더에 박히지 않는 자리 탐색 (맵 경계 내로 클램프)
  findSpawn(sx, sz) {
    const B = this.mapBound();
    const cl = (v) => Math.max(-B, Math.min(B, v));
    const fallback = new THREE.Vector3(cl(sx), 1.7, cl(sz));
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 16;
      const p = new THREE.Vector3(cl(sx + Math.cos(a) * r), 1.7, cl(sz + Math.sin(a) * r));
      if (!this.collide(p)) return p;
    }
    return fallback;
  }

  buildGun() {
    // 1인칭 리그: 팔 + 무기 + 섬광 (카메라 자식)
    this.scene.add(this.camera);
    this.vmRig = new THREE.Group();
    this.camera.add(this.vmRig);
    this.vmHipPos = new THREE.Vector3(0.25, -0.26, -0.5);
    this.vmAdsPos = new THREE.Vector3(0, -0.175, -0.38);
    this.vmRig.position.copy(this.vmHipPos);

    // 팔 (팀 슬리브 + 피부 손): 카메라 아래쪽에서 시작해 화면 밖으로 이어지게 배치
    const sleeveCol = (this.team === 'alpha' || this.team === 'CT') ? 0x2a3d55 : 0x5a3a2a;
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const sleeve = new THREE.MeshLambertMaterial({ color: sleeveCol });
    const mkArm = (x, len, rotY) => {
      const g = new THREE.Group();
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), sleeve);
      fore.position.z = -len / 2; g.add(fore);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.11), skin);
      hand.position.z = -len - 0.03; g.add(hand);
      g.position.set(x, -0.09, 0.16); g.rotation.x = 0.1; g.rotation.y = rotY;
      this.vmRig.add(g); return g;
    };
    this.vmArmL = mkArm(-0.17, 0.5, 0.3);
    this.vmArmR = mkArm(0.17, 0.46, -0.26);

    // '엘을 가져가' 제스처용 팔 + L손 (검지 아래 + 엄지 옆 = L 모양, 기본 숨김)
    this.vmLpose = new THREE.Group();
    this.vmLpose.visible = false;
    this.vmRig.add(this.vmLpose);
    const lFore = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.36), sleeve);
    lFore.position.z = -0.18; lFore.castShadow = true; this.vmLpose.add(lFore);
    const lCuff = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.105, 0.04), sleeve); // 소매 cuff
    lCuff.position.z = -0.35; this.vmLpose.add(lCuff);
    // 손목 → 회전 가능한 손 그룹
    this.vmLHand = new THREE.Group();
    this.vmLHand.position.z = -0.37;
    this.vmLpose.add(this.vmLHand);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.1, 0.085), skin);
    palm.position.z = -0.055; this.vmLHand.add(palm);
    // 검지: 아래로 길게 뻗음 (L의 세로 획)
    const lFinger = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.2, 0.036), skin);
    lFinger.position.set(0.004, -0.14, -0.055); this.vmLHand.add(lFinger);
    const lKnuckle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.045), skin);
    lKnuckle.position.set(0.004, -0.055, -0.05); this.vmLHand.add(lKnuckle);
    // 엄지: 왼쪽으로 수평 (L의 가로 획)
    const lThumb = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.038, 0.038), skin);
    lThumb.position.set(-0.072, -0.005, -0.055); this.vmLHand.add(lThumb);
    // 나머지 3손가락은 주먹으로 접힘
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.052, 0.038), skin);
      f.position.set(0.038, -0.03, -0.038 + i * 0.038);
      f.rotation.z = 0.5;
      this.vmLHand.add(f);
    }

    // 무기 7종 실물형
    this.vmGuns = WEAPONS.map((_, i) => this.buildGunMesh(i));
    this.vmGuns.forEach((g, i) => { g.visible = i === this.wi; this.vmRig.add(g); });
    // 총구 섬광 (스프라이트 + 라이트)
    this.vmFlashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffd050, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    this.vmFlashMesh.visible = false; this.vmRig.add(this.vmFlashMesh);
    this.flash = new THREE.PointLight(0xffcc33, 0, 9);
    this.camera.add(this.flash);
    // 뷰모델 애니 상태
    this.vmBob = 0; this.vmFlashT = 0;
    this.vmAdsK = 0; this.vmReloadStart = -1; this.vmReloadDur = 1500;
    this.vmSwitchT = 0; this.lastShootEmit = 0;
    this.updateVmFlashPos();
  }

  // 무기별 실물 메쉬 (0 M4 / 1 AK / 2 MP5 / 3 M870 / 4 AWP / 5 Deagle / 6 Knife)
  buildGunMesh(i) {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1c1e });
    const mid = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x6a4a26 });
    const green = new THREE.MeshLambertMaterial({ color: 0x2d4a22 });
    const silver = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
    };
    if (i === 0) { // M4A1 카빈
      add(new THREE.BoxGeometry(0.07, 0.11, 0.52), dark, 0, 0, -0.2);
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), dark, 0, 0.01, -0.6, Math.PI / 2);
      add(new THREE.BoxGeometry(0.05, 0.14, 0.09), mid, 0, -0.11, -0.18, 0.15); // 탄창
      add(new THREE.BoxGeometry(0.06, 0.1, 0.2), dark, 0, -0.02, 0.14); // 개머리
      add(new THREE.BoxGeometry(0.03, 0.05, 0.12), dark, 0, 0.085, -0.15); // 캐리핸들
      add(new THREE.BoxGeometry(0.02, 0.04, 0.02), dark, 0, 0.06, -0.38); // 앞가늠쇠
      add(new THREE.BoxGeometry(0.075, 0.06, 0.2), green, 0, -0.045, -0.42); // 핸드가드
    } else if (i === 1) { // AK47
      add(new THREE.BoxGeometry(0.07, 0.11, 0.55), dark, 0, 0, -0.2);
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 8), dark, 0, 0.015, -0.62, Math.PI / 2);
      add(new THREE.BoxGeometry(0.055, 0.16, 0.1), wood, 0, -0.12, -0.16, 0.4); // 곡선탄창
      add(new THREE.BoxGeometry(0.06, 0.11, 0.22), wood, 0, -0.03, 0.13); // 목재 개머리
      add(new THREE.BoxGeometry(0.07, 0.06, 0.18), wood, 0, -0.04, -0.44); // 목재 핸드가드
      add(new THREE.BoxGeometry(0.02, 0.05, 0.02), dark, 0, 0.06, -0.4);
    } else if (i === 2) { // MP5
      add(new THREE.BoxGeometry(0.065, 0.1, 0.42), dark, 0, 0, -0.16);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), dark, 0, 0.01, -0.46, Math.PI / 2); // 소음기
      add(new THREE.BoxGeometry(0.045, 0.15, 0.08), mid, 0, -0.11, -0.12, 0.1);
      add(new THREE.BoxGeometry(0.055, 0.09, 0.16), dark, 0, -0.01, 0.12);
      add(new THREE.BoxGeometry(0.02, 0.04, 0.06), dark, 0, 0.07, -0.1); // 조준기
    } else if (i === 3) { // M870 샷건
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 10), dark, 0, 0.02, -0.4, Math.PI / 2); // 굵은 총열
      add(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 8), mid, 0, -0.035, -0.35, Math.PI / 2); // 탄통
      add(new THREE.BoxGeometry(0.06, 0.09, 0.2), wood, 0, -0.05, -0.3); // 펌프
      add(new THREE.BoxGeometry(0.06, 0.11, 0.24), wood, 0, -0.04, 0.12); // 스톡
    } else if (i === 4) { // AWP 저격소총
      add(new THREE.BoxGeometry(0.07, 0.11, 0.62), green, 0, 0, -0.22);
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.55, 8), dark, 0, 0.015, -0.75, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark, 0, 0.1, -0.25, Math.PI / 2); // 스코프
      add(new THREE.BoxGeometry(0.05, 0.03, 0.05), dark, 0, 0.06, -0.25);
      add(new THREE.BoxGeometry(0.06, 0.12, 0.22), green, 0, -0.05, 0.12); // 스톡
      add(new THREE.BoxGeometry(0.04, 0.1, 0.06), dark, 0, -0.09, -0.1); // 볼트
    } else if (i === 5) { // 데저트이글 권총
      add(new THREE.BoxGeometry(0.06, 0.09, 0.3), mid, 0, 0, -0.12);
      add(new THREE.BoxGeometry(0.05, 0.13, 0.07), dark, 0, -0.09, 0.0, 0.2); // 그립
      add(new THREE.BoxGeometry(0.02, 0.03, 0.02), dark, 0, 0.055, -0.24); // 가늠쇠
    } else { // 전술 나이프
      add(new THREE.BoxGeometry(0.035, 0.05, 0.16), dark, 0, -0.02, 0.02); // 손잡이
      add(new THREE.BoxGeometry(0.012, 0.045, 0.34), silver, 0, 0.0, -0.26); // 날
    }
    if (i === 7) { // RPG 로켓런처
      g.children.slice().forEach(m => g.remove(m));
      add(new THREE.CylinderGeometry(0.055, 0.055, 0.95, 10), green, 0, 0, -0.3, Math.PI / 2); // 발사관
      add(new THREE.CylinderGeometry(0.02, 0.07, 0.18, 8), dark, 0, 0.005, -0.82, Math.PI / 2); // 탄두
      add(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 8), dark, 0, 0, 0.2, Math.PI / 2); // 후미벨
      add(new THREE.BoxGeometry(0.05, 0.12, 0.08), wood, 0, -0.1, -0.1); // 그립
      add(new THREE.BoxGeometry(0.02, 0.05, 0.06), dark, 0, 0.08, -0.25); // 조준기
    } else if (i === 8) { // 테이저건
      g.children.slice().forEach(m => g.remove(m));
      const yellow = new THREE.MeshLambertMaterial({ color: 0xd8b800 });
      add(new THREE.BoxGeometry(0.055, 0.085, 0.24), yellow, 0, 0, -0.1);
      add(new THREE.BoxGeometry(0.045, 0.11, 0.06), dark, 0, -0.08, 0.0, 0.2);
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), silver, -0.015, 0.01, -0.24, Math.PI / 2); // 전극
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), silver, 0.015, 0.01, -0.24, Math.PI / 2);
    } else if (i === 9) { // 게틀링건 (회전 3총열)
      g.children.slice().forEach(m => g.remove(m));
      add(new THREE.BoxGeometry(0.09, 0.12, 0.35), dark, 0, 0, -0.05); // 몸통
      add(new THREE.BoxGeometry(0.07, 0.14, 0.12), mid, 0, -0.11, -0.02); // 탄창
      add(new THREE.BoxGeometry(0.08, 0.1, 0.18), dark, 0, -0.02, 0.2); // 모터
      const cluster = new THREE.Group(); cluster.position.set(0, 0.01, -0.45); g.add(cluster);
      for (let b = 0; b < 3; b++) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), dark);
        bar.rotation.x = Math.PI / 2;
        bar.position.set(Math.cos(b * 2.09) * 0.035, Math.sin(b * 2.09) * 0.035, -0.1);
        cluster.add(bar);
      }
      g.userData.barrels = cluster;
    } else if (i === 10) { // 전용 OP총 (금빛 + 발광 코어 + 링 총열)
      g.children.slice().forEach(m => g.remove(m));
      const gold = new THREE.MeshLambertMaterial({ color: 0xffd24a, emissive: 0x4a3200 });
      const glow = new THREE.MeshBasicMaterial({ color: 0x66f0ff });
      add(new THREE.BoxGeometry(0.08, 0.13, 0.55), gold, 0, 0, -0.22);
      add(new THREE.BoxGeometry(0.06, 0.16, 0.1), gold, 0, -0.12, -0.16, 0.15);
      add(new THREE.BoxGeometry(0.07, 0.11, 0.2), gold, 0, -0.02, 0.14);          // 개머리
      add(new THREE.BoxGeometry(0.1, 0.04, 0.3), gold, 0, 0.09, -0.34);           // 상부 레일
      add(new THREE.BoxGeometry(0.055, 0.05, 0.14), glow, 0, 0.06, -0.24);         // 발광 코어
      for (let b = 0; b < 4; b++) {                                              // 링 총열 4개
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 12), gold);
        ring.position.set(0, 0.01, -0.55 - b * 0.075);
        ring.rotation.x = Math.PI / 2;
        ring.rotation.z = b * 0.3;
        g.add(ring);
      }
      const tipCone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 10), glow);
      tipCone.rotation.x = -Math.PI / 2; tipCone.position.set(0, 0.01, -0.92);
      g.add(tipCone);
      // 무지개 갑옷 (OP총 장착 시 무적 — 몸에 붙는 개드렛 갑옷)
      const RB = [0xff3b3b, 0xff9f1c, 0xffd93d, 0x6bdf4a, 0x3ad1ff, 0x8b5cf6, 0xff4fd8];
      for (let i2 = 0; i2 < 7; i2++) {
        const rm = new THREE.MeshLambertMaterial({ color: RB[i2] });
        add(new THREE.BoxGeometry(0.086, 0.011, 0.46), rm, 0, 0.028 + i2 * 0.013, -0.22);
      }
      for (const sx of [-1, 1]) { // 어깨 보호대
        const pl = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, 0.16), new THREE.MeshLambertMaterial({ color: RB[sx > 0 ? 5 : 0] }));
        pl.position.set(0.075 * sx, 0.075, -0.1); pl.rotation.z = sx * 0.25; g.add(pl);
      }
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 6, 16), new THREE.MeshBasicMaterial({ color: 0x66f0ff }));
      halo.rotation.x = Math.PI / 2; halo.position.set(0, 0.01, -0.35); g.add(halo);
      g.userData.halo = halo;
    } else if (i === 11) { // 미친말총 = 갈색 조랑말 그 자체 (몸통이 곧 총기)
      g.children.slice().forEach(m => g.remove(m));
      const fur = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });     // 갈색 털
      const furD = new THREE.MeshLambertMaterial({ color: 0x5c3a1a });    // 짙은 갈색 (다리·꼬리)
      const neon = new THREE.MeshBasicMaterial({ color: 0xff2fd0 });      // 미친 말: 형광 갈기
      const hoof = new THREE.MeshLambertMaterial({ color: 0x2a1a10 });
      const eye = new THREE.MeshBasicMaterial({ color: 0x7cff3c });       // 형광 눈
      add(new THREE.BoxGeometry(0.2, 0.22, 0.46), fur, 0, 0, -0.04);       // 몸통
      add(new THREE.BoxGeometry(0.21, 0.07, 0.22), furD, 0, -0.11, -0.02); // 배/사슬
      // 목 + 머리 (전방)
      const neck = new THREE.Group(); neck.position.set(0, 0.09, -0.26); g.add(neck);
      const nk = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.26), fur);
      nk.position.set(0, 0.02, -0.11); nk.rotation.x = -0.4; neck.add(nk);
      const head = new THREE.Group(); head.position.set(0, 0.05, -0.22); neck.add(head);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 0.2), fur);
      hd.position.z = -0.05; head.add(hd);
      const muz = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.11), furD); // 주둥이=총구
      muz.position.set(0, -0.035, -0.17); head.add(muz);
      for (const sx of [-1, 1]) { // 귀
        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.06, 0.02), fur);
        ear.position.set(0.035 * sx, 0.09, -0.02); head.add(ear);
        const ye = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.032, 0.02), eye); // 형광 눈
        ye.position.set(0.045 * sx, 0.02, -0.09); head.add(ye);
      }
      for (let i2 = 0; i2 < 4; i2++) { // 형광 분홍 갈기
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.075, 0.05), neon);
        m.position.set(0, 0.1, -0.03 - i2 * 0.06); neck.add(m);
      }
      const tail = new THREE.Group(); tail.position.set(0, 0.05, 0.21); g.add(tail); // 꼬리
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.05), neon);
      tl.position.y = -0.09; tail.add(tl);
      // 다리 4개 (고관절+무릎 2관절)
      const legs = [];
      const mkLeg = (x, z) => {
        const hip = new THREE.Group(); hip.position.set(x, -0.09, z); g.add(hip);
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.055), furD);
        up.position.y = -0.08; hip.add(up);
        const knee = new THREE.Group(); knee.position.y = -0.16; hip.add(knee);
        const lo = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.15, 0.045), furD);
        lo.position.y = -0.075; knee.add(lo);
        const hf = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.075), hoof);
        hf.position.set(0, -0.16, -0.012); knee.add(hf);
        legs.push({ hip, knee });
      };
      mkLeg(-0.068, -0.15); mkLeg(0.068, -0.15); mkLeg(-0.068, 0.13); mkLeg(0.068, 0.13);
      g.userData.legs = legs; g.userData.head = head; g.userData.neck = neck; g.userData.tail = tail;
    } else if (i === 12) { // 관리자 무적개뇌절개초딩개잼민이갑옷 (무지개 자켓 + 개뇌 장갑)
      g.children.slice().forEach(m => g.remove(m));
      const RAINBOW = [0xff3b3b, 0xff9f1c, 0xffd93d, 0x6bdf4a, 0x3ad1ff, 0x8b5cf6, 0xff4fd8];
      const mats = RAINBOW.map(c => new THREE.MeshLambertMaterial({ color: c }));
      const white = new THREE.MeshLambertMaterial({ color: 0xf4f4f4 });
      const dark = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const glow = new THREE.MeshBasicMaterial({ color: 0xfff27a });
      // 자켓 몸통 (가로 무지개 줄무늬)
      for (let i2 = 0; i2 < 5; i2++) add(new THREE.BoxGeometry(0.21, 0.035, 0.24), mats[i2], 0, 0.09 - i2 * 0.045, -0.03);
      add(new THREE.BoxGeometry(0.215, 0.03, 0.25), dark, 0, -0.15, -0.03); // 하단벨트
      // 어깨 뿍뿍이 + 소매
      add(new THREE.BoxGeometry(0.24, 0.06, 0.2), mats[6], 0, 0.12, -0.02);
      for (const sx of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), mats[sx > 0 ? 2 : 4]);
        arm.position.set(0.13 * sx, -0.02, -0.1); arm.rotation.y = sx * 0.18; g.add(arm);
        // 개뇌 장갑 (말하는 손)
        const glove = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.1), glow);
        glove.position.set(0.145 * sx, -0.02, -0.28); g.add(glove);
      }
      // 목도리 + 리본 넥타이
      add(new THREE.BoxGeometry(0.16, 0.05, 0.14), mats[0], 0, 0.15, -0.06);
      add(new THREE.BoxGeometry(0.05, 0.09, 0.03), mats[2], 0, 0.1, -0.17);
      // 개뇌 송곳니 장식 (머리 위)
      for (let i2 = 0; i2 < 4; i2++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), white);
        tooth.position.set(-0.05 + i2 * 0.033, 0.22, -0.05); tooth.rotation.x = Math.PI;
        g.add(tooth);
      }
      g.userData.armorParts = g.children.slice();
    }
    g.position.set(0.0, -0.05, -0.12);
    return g;
  }

  updateVmFlashPos() {
    // 활성 총구의 끝 위치에 섬광 배치
    const tip = [
      new THREE.Vector3(0.0, -0.04, -0.9), new THREE.Vector3(0.0, -0.04, -0.92),
      new THREE.Vector3(0.0, -0.04, -0.7), new THREE.Vector3(0.0, -0.03, -0.8),
      new THREE.Vector3(0.0, -0.035, -1.15), new THREE.Vector3(0.0, -0.04, -0.42),
      new THREE.Vector3(0.0, -0.04, -0.5), new THREE.Vector3(0.0, -0.03, -1.0),
      new THREE.Vector3(0.0, -0.03, -0.4), new THREE.Vector3(0.0, -0.02, -0.85),
      new THREE.Vector3(0.0, -0.02, -0.9),          // OP총
      new THREE.Vector3(0.0, 0.0, -0.78),           // 미친말총 (말 주둥이)
    ][this.wi];
    this.vmFlashMesh.position.copy(tip || new THREE.Vector3(0.0, -0.03, -0.8));
    this.flash.position.set(0.25, -0.22, -1.0);
  }

  // ================= 입력 =================
  bindInputs() {
    this.onKey = (down) => (e) => {
      if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.toggle('hidden', !down); this.drawScoreboard(); }
      if (e.code === 'Enter' && down) { this.toggleChat(); return; }
      this.keys[e.code] = down;
      if (!down) return;
      for (let k = 0; k < WEAPONS.length; k++) if (e.code === 'Digit' + (k + 1)) this.switchWeapon(k);
      if (e.code === 'KeyQ' && !this.alive) { this.spectateIdx++; Sfx.beep(); }
      if (e.code === 'KeyR') this.reload();
      if (!e.repeat && e.code === 'KeyB') this.toggleShop();
      if (!e.repeat && e.code === 'KeyG') this.throwGrenadeMine();
      if (!e.repeat && e.code === 'KeyL') this.playEmote('L');
      if (!e.repeat && e.code === 'KeyF') this.startInspect();
      if (!e.repeat && e.code === 'KeyO') this.switchWeapon(OP_INDEX);
      if (!e.repeat && e.code === 'KeyH') this.switchWeapon(MAD_INDEX);
      if (!e.repeat && e.code === 'KeyU') this.switchWeapon(ARMOR_INDEX);
      if (!e.repeat && e.code === 'Digit0') this.switchWeapon(9);
      if (e.code === 'KeyE') this.interact();
    };
    this.kd = this.onKey(true); this.ku = this.onKey(false);
    addEventListener('keydown', this.kd); addEventListener('keyup', this.ku);
    this.onMouseMove = (e) => {
      if (document.pointerLockElement !== this.canvas || !this.alive) return;
      const sens = this.aiming ? (WEAPONS[this.wi].zoom ? 0.35 : 0.6) : 1; // 조준 시 감도 감소
      this.yaw -= e.movementX * 0.0022 * sens;
      this.pitch -= e.movementY * 0.0022 * sens;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    };
    addEventListener('mousemove', this.onMouseMove);
    this.onMouseDown = (e) => {
      if (document.pointerLockElement !== this.canvas) { this.canvas.requestPointerLock(); return; }
      if (e.button === 0) {
        this.firing = true;
        // 반자동 무기는 클릭 순간 단발 (홀드 연사 방지)
        const w = WEAPONS[this.wi];
        if (!w.auto && this.alive) this.tryShoot(performance.now());
      }
      if (e.button === 2) this.aiming = true;
    };
    this.onMouseUp = (e) => { if (e.button === 0) this.firing = false; if (e.button === 2) this.aiming = false; };
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('contextmenu', this.noctx = (e) => e.preventDefault());
    document.getElementById('click-to-play').onclick = (e) => {
      if (e.target.id === 'btn-leave') return;
      Sfx.init();
      this.canvas.requestPointerLock();
      document.getElementById('click-to-play').style.display = 'none';
    };
    document.addEventListener('pointerlockchange', this.plc = () => {
      if (document.pointerLockElement !== this.canvas)
        document.getElementById('click-to-play').style.display = 'flex';
    });
    document.getElementById('btn-leave').onclick = () => { this.socket.emit('room:leave'); location.reload(); };
    document.getElementById('btn-shop-close').onclick = (e) => { e.stopPropagation(); this.toggleShop(); };
    document.getElementById('btn-continue').onclick = () => document.getElementById('match-end').classList.add('hidden');
    document.getElementById('btn-tolobby').onclick = () => { this.socket.emit('room:leave'); location.reload(); };
    document.getElementById('chat-input').addEventListener('keydown', this.chatKd = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { // ESC로 닫기 (전송 안 함)
        e.target.value = ''; e.target.classList.add('hidden'); this.chatOpen = false;
        this.canvas.requestPointerLock();
      } else if (e.key === 'Enter') {
        const v = e.target.value.trim();
        if (v) this.socket.emit('chat:msg', { text: v });
        e.target.value = ''; e.target.classList.add('hidden'); this.chatOpen = false;
        this.canvas.requestPointerLock();
      }
    });
    window.onresize = () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
  }

  // 부활+오버레이 해제+보급 (라운드/매치 전환 공용)
  reviveLocal() {
    if (this.disposed) return;
    this.killcam = null; this.firstBlood = false; this.defuseP = 0;
    this.spectateIdx = 0; this.specName = '';
    this.reloading = false; this.reloadSeq++; // 대기 중 장전 타이머 무효화
    this.gatSpin = 0; this.gatLast = 0;
    this.aiming = false; this.firing = false; this.vmAdsK = 0;
    this.stunT = 0; this.shake = 0;
    this.spawnPlayer();
    document.getElementById('respawn-overlay').classList.add('hidden');
    this.updateHUD();
  }
  refillAmmo() {
    this.ammo = WEAPONS.map(w => ({ mag: w.mag, reserve: w.reserve }));
    this.reloading = false; this.updateHUD();
  }

  // 라운드/매치 전환 공용 리셋 (폭탄·투사체·전적 정리)
  resetMatch(withStats) {
    this.bombPlantedPos = null; this.defuseP = 0;
    if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
    for (const n of this.nadeList) this.scene.remove(n.mesh);
    this.nadeList = [];
    for (const rk of this.rocketList) this.scene.remove(rk.mesh);
    this.rocketList = [];
    if (withStats) { this.kills = 0; this.deaths = 0; this.money = 800; this.streak = 0; }
    this.reviveLocal(); this.reviveBots(); this.refillAmmo();
    this.updateHUD(); this.updateMatchInfo();
  }

  // 무료 무기 상점 (B, 건게임 제외)
  toggleShop() {
    const el = document.getElementById('shop');
    if (!el) return;
    if (this.room.mode === 'gungame' && !this.hasOpGun && !this.hasMadGun && !this.isAdmin) { this.feed('건게임에선 상점 사용 불가!'); return; }
    if (el.classList.contains('hidden')) {
      document.exitPointerLock(); this.buildShop(); el.classList.remove('hidden');
    } else { el.classList.add('hidden'); this.canvas.requestPointerLock(); }
  }
  buildShop() {
    const grid = document.getElementById('shop-grid');
    grid.innerHTML = WEAPONS.map((w, i) => {
      const locked = (w.op && !this.hasOpGun) || (w.mad && !this.hasMadGun) || (w.armor && !this.isAdmin);
      const label = w.op ? '즉사 · 무한탄 · 관통 · 벽무시 · 🛡장착중무적'
        : w.mad ? '🐴 갈색 조랑말 · 즉사 · 적팀전원처형'
        : w.armor ? '🛡 무적 · 개뇌절개 · 초딩개잼'
        : (w.melee ? `근접 ${w.dmg} · 사거리 ${w.range}m` : `대미지 ${w.dmg} · ${w.pellets ? w.pellets + '펠릿' : w.mag + '발'}`);
      const tag = locked ? '🔒 전용' : (w.op ? '👑 전용' : w.mad ? '🐴 전용' : w.armor ? '⭐ 관리자' : 'FREE');
      const key = w.op ? 'O' : w.mad ? 'H' : w.armor ? 'U' : (i === 9 ? 0 : i + 1);
      return `<div class="shop-item${i === this.wi ? ' active' : ''}${locked ? ' locked' : ''}" data-s="${i}"><b>[${key}] ${w.id}</b><span>${label}</span><em>${tag}</em></div>`;
    }).join('');
    grid.querySelectorAll('.shop-item').forEach(it => it.onclick = (e) => {
      e.stopPropagation();
      const i = parseInt(it.dataset.s);
      if ((WEAPONS[i].op && !this.hasOpGun) || (WEAPONS[i].mad && !this.hasMadGun) || (WEAPONS[i].armor && !this.isAdmin)) { Sfx.dry(); this.feed('🔒 전용 무기입니다'); return; }
      this.ammo[i] = { mag: WEAPONS[i].mag, reserve: WEAPONS[i].reserve };
      this.reloading = false;
      this.switchWeapon(i); Sfx.capture(); this.buildShop();
    });
  }

  toggleChat() {
    const inp = document.getElementById('chat-input');
    if (!this.chatOpen) { document.exitPointerLock(); inp.classList.remove('hidden'); inp.focus(); this.chatOpen = true; }
  }

  switchWeapon(i) {
    if (this.room.mode === 'gungame' && !this.hasOpGun && !this.hasMadGun && !this.isAdmin) return; // 건게임은 킬 진도로 고정 (전용총 보유자는 예외)
    if (i === OP_INDEX && !this.hasOpGun) { Sfx.dry(); this.feed('🔒 전용 무기입니다'); return; }
    if (i === MAD_INDEX && !this.hasMadGun) { Sfx.dry(); this.feed('🔒 전용 무기입니다'); return; }
    if (i === ARMOR_INDEX && !this.isAdmin) { Sfx.dry(); this.feed('🔒 관리자 전용입니다'); return; }
    if (this.reloading || i === this.wi || i < 0 || i >= WEAPONS.length) return;
    this.wi = i; this.vmSwitchT = 0.28; this.gatSpin = 0; this.gatLast = 0;
    this.vmGuns.forEach((g, k) => g.visible = k === i);
    this.updateVmFlashPos(); this.updateHUD(); Sfx.reload();
  }
  reload() {
    const w = WEAPONS[this.wi], a = this.ammo[this.wi];
    if (w.melee || w.op || w.mad || w.armor) return; // 전용총은 재장전 불필요 (무한탄)
    if (this.reloading || a.mag === w.mag || a.reserve <= 0) { if (a.mag === 0 && a.reserve <= 0) Sfx.dry(); return; }
    this.reloading = true;
    Sfx.reload();
    this.vmReloadDur = w.id === 'RPG' ? 3000 : w.id === 'AWP' ? 2500 : 1500;
    this.vmReloadStart = performance.now();
    const tok = ++this.reloadSeq;
    setTimeout(() => {
      if (tok !== this.reloadSeq || this.disposed) return; // 도중 부활/교체되면 무효
      const need = w.mag - a.mag, take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take; this.reloading = false; this.updateHUD();
    }, this.vmReloadDur);
  }

  // 1인칭 뷰모델 애니: 걷기흔들림+장전+교체+조준 (반동 없음)
  updateViewmodel(dt, now) {
    if (!this.vmRig) return;
    const moving = this.isMoving && this.alive && document.pointerLockElement === this.canvas;
    const airborne = !this.grounded;
    const sprint = this.keys.ShiftLeft || this.keys.ShiftRight;
    if (moving && !airborne) this.vmBob += dt * (sprint ? 11 : 8);
    const adsT = this.aiming ? 1 : 0;
    this.vmAdsK += (adsT - this.vmAdsK) * Math.min(1, dt * 10);
    const k = this.vmAdsK;
    const bobA = 0.014 * (1 - k * 0.8);
    const bx = Math.sin(this.vmBob) * bobA, by = Math.abs(Math.cos(this.vmBob)) * bobA * 1.2;
    // 장전 진행도
    let relDip = 0, relTilt = 0;
    if (this.reloading && this.vmReloadStart > 0) {
      const t = Math.min(1, (now - this.vmReloadStart) / this.vmReloadDur);
      relDip = Math.sin(t * Math.PI) * 0.16; relTilt = Math.sin(t * Math.PI) * 0.55;
    }
    // 교체 딥
    if (this.vmSwitchT > 0) this.vmSwitchT -= dt;
    const swDip = this.vmSwitchT > 0 ? Math.sin((this.vmSwitchT / 0.28) * Math.PI) * 0.12 : 0;
    // 착지·투척·베기 모션
    if (this.vmLand > 0) this.vmLand = Math.max(0, this.vmLand - dt * 4);
    if (this.vmThrow > 0) this.vmThrow = Math.max(0, this.vmThrow - dt * 3);
    if (this.vmSwipe > 0) this.vmSwipe = Math.max(0, this.vmSwipe - dt * 3);
    const landDip = this.vmLand * 0.09;
    const throwDip = this.vmThrow > 0 ? Math.sin((1 - this.vmThrow / 0.3) * Math.PI) * 0.1 : 0;
    const swipeK = this.vmSwipe > 0 ? Math.sin((1 - this.vmSwipe / 0.32) * Math.PI) : 0;
    // 전력질주 시 총 내리기
    const sprinting = moving && (this.keys.ShiftLeft || this.keys.ShiftRight) && !this.aiming;
    this.vmSprintK += ((sprinting ? 1 : 0) - this.vmSprintK) * Math.min(1, dt * 8);
    // 슬라이드 보간 (급정지 방지)
    this.slideK += ((this.sliding ? 1 : 0) - this.slideK) * Math.min(1, dt * 11);
    const sk = this.slideK;
    // 이모트 상태 (L = 엘을 가져가)
    if (this.emoteT > 0) { this.emoteT = Math.max(0, this.emoteT - dt); if (this.emoteT === 0) this.emote = ''; }
    const emoting = this.emote === 'L' && this.emoteT > 0 && this.alive;
    // 위치: 힙↔조준 보간 + 밥 + 딥
    this.vmRig.position.lerpVectors(this.vmHipPos, this.vmAdsPos, k);
    this.vmRig.position.x += bx - sk * 0.05;
    this.vmRig.position.y += by - relDip - swDip - landDip - throwDip - this.vmSprintK * 0.05 - sk * 0.06;
    this.vmRig.position.z += sk * 0.04;
    this.vmRig.rotation.x = -relTilt - (this.vmSwitchT > 0 ? 0.35 * Math.sin((this.vmSwitchT / 0.28) * Math.PI) : 0) - this.vmSprintK * 0.25 + sk * 0.42;
    this.vmRig.rotation.y = swipeK * 0.6 - sk * 0.18;
    this.vmRig.rotation.z = Math.sin(this.vmBob * 0.5) * 0.008 + sk * 0.2;
    // 무기 검사(Inspect): 총을 돌려 단면 보여주기
    const gun = this.vmGuns[this.wi];
    if (this.inspectT > 0) this.inspectT = Math.max(0, this.inspectT - dt);
    if (gun) {
      if (this.inspectT > 0) {
        const arc = Math.sin((1 - this.inspectT / 1.6) * Math.PI);
        gun.rotation.set(arc * 0.85, arc * 1.5, arc * 0.45);
        gun.position.set(arc * 0.04, -arc * 0.03, arc * 0.06);
      } else if (gun.rotation.x !== 0 || gun.rotation.y !== 0 || gun.rotation.z !== 0 || gun.position.z !== -0.12) {
        gun.rotation.set(0, 0, 0); gun.position.set(0, -0.05, -0.12);
      }
      // 미친말총(갈색 조랑말) 전용 애니: 보행 + 꼬리 + 고개 + 발사 시 앞발 들기
      const legs = gun.userData.legs;
      if (legs && legs.length) {
        const run = moving && this.alive ? 1 : 0;
        this.ponyPh = (this.ponyPh || 0) + dt * (run ? 9 : 2.2);
        for (let i = 0; i < legs.length; i++) {
          const s = Math.sin(this.ponyPh + (i % 2) * Math.PI + Math.floor(i / 2) * Math.PI);
          legs[i].hip.rotation.x = s * (run ? 0.55 : 0.05);
          legs[i].knee.rotation.x = -Math.max(0, -s) * (run ? 0.7 : 0.08);
        }
        if (this.vmPonyKick > 0) this.vmPonyKick = Math.max(0, this.vmPonyKick - dt * 5);
        const kick = this.vmPonyKick;
        gun.userData.neck.rotation.x = -kick * 0.55 + Math.sin(this.ponyPh * 0.6) * 0.05;
        gun.userData.head.rotation.x = Math.sin(this.ponyPh * 0.6 + 1) * 0.06 + kick * 0.35;
        gun.userData.tail.rotation.x = Math.sin(this.ponyPh * 0.45) * 0.45;
        gun.userData.tail.rotation.z = Math.cos(this.ponyPh * 0.33) * 0.3;
        if (kick > 0) { gun.rotation.x -= kick * 0.45; gun.rotation.z = Math.sin(kick * 22) * 0.12; }
      }
    }
    // 이모트 표시: 총·팔 숨기고 L 제스처 표시
    this.vmGuns.forEach((g, k2) => { g.visible = (k2 === this.wi) && !emoting; });
    this.vmArmL.visible = !emoting; this.vmArmR.visible = !emoting;
    this.vmLpose.visible = emoting;
    if (emoting) {
      // 실제 'Take The L' 동작: 팔 앞으로 뻗어 손을 아래로 가리키며 좌우 흔들고 손목을 천천히 회전
      const tb = now / 1000;
      const age = 2.4 - this.emoteT;                      // 이모트 경과시간
      const intro = Math.min(1, age / 0.18);              // 등장 (처음엔 총자리에 있다 밀려나옴)
      const out = Math.min(1, this.emoteT / 0.22);         // 퇴장
      const ease = intro * out;
      const bob = Math.sin(tb * 5.5);
      const wob = Math.sin(tb * 2.2);
      this.vmLpose.position.set(
        0.2 - 0.1 * ease + bob * 0.018,
        -0.34 + 0.07 * ease + bob * 0.022,
        -0.34 - 0.12 * ease
      );
      this.vmLpose.rotation.set(
        -0.15 - 0.25 * ease + bob * 0.04,
        0.1 + 0.25 * ease + wob * 0.07,
        0.18 - 0.1 * ease + bob * 0.06
      );
      // 손목: 처음엔 펴졌다가 꺾이며 L 모양 완성 + 미세 흔들림
      this.vmLHand.rotation.set(
        -0.9 * (1 - ease),
        0.15 * ease + Math.sin(tb * 5.5) * 0.05,
        0.55 * (1 - ease) - wob * 0.12 * ease
      );
    }
    // 섬광 감쇠 + 랜덤 회전 + 게틀링 총열 회전
    if (this.vmFlashT > 0) {
      this.vmFlashT -= dt;
      this.vmFlashMesh.visible = true;
      this.vmFlashMesh.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.6; this.vmFlashMesh.scale.set(s, s, 1);
      this.flash.intensity = 2.5;
    } else { this.vmFlashMesh.visible = false; this.flash.intensity = 0; }
    const bg = this.vmGuns[this.wi] && this.vmGuns[this.wi].userData.barrels;
    if (bg && this.firing && (this.gatSpin || 0) > 0.05) bg.rotation.z += dt * 28;
    // 조준 시 팔 모으기
    this.vmArmL.rotation.y += ((k > 0.5 ? 0.12 : 0.3) - this.vmArmL.rotation.y) * Math.min(1, dt * 8);
    this.vmArmR.rotation.y += ((k > 0.5 ? -0.1 : -0.26) - this.vmArmR.rotation.y) * Math.min(1, dt * 8);
  }

  // 전용 무기 보유 여부 (서버 권한 플래그)
  setSpecialGuns(flags) {
    this.hasOpGun = !!(flags && flags.op);
    this.hasMadGun = !!(flags && flags.mad);
    this.isAdmin = !!(flags && flags.admin);
    // 권한 없는 전용 무기 equips 차단 + 회수
    if (!this.hasOpGun && this.wi === OP_INDEX) this.wi = 0;
    if (!this.hasMadGun && this.wi === MAD_INDEX) this.wi = 0;
    if (!this.isAdmin && this.wi === ARMOR_INDEX) this.wi = 0;
    if (this.vmGuns) {
      this.vmGuns.forEach((g, k) => { g.visible = k === this.wi; });
      this.updateVmFlashPos();
    }
    this.updateHUD();
  }
  // 이모트: L = "엘을 가져가" (검지 아래 + 엄지 옆 L 모양)
  playEmote(name) {
    if (!this.alive || document.pointerLockElement !== this.canvas) return;
    if (this.emoteT > 0.4) return; // 연속 spam 방지
    this.emote = name; this.emoteT = 2.4; this.emoteId++;
    this.reloading = false; this.aiming = false; this.firing = false;
    Sfx.beep();
    this.feed('👌 엘을 가져가!');
  }
  // 무기 검사 애니메이션 (F)
  startInspect() {
    if (!this.alive || this.emoteT > 0) return;
    if (this.inspectT > 0) return;
    this.inspectT = 1.6;
    Sfx.tone(420, 0.05, 'triangle', 0.12, 700);
  }
  // 슬라이드 종료
  endSlide() {
    if (!this.sliding) return;
    this.sliding = false; this.slideT = 0; this.slideSpeed = 0;
  }

  // 수류탄 (G): 포물선 투척 → 2초 신관 → 범위 피해
  throwGrenadeMine() {
    if (!this.alive || document.pointerLockElement !== this.canvas) return;
    if (this.nades <= 0) { Sfx.dry(); this.feed('수류탄 없음! (부활 시 보급)'); return; }
    this.nades--;
    this.vmThrow = 0.3;
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const from = this.camera.position.clone().addScaledVector(dir, 0.6); from.y -= 0.1;
    const vel = dir.clone().multiplyScalar(14); vel.y += 3.5;
    this.spawnNade(from, vel, true);
    this.socket.emit('player:throw', { from: { x: from.x, y: from.y, z: from.z }, vel: { x: vel.x, y: vel.y, z: vel.z } });
    Sfx.noise(0.08, 0.15, 1500);
    this.updateHUD();
  }
  spawnNade(from, vel, mine) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2a4a22 }));
    mesh.position.copy(from); this.scene.add(mesh);
    this.nadeList.push({ mesh, vel: vel.clone(), fuse: 2.0, mine });
  }
  updateNades(dt) {
    for (let i = this.nadeList.length - 1; i >= 0; i--) {
      const n = this.nadeList[i];
      n.fuse -= dt;
      n.vel.y -= 16 * dt;
      const p = n.mesh.position;
      const nx = p.x + n.vel.x * dt;
      if (!this.pointHits(nx, p.y, p.z, 0.15)) p.x = nx; else n.vel.x *= -0.35;
      const nz = p.z + n.vel.z * dt;
      if (!this.pointHits(p.x, p.y, nz, 0.15)) p.z = nz; else n.vel.z *= -0.35;
      p.y += n.vel.y * dt;
      if (p.y < 0.12) { p.y = 0.12; n.vel.y *= -0.35; n.vel.x *= 0.7; n.vel.z *= 0.7; }
      if (Math.abs(n.vel.y) < 0.4 && p.y <= 0.13) n.vel.y = 0;
      if (n.fuse <= 0) { this.scene.remove(n.mesh); this.nadeList.splice(i, 1); this.explodeNade(p.clone(), n.mine); }
    }
  }
  explodeNade(pos, mine) {
    pos.y = Math.max(0.5, pos.y);
    this.spawnSparks(pos, 0xff6622, 14);
    this.spawnSparks(pos, 0xffcc44, 8);
    if (this.vmFlashMesh) { /* 폭발광은 스파크+사운드로 대체 */ }
    Sfx.explode();
    const d0 = this.pos.distanceTo(pos);
    this.shake = Math.min(1, this.shake + Math.max(0, 0.6 - d0 * 0.03));
    if (!mine) return;
    for (const [name, r] of this.remotes) { // 봇 로컬 판정
      if (!r.alive || r.team === this.team || !r.isBot) continue;
      const d = r.mesh.position.distanceTo(pos);
      if (d < 9) this.damageBot(name, r, Math.max(15, Math.round(110 * (1 - d / 10))), `${this.nick} [수류탄💣]`);
    }
    this.socket.emit('player:blast', { pos: { x: pos.x, y: pos.y, z: pos.z } });
    if (this.room.mode === 'operation') { // 목표물 추가 피해
      const d2 = new THREE.Vector3(pos.x, 0, pos.z).distanceTo(new THREE.Vector3(60, 0, -60));
      if (d2 < 10) this.socket.emit('objective:damage', { amount: Math.max(30, Math.round(150 * (1 - d2 / 12))) });
    }
    if (d0 < 6 && this.alive) { // 자폭 피해 → 서버 판정 (로컬 중복집계 방지)
      this.socket.emit('player:selfhit', { damage: Math.round(50 * (1 - d0 / 7)), weapon: '수류탄💣' });
    }
  }

  // E 상호작용: 거점 점령 / 폭탄 설치·해체 / 목표물 타격
  interact() {
    if (!this.alive) return;
    if (this.room.mode === 'conquest') {
      for (const [id, f] of Object.entries(this.flags)) {
        if (this.pos.distanceTo(f.pos) < 5) { this.socket.emit('flag:capture', { flag: id }); this.log(`거점 ${id} 점령 시도!`); }
      }
    }
    if (this.room.mode === 'defuse') {
      if (this.team === 'T') {
        if (this.serverState && this.serverState.bomb && this.serverState.bomb.planted) return;
        for (const [id, s] of Object.entries(this.bombSites))
          if (this.pos.distanceTo(s.pos) < 5) { this.socket.emit('bomb:plant', { site: id }); }
      } else if (this.bombPlantedPos && this.pos.distanceTo(this.bombPlantedPos) < 4) {
        Sfx.beep(); // 실제 해체는 E 홀드 3초 (루프에서 진행)
      }
    }
    if (this.room.mode === 'operation' && this.objective) {
      const op = new THREE.Vector3(60, 0, -60);
      if (this.pos.distanceTo(op) < 12) { this.socket.emit('objective:damage', { amount: 100 }); this.log('💥 목표물에 폭약 설치!'); }
    }
  }

  // 원격 패킷 검증 (NaN/비정상 좌표 차단)
  validVec(v) { return v && isFinite(v.x + v.y + v.z); }
  validPos(p) { return p && isFinite(p.x + p.y + p.z); }

  // ================= 소켓 =================
  bindSocket() {
    const s = this.socket;
    s.off('player:move'); s.off('player:killed'); s.off('player:damaged');
    s.off('room:players'); s.off('game:tick'); s.off('game:over');
    s.off('bomb:planted'); s.off('bomb:defused'); s.off('bomb:exploded');
    s.off('chat:msg'); s.off('player:respawned'); s.off('player:left'); s.off('round:next');
    s.off('player:shot'); s.off('game:reset'); s.off('player:nade'); s.off('round:end'); s.off('player:rocketfly');

    s.on('player:rocketfly', (d) => {
      if (!d || !d.from || !d.vel || d.nickname === this.nick) return;
      if (!this.validVec(d.from) || !this.validVec(d.vel)) return;
      this.spawnRocket(new THREE.Vector3(d.from.x, d.from.y, d.from.z), new THREE.Vector3(d.vel.x, d.vel.y, d.vel.z), false);
    });

    s.on('player:nade', (d) => {
      if (!d || !d.from || !d.vel || d.nickname === this.nick) return;
      if (!this.validVec(d.from) || !this.validVec(d.vel)) return;
      this.spawnNade(new THREE.Vector3(d.from.x, d.from.y, d.from.z), new THREE.Vector3(d.vel.x, d.vel.y, d.vel.z), false);
    });

    s.on('player:shot', (d) => {
      if (!d || d.nickname === this.nick) return;
      const r = this.remotes.get(d.nickname);
      if (r && r.alive) r.flashT = 0.09;
    });

    s.on('room:players', (list) => {
      if (!Array.isArray(list)) return;
      const seen = new Set();
      list.forEach(p => {
        if (!p || typeof p.nickname !== 'string' || !this.validPos(p.pos)) return;
        const cx = Math.max(-160, Math.min(160, p.pos.x)), cz = Math.max(-160, Math.min(160, p.pos.z));
        if (p.nickname === this.nick) { this.hp = p.hp; this.alive = p.alive; if (!p.alive) this.onDeath(false); return; }
        seen.add(p.nickname);
        if (!this.remotes.has(p.nickname)) {
          const nr = this.makeRemoteMesh(p, p.nickname);
          nr.mesh.position.set(cx, p.fy || 0, cz); nr.lastPos.copy(nr.mesh.position);
          this.remotes.set(p.nickname, nr);
        }
        const r = this.remotes.get(p.nickname);
        r.targetPos = new THREE.Vector3(cx, p.fy || 0, cz); r.yaw = p.yaw; r.team = p.team;
        r.targetPitch = p.pitch || 0; r.crouch = !!p.crouch; r.sliding = !!p.sl;
        this.applyRemoteEmote(r, p.eid);
        if (p.wi !== undefined) this.setSoldierGun(r, p.wi);
        if (r.hp !== p.hp) { r.hp = p.hp; this.drawNameplate(r.plate, p.nickname, p.team === this.team, p.hp); }
        r.kills = p.kills || 0; r.deaths = p.deaths || 0;
        this.setRemoteAlive(r, p.alive);
      });
      for (const [k, r] of this.remotes) if (!seen.has(k) && !r.isBot) { this.scene.remove(r.mesh); this.remotes.delete(k); }
      this.drawScoreboard();
    });

    s.on('player:move', (p) => {
      if (!p || p.nickname === this.nick || !this.validPos(p.pos)) return;
      const cx = Math.max(-160, Math.min(160, p.pos.x)), cz = Math.max(-160, Math.min(160, p.pos.z));
      if (!this.remotes.has(p.nickname)) {
        const nr = this.makeRemoteMesh(p, p.nickname);
        nr.mesh.position.set(cx, 0, cz); nr.lastPos.copy(nr.mesh.position);
        this.remotes.set(p.nickname, nr);
      }
      const r = this.remotes.get(p.nickname);
      r.targetPos = new THREE.Vector3(cx, p.fy || 0, cz); r.yaw = p.yaw;
      r.targetPitch = p.pitch || 0; r.crouch = !!p.crouch; r.sliding = !!p.sl;
      this.applyRemoteEmote(r, p.eid);
      if (p.wi !== undefined) this.setSoldierGun(r, p.wi);
      if (r.hp !== p.hp) { r.hp = p.hp; this.drawNameplate(r.plate, p.nickname, r.team === this.team, p.hp); }
      this.setRemoteAlive(r, p.alive);
    });

    s.on('player:killed', (d) => {
      this.firstBloodCheck(d.killer, d.victim);
      this.feed(`☠ ${d.killer} [${d.weapon || ''}] → ${d.victim}`);
      if (d.victim === this.nick) { this.deaths++; this.onDeath(true, { nickname: d.killer, weapon: d.weapon }); Sfx.lose(); }
      if (d.killer === this.nick && d.victim !== this.nick) {
        this.kills++; this.money += 300; this.updateHUD(); Sfx.kill();
        this.onMyKill();
        this.showKillBanner(d.victim, d.weapon);
      }
    });
    s.on('player:damaged', (d) => {
      if (!d) return;
      if (d.blocked) { // 관리자 무적갑옷 방어 성공
        if (d.target === this.nick) this.feed('🛡 무적갑옷이 공격을 막았습니다!');
        else if (d.attacker === this.nick) { Sfx.tone(320, 0.1, 'square', 0.2, 160); this.feed('🛡 상대가 무적이라 통통함!'); }
        return;
      }
      if (d.target === this.nick) {
        this.hp = d.hp; this.updateHUD(); this.flashDamage(); Sfx.hurt(); this.shake = Math.min(0.6, this.shake + 0.3);
        this.showDamageDir(d.attacker);
        if (d.stun) { this.stunT = 2.2; Sfx.zap(); this.feed('⚡ 감전! 2초간 둔화'); }
      }
      else { const r = this.remotes.get(d.target); if (r) { r.hitT = 0.12; if (r.hp !== d.hp) { r.hp = d.hp; this.drawNameplate(r.plate, d.target, r.team === this.team, d.hp); } } }
    });
    s.on('player:respawned', (d) => {
      if (d.nickname === this.nick) { this.deathSeq++; this.reviveLocal(); }
      else { const r = this.remotes.get(d.nickname); if (r) this.setRemoteAlive(r, true); }
    });
    s.on('player:left', (d) => { const r = this.remotes.get(d.nickname); if (r && !r.isBot) { this.scene.remove(r.mesh); this.remotes.delete(d.nickname); } this.feed(`◀ ${d.nickname} 퇴장`); });

    s.on('game:tick', (d) => { this.serverState = d.state; this.updateMatchInfo(); });
    s.on('game:reset', (d) => { if (d) this.serverState = d.state; this.resetMatch(true); });
    s.on('game:over', (d) => {
      this.serverState = d.state;
      const ov = document.getElementById('round-overlay');
      let txt = d.winnerNick ? `🏆 ${d.winnerNick} 우승! (${d.reason})` : `🏆 ${d.winner} 승리! (${d.reason})`;
      const mine = (d.ratingChanges || []).find(c => c.nickname === this.nick);
      if (d.ranked && mine) txt += ` | 레이팅 ${mine.delta > 0 ? '+' : ''}${mine.delta} → ${mine.rating} (${mine.tier})`;
      else if (d.ranked) txt += ' | [경쟁전 정산됨]';
      if (d.mvp) txt += ` | 🌟 MVP ${d.mvp.nickname} (${d.mvp.kills}킬)`;
      ov.textContent = txt; ov.classList.remove('hidden');
      setTimeout(() => ov.classList.add('hidden'), 6000);
      this.feed(txt);
      // 한판 종료 화면 (개인전/건게임은 닉네임 우승)
      const won = d.winnerNick ? d.winnerNick === this.nick : d.winner === this.team;
      if (won) Sfx.win(); else if (d.winner && d.winner !== 'draw') Sfx.lose();
      document.getElementById('me-title').textContent = d.winner === 'draw' ? '🤝 무승부!' : won ? '🏆 승리!' : '💀 패배...';
      let sub = d.reason || '';
      if (d.mvp) sub += ` · 🌟 MVP ${d.mvp.nickname} (${d.mvp.kills}킬)`;
      if (d.ranked && mine) sub += ` · 레이팅 ${mine.delta > 0 ? '+' : ''}${mine.delta} → ${mine.rating} (${mine.tier})`;
      document.getElementById('me-sub').textContent = sub;
      document.getElementById('me-stats').textContent = `나의 전적: ${this.kills}킬 / ${this.deaths}데스`;
      document.getElementById('match-end').classList.remove('hidden');
      document.exitPointerLock();
    });
    s.on('round:next', (d) => {
      this.serverState = d.state; this.resetMatch(false);
      document.getElementById('match-end').classList.add('hidden');
      const ov = document.getElementById('round-overlay');
      ov.textContent = `― ROUND ${d.state.round} ―`; ov.classList.remove('hidden');
      setTimeout(() => ov.classList.add('hidden'), 2500);
      this.updateMatchInfo();
    });
    s.on('round:end', (d) => { // 전멸 라운드 종료 예고 (3초 뒤 round:next)
      const ov = document.getElementById('round-overlay');
      ov.textContent = d.winner === 'draw' ? `💀 양 팀 전멸!` : `💀 ${d.winner} 승리! (${d.reason})`;
      ov.classList.remove('hidden');
      setTimeout(() => ov.classList.add('hidden'), 2800);
      this.feed(ov.textContent);
    });
    s.on('bomb:planted', (d) => {
      this.serverState = d.state;
      const site = this.bombSites[d.site];
      this.bombPlantedPos = site ? site.pos.clone() : this.pos.clone();
      this.feed(`💣 ${d.by}이(가) ${d.site}에 폭탄 설치! (40초)`);
      Sfx.beep();
      // 폭탄 모델
      if (this.bombMesh) this.scene.remove(this.bombMesh);
      this.bombMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.3), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      this.bombMesh.position.copy(this.bombPlantedPos).setY(0.5); this.scene.add(this.bombMesh);
      // 폭탄 삐 소리 (10초 간격... 매초는 시끄러우니 5회)
      for (let i = 1; i <= 5; i++) setTimeout(() => Sfx.beep(), i * 1000);
      this.updateMatchInfo();
    });
    s.on('bomb:defused', (d) => {
      this.serverState = d.state; this.bombPlantedPos = null; this.defuseP = 0;
      if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
      this.feed(`🛡 ${d.by} 해체 성공! CT +1`); this.updateMatchInfo(); Sfx.capture();
    });
    s.on('bomb:exploded', (d) => {
      this.serverState = d.state; this.bombPlantedPos = null; this.defuseP = 0;
      if (this.bombMesh) { this.scene.remove(this.bombMesh); this.bombMesh = null; }
      this.feed(`💥 폭탄 폭발! T +1`); this.updateMatchInfo(); Sfx.explode();
      this.shake = Math.min(1, this.shake + 0.5);
    });
    s.on('chat:msg', (d) => {
      this.log(d.sys ? d.text : `[${d.team}] ${d.nickname}: ${d.text}`, d.sys);
      if (d.sys && /점령/.test(d.text || '')) Sfx.capture();
    });
  }

  // 머리 위 네임택 (닉네임 + 체력바 스프라이트)
  makeNameplate(nickname, friendly, hp) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    spr.scale.set(1.7, 0.42, 1); spr.position.y = 2.3;
    const plate = { canvas, tex, sprite: spr };
    this.drawNameplate(plate, nickname, friendly, hp);
    return plate;
  }
  drawNameplate(plate, nickname, friendly, hp) {
    const ctx = plate.canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = `bold ${nickname.length > 8 ? 24 : 30}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    const col = friendly ? '#7dd8ff' : '#ff7777';
    ctx.strokeText(nickname, 128, 32);
    ctx.fillStyle = col; ctx.fillText(nickname, 128, 32);
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(68, 40, 120, 10);
    ctx.fillStyle = hp > 50 ? '#4caf50' : hp > 25 ? '#ffaa00' : '#ff3333';
    ctx.fillRect(68, 40, 120 * Math.max(0, hp) / 100, 10);
    plate.tex.needsUpdate = true;
  }

  // 관절형 병사 모델 (두부/몸통/팔2×2관절/다리2×2관절 + 장비)
  makeRemoteMesh(p, nickname = '?') {
    const friendly = (p.team === 'alpha' || p.team === 'CT');
    const uni = friendly ? 0x2e4a68 : 0x6e3a2a;      // 전투복
    const vestC = friendly ? 0x1d2c40 : 0x40231a;    // 방탄복
    const helmC = friendly ? 0x24344a : 0x4a2c1c;    // 헬멧
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const uniM = new THREE.MeshLambertMaterial({ color: uni });
    const vestM = new THREE.MeshLambertMaterial({ color: vestC });
    const helmM = new THREE.MeshLambertMaterial({ color: helmC });
    const darkM = new THREE.MeshLambertMaterial({ color: 0x191919 });
    const bootM = new THREE.MeshLambertMaterial({ color: 0x2c2318 });

    const root = new THREE.Group();
    const B = (w, h, d, m, x, y, z) => {
      const ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      ms.position.set(x, y, z); ms.castShadow = true; return ms;
    };
    // 골반/다리
    root.add(B(0.34, 0.2, 0.22, uniM, 0, 0.95, 0));
    const mkLeg = (sx) => {
      const hip = new THREE.Group(); hip.position.set(0.12 * sx, 0.88, 0); root.add(hip);
      hip.add(B(0.15, 0.42, 0.16, uniM, 0, -0.21, 0));
      const knee = new THREE.Group(); knee.position.set(0, -0.42, 0); hip.add(knee);
      knee.add(B(0.13, 0.38, 0.14, uniM, 0, -0.19, 0));
      knee.add(B(0.14, 0.1, 0.26, bootM, 0, -0.42, -0.05)); // 군화 (앞코가 전방)
      return { hip, knee };
    };
    const legL = mkLeg(-1), legR = mkLeg(1);
    // 몸통 리그
    const torsoG = new THREE.Group(); torsoG.position.set(0, 1.05, 0); root.add(torsoG);
    torsoG.add(B(0.42, 0.6, 0.26, uniM, 0, 0.3, 0));
    torsoG.add(B(0.44, 0.3, 0.32, vestM, 0, 0.32, 0));       // 방탄복
    torsoG.add(B(0.3, 0.4, 0.14, vestM, 0, 0.3, 0.2));       // 백팩
    torsoG.add(B(0.1, 0.08, 0.05, darkM, -0.12, 0.42, -0.17)); // 가슴 장비
    // 머리
    const headG = new THREE.Group(); headG.position.set(0, 0.68, 0); torsoG.add(headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), skin);
    head.position.y = 0.08; head.castShadow = true; headG.add(head);
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.175, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), helmM);
    helm.position.y = 0.1; helm.castShadow = true; headG.add(helm);
    headG.add(B(0.2, 0.06, 0.04, darkM, 0, 0.08, -0.14));    // 고글/바이저
    // 팔 (어깨→팔꿈치 2관절)
    const mkArm = (sx) => {
      const sh = new THREE.Group(); sh.position.set(0.27 * sx, 0.52, 0); torsoG.add(sh);
      sh.add(B(0.11, 0.32, 0.12, uniM, 0, -0.16, 0));
      const el = new THREE.Group(); el.position.set(0, -0.32, 0); sh.add(el);
      el.add(B(0.1, 0.3, 0.11, uniM, 0, -0.15, 0));
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), skin);
      hand.position.set(0, -0.32, 0); el.add(hand);
      // '엘을 가져가' 제스처용 L손 (검지 아래 + 엄지 옆, 기본 숨김)
      const lhand = new THREE.Group();
      lhand.position.set(0, -0.32, 0); lhand.visible = false; el.add(lhand);
      const lf = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.03), skin);
      lf.position.set(0, -0.115, 0); lhand.add(lf);
      const lt = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.032, 0.032), skin);
      lt.position.set(-0.062, 0, 0); lhand.add(lt);
      return { sh, el, hand, lhand };
    };
    const armL = mkArm(-1), armR = mkArm(1);
    // 소총 (가슴 전방): 든 무기별 외형 전환
    const silverM = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
    const gunG = new THREE.Group(); gunG.position.set(0.14, 0.28, -0.4); torsoG.add(gunG);
    const mkV = (fn) => { const v = new THREE.Group(); fn(v); v.visible = false; gunG.add(v); return v; };
    const vb = (grp, w, h, d, m, x, y, z) => { const ms = B(w, h, d, m, x, y, z); grp.add(ms); return ms; };
    const gunMeshes = {
      rifle: mkV(v => { vb(v, 0.07, 0.11, 0.7, darkM, 0, 0, -0.1); const mg = vb(v, 0.05, 0.14, 0.08, darkM, 0, -0.1, 0.02); mg.rotation.x = 0.2; vb(v, 0.03, 0.05, 0.1, darkM, 0, 0.08, -0.05); }),
      smg: mkV(v => { vb(v, 0.06, 0.1, 0.45, darkM, 0, 0, -0.05); vb(v, 0.04, 0.13, 0.07, darkM, 0, -0.09, 0.05); }),
      shotgun: mkV(v => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), darkM); b.rotation.x = Math.PI / 2; b.position.set(0, 0.02, -0.2); b.castShadow = true; v.add(b); vb(v, 0.07, 0.08, 0.2, darkM, 0, -0.05, -0.1); }),
      sniper: mkV(v => { vb(v, 0.07, 0.11, 0.65, darkM, 0, 0, -0.15); const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 8), darkM); sc.rotation.x = Math.PI / 2; sc.position.set(0, 0.1, -0.1); v.add(sc); }),
      pistol: mkV(v => { vb(v, 0.06, 0.09, 0.28, silverM, 0, 0, -0.05); vb(v, 0.05, 0.12, 0.07, darkM, 0, -0.08, 0.06); }),
      knife: mkV(v => { vb(v, 0.04, 0.05, 0.14, darkM, 0, -0.05, 0.05); vb(v, 0.015, 0.045, 0.32, silverM, 0, -0.02, -0.2); }),
      rpg: mkV(v => { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.95, 8), darkM); t.rotation.x = Math.PI / 2; t.position.set(0, 0, -0.2); v.add(t); vb(v, 0.05, 0.12, 0.08, darkM, 0, -0.1, 0.0); }),
      taser: mkV(v => { const ym = new THREE.MeshLambertMaterial({ color: 0xd8b800 }); vb(v, 0.055, 0.085, 0.24, ym, 0, 0, -0.05); vb(v, 0.045, 0.11, 0.06, darkM, 0, -0.08, 0.05); }),
      lmg: mkV(v => { vb(v, 0.09, 0.12, 0.5, darkM, 0, 0, -0.1); vb(v, 0.07, 0.14, 0.12, darkM, 0, -0.11, 0.0); vb(v, 0.03, 0.03, 0.4, darkM, 0.03, 0.02, -0.4); vb(v, 0.03, 0.03, 0.4, darkM, -0.03, 0.02, -0.4); }),
      op: mkV(v => { const goldM = new THREE.MeshLambertMaterial({ color: 0xffd24a, emissive: 0x4a3200 }); const glowM = new THREE.MeshBasicMaterial({ color: 0x66f0ff }); vb(v, 0.08, 0.13, 0.5, goldM, 0, 0, -0.2); vb(v, 0.055, 0.05, 0.12, glowM, 0, 0.06, -0.22); vb(v, 0.07, 0.11, 0.18, goldM, 0, -0.02, 0.12); for (let b = 0; b < 3; b++) vb(v, 0.035, 0.035, 0.06, goldM, 0, 0.01, -0.5 - b * 0.08); }),
      pony: mkV(v => { const fur = new THREE.MeshLambertMaterial({ color: 0x8b5a2b }); const neon = new THREE.MeshBasicMaterial({ color: 0xff2fd0 }); vb(v, 0.16, 0.18, 0.4, fur, 0, 0, -0.04); vb(v, 0.11, 0.12, 0.22, fur, 0, 0.11, -0.3); vb(v, 0.12, 0.13, 0.2, fur, 0, 0.17, -0.5); vb(v, 0.085, 0.075, 0.11, fur, 0, 0.14, -0.62); vb(v, 0.05, 0.075, 0.05, neon, 0, 0.26, -0.48); vb(v, 0.06, 0.16, 0.05, neon, 0, 0.08, 0.19); for (let b = 0; b < 4; b++) vb(v, 0.05, 0.14, 0.05, fur, b % 2 ? 0.06 : -0.06, -0.16, b < 2 ? -0.14 : 0.13); }),
    };
    gunMeshes.rifle.visible = true;
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd050 }));
    muzzle.position.set(0, 0.01, -0.52); muzzle.visible = false; gunG.add(muzzle);
    // 팀 식별 견장
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02),
      new THREE.MeshBasicMaterial({ color: friendly ? 0x2255ff : 0xff3322 }));
    patch.position.set(-0.16, 0.5, -0.14); torsoG.add(patch);
    // 머리 위 네임택
    const plate = this.makeNameplate(String(nickname).slice(0, 12), p.team === this.team, 100);
    root.add(plate.sprite);

    this.scene.add(root);
    return {
      mesh: root, torsoG, headG, armL, armR, legL, legR, gunG, gunMeshes, muzzle, plate,
      mats: [uniM, vestM, helmM],
      targetPos: new THREE.Vector3(0, 0, 0), lastPos: new THREE.Vector3(0, 0, 0),
      yaw: 0, headPitch: 0, targetPitch: 0, gunIdx: 0,
      hp: 100, alive: true, team: p.team, isBot: false,
      kills: 0, deaths: 0,
      phase: Math.random() * 6, flashT: 0, deadT: 0, speed: 0, hitT: 0,
      sliding: false, emote: '', emoteT: 0, emoteId: 0
    };
  }

  // 병사 손 무기 전환 (M4/AK=rifle, MP5=smg, M870=shotgun, AWP=sniper, DEAGLE=pistol, KNIFE=knife, RPG=rpg, TASER=taser, GATLING=lmg)
  setSoldierGun(r, idx) {
    const map = ['rifle', 'rifle', 'smg', 'shotgun', 'sniper', 'pistol', 'knife', 'rpg', 'taser', 'lmg', 'op', 'pony'];
    const v = map[idx] || 'rifle';
    if (r.gunIdx === idx && r.gunMeshes[v].visible) return;
    r.gunIdx = idx;
    for (const k of Object.keys(r.gunMeshes)) r.gunMeshes[k].visible = (k === v);
  }

  // 원격 이모트 수신 (eid 증가분만 재생 → 20Hz 중계에서도 1회만)
  applyRemoteEmote(r, eid) {
    if (!eid || eid === r.emoteId) return;
    r.emoteId = eid; r.emote = 'L'; r.emoteT = 2.4;
  }

  // 사망 연출용 가시성 제어 (쓰러짐 1.2초 재생 후 숨김)
  setRemoteAlive(r, alive) {
    if (alive) { r.deadT = 0; r.mesh.visible = true; r.mesh.rotation.x = 0; r.mesh.position.y = 0; }
    else if (r.alive && !alive) { r.deadT = 1.2; r.mesh.visible = true; }
    else if (!alive && r.deadT <= 0) r.mesh.visible = false;
    r.alive = alive;
  }

  // 역동 인체 애니: 걷기(다리교대+팔흔들림) / 정지(호흡) / 조준(양팔전방) / 사망(뒤로쓰러짐) / 사격(총구섬광+반동)
  animateSoldier(r, dt, time) {
    const m = r.mesh;
    if (!r.alive) {
      if (r.deadT > 0) {
        r.deadT -= dt;
        m.rotation.x += ((-Math.PI / 2) - m.rotation.x) * Math.min(1, dt * 7);
        m.position.y += (0.25 - m.position.y) * Math.min(1, dt * 7);
        if (r.deadT <= 0) m.visible = false;
      }
      return;
    }
    m.rotation.x += (0 - m.rotation.x) * Math.min(1, dt * 10);
    m.position.y += (0 - m.position.y) * Math.min(1, dt * 10);
    // 이동 속도 측정
    const dx = m.position.x - r.lastPos.x, dz = m.position.z - r.lastPos.z;
    const spd = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    r.speed += (spd - r.speed) * Math.min(1, dt * 8);
    r.lastPos.copy(m.position);
    const moving = r.speed > 0.8;
    if (moving) r.phase += dt * (4 + r.speed * 1.1);
    const sw = moving ? Math.sin(r.phase) * Math.min(0.7, 0.3 + r.speed * 0.06) : 0;
    // 다리: 교대 스윙 + 무릎 굽힘 (무릎은 뒤꿈치 쪽(-X 회전)으로만 굽힘)
    r.legL.hip.rotation.x = sw; r.legR.hip.rotation.x = -sw;
    r.legL.knee.rotation.x = moving ? -(Math.max(0, -Math.sin(r.phase)) * 1.0) - 0.05 : -0.05;
    r.legR.knee.rotation.x = moving ? -(Math.max(0, Math.sin(r.phase)) * 1.0) - 0.05 : -0.05;
    // 팔: 기본 조준자세(전방) + 걷기 흔들림 + 호흡 (+X 회전이 전방)
    const breathe = Math.sin(time * 2 + r.phase) * 0.03;
    r.armL.sh.rotation.x = 1.0 + sw * 0.35 + breathe;
    r.armR.sh.rotation.x = 1.0 - sw * 0.35 + breathe;
    r.armL.sh.rotation.z = 0.25; r.armR.sh.rotation.z = -0.15;
    r.armL.el.rotation.x = -0.5; r.armR.el.rotation.x = -0.4;
    // 몸통: 전진 기울기 + 보행 상하 + 호흡
    r.torsoG.rotation.x = moving ? -0.09 : -0.02 + breathe * 0.4;
    r.torsoG.position.y = 1.05 + (moving ? Math.abs(Math.cos(r.phase)) * 0.045 : breathe * 0.5);
    // 머리: 진행방향 응시 + 상하 (상대가 보는 방향)
    r.headG.rotation.y *= 0.9;
    r.headPitch += ((r.targetPitch || 0) - r.headPitch) * Math.min(1, dt * 8);
    r.headG.rotation.x = r.headPitch * 0.5;
    // 점프 공중 자세 (히스테리시스로 깜빡임 방지)
    if (!r.airborne && m.position.y > 0.3) r.airborne = true;
    else if (r.airborne && m.position.y < 0.12) r.airborne = false;
    if (r.airborne) {
      r.legL.hip.rotation.x = -0.5; r.legR.hip.rotation.x = -0.25;
      r.legL.knee.rotation.x = -1.3; r.legR.knee.rotation.x = -1.1;
    }
    // 앉기 자세 (이동 중에도 굽힌 보행)
    if (r.crouch && r.alive) {
      r.torsoG.position.y = 0.72;
      r.torsoG.rotation.x = -0.28;
      r.legL.hip.rotation.x = -0.7 + sw * 0.5; r.legR.hip.rotation.x = -0.7 - sw * 0.5;
      r.legL.knee.rotation.x = -(1.4 + Math.max(0, -Math.sin(r.phase)) * 0.4);
      r.legR.knee.rotation.x = -(1.4 + Math.max(0, Math.sin(r.phase)) * 0.4);
    }
    // 슬라이드 자세 (몸 낮추고 다리 앞으로 뻗음)
    if (r.sliding && r.alive) {
      r.torsoG.position.y = 0.4;
      r.torsoG.rotation.x = -0.9;
      r.legL.hip.rotation.x = -1.3; r.legR.hip.rotation.x = -1.15;
      r.legL.knee.rotation.x = -0.2; r.legR.knee.rotation.x = -0.1;
      r.armL.sh.rotation.x = 0.3; r.armR.sh.rotation.x = 0.15;
      r.armL.sh.rotation.z = 0.45; r.armR.sh.rotation.z = -0.35;
      r.armL.el.rotation.x = -0.55; r.armR.el.rotation.x = -0.45;
    }
    // '엘을 가져가' 이모트 (오른팔 앞으로 뻗어 손등으로 아래를 가리킴)
    if (r.emoteT > 0) { r.emoteT = Math.max(0, r.emoteT - dt); if (r.emoteT === 0) r.emote = ''; }
    const rEmote = r.emote === 'L' && r.emoteT > 0 && r.alive;
    if (rEmote) {
      const b = Math.sin(time * 5.5) * 0.07;
      r.gunG.visible = false;
      // 위팔 앞쪽으로 + 전완 수직 아래로 (총 0.15rad ≈ 수직) → L 모양이 아래를 가리킴
      r.armR.sh.rotation.set(0.9 + b, -0.35, -0.55);
      r.armR.el.rotation.set(-0.75 + b * 0.5, 0, 0);
      r.armR.lhand.visible = true; r.armR.hand.visible = false;
      r.armL.sh.rotation.set(0.3, 0.25, 0.35);
      r.armL.el.rotation.set(-1.0, 0, 0);
      r.torsoG.rotation.x = -0.04;
      r.torsoG.position.y = 1.05;
      r.headG.rotation.x = -0.15;
    } else {
      if (r.gunG.visible === false) r.gunG.visible = true;
      if (r.armR.lhand.visible) { r.armR.lhand.visible = false; r.armR.hand.visible = true; }
    }
    r.plate.sprite.position.y += (((r.sliding && r.alive) ? 1.1 : (r.crouch && r.alive) ? 1.7 : 2.3) - r.plate.sprite.position.y) * Math.min(1, dt * 8);
    // 총구 섬광 + 총 반동
    if (r.flashT > 0) {
      r.flashT -= dt;
      r.muzzle.visible = true;
      r.muzzle.scale.setScalar(0.8 + Math.random() * 0.7);
      r.gunG.position.z = -0.4 + 0.05;
    } else { r.muzzle.visible = false; r.gunG.position.z += (-0.4 - r.gunG.position.z) * Math.min(1, dt * 12); }
    // 무적갑옷 장착(관리자 갑옷/OP총) 시 무지개 광택
    if ((r.wi === ARMOR_INDEX || r.wi === OP_INDEX) && r.hitT <= 0) {
      const hue = (time * 0.6) % 1;
      const pal = [0xff3060, 0xffc830, 0x40ff60, 0x40c8ff, 0xa040ff];
      r.mats.forEach((mm, mi) => { mm.emissive.setHex(pal[(Math.floor(hue * 5) + mi) % 5]).multiplyScalar(0.3); });
    }
    // 피탄 적색 점멸
    if (r.hitT > 0) { r.hitT -= dt; r.mats.forEach(m => m.emissive.setHex(0x771111)); }
    else if (r.wi !== ARMOR_INDEX && r.wi !== OP_INDEX) r.mats.forEach(m => m.emissive.setHex(0x000000));
    m.rotation.y = r.yaw || 0;
  }

  // ================= 봇 (혼자 놀 때 자동 투입) =================
  addBotsIfNeeded() {
    setTimeout(() => {
      if (this.disposed) return;
      const realCount = [...this.remotes.values()].filter(r => !r.isBot).length;
      if (realCount >= 1) return;
      const n = this.room.mode === 'defuse' ? 4 : 5;
      for (let i = 0; i < n; i++) {
        let team;
        if (this.room.mode === 'ffa') team = 'FOE' + i; // 개인전: 봇 전원 각자 적대
        else {
          const foe = this.team === 'CT' ? 'T' : this.team === 'T' ? 'CT' : this.team === 'alpha' ? 'bravo' : 'alpha';
          team = i % 2 === 0 ? foe : this.team;
        }
        const name = `BOT_${i + 1}`;
        const r = this.makeRemoteMesh({ team }, name);
        r.isBot = true; r.hp = 100; r.alive = true; r.team = team;
        r.targetPos = new THREE.Vector3((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80);
        r.mesh.position.copy(r.targetPos); r.lastPos.copy(r.targetPos);
        r.botTimer = Math.random() * 3; r.shootCd = 2 + Math.random() * 3;
        this.remotes.set(name, r); this.bots.push({ name, ...r });
        this.bots[this.bots.length - 1].ref = r;
      }
      this.feed('🤖 봇이 투입되었습니다 (혼자서도 플레이 가능)');
    }, 4000);
  }
  updateBots(dt) {
    for (const [name, r] of this.remotes) {
      if (!r.isBot || !r.alive) continue;
      r.slowT = Math.max(0, (r.slowT || 0) - dt);
      r.botTimer -= dt;
      if (r.botTimer <= 0) {
        r.botTimer = 2 + Math.random() * 4;
        r.targetPos = new THREE.Vector3((Math.random() - 0.5) * 100, 0, (Math.random() - 0.5) * 100);
      }
      // 표적 탐색 (0.5초마다): 가장 가까운 적 (봇·원격·나)
      r.lockCd = (r.lockCd || 0) - dt;
      if (r.lockCd <= 0) {
        r.lockCd = 0.5 + Math.random() * 0.3;
        let foe = null, foeD = 45;
        for (const [on, or] of this.remotes) {
          if (on === name || !or.alive || or.team === r.team) continue;
          const d = or.mesh.position.distanceTo(r.mesh.position);
          if (d < foeD) { foeD = d; foe = { kind: or.isBot ? 'bot' : 'remote', name: on, ref: or }; }
        }
        if (this.alive && r.team !== this.team) {
          const d = this.pos.distanceTo(r.mesh.position);
          if (d < foeD) foe = { kind: 'me', name: this.nick };
        }
        r.foe = foe;
      }
      const foe = r.foe && (r.foe.kind !== 'me' ? this.remotes.get(r.foe.name) || null : 'me');
      const foeAlive = foe === 'me' ? (this.alive && r.team !== this.team) : (foe && foe.alive && foe.team !== r.team);
      if (!foeAlive) r.foe = null;
      // 이동: 적이 14m 밖이면 접근, 안이면 제자리 교전
      let moveT = r.targetPos;
      if (r.foe) {
        const fp = foe === 'me' ? this.pos : foe.mesh.position;
        const d = fp.distanceTo(r.mesh.position);
        const fx = fp.x - r.mesh.position.x, fz = fp.z - r.mesh.position.z;
        r.yaw = Math.atan2(-fx, -fz); // 적 응시
        if (d > 14) moveT = new THREE.Vector3(fp.x, 0, fp.z);
        else moveT = null;
      }
      if (moveT) {
        const dir = moveT.clone().sub(r.mesh.position); dir.y = 0;
        if (dir.length() > 1) {
          dir.normalize();
          const step = dir.clone().multiplyScalar(dt * 4 * (r.slowT > 0 ? 0.45 : 1));
          const nx = r.mesh.position.clone(); nx.x += step.x;
          if (!this.collide(new THREE.Vector3(nx.x, 0, nx.z))) r.mesh.position.x = nx.x;
          const nz = r.mesh.position.clone(); nz.z += step.z;
          if (!this.collide(new THREE.Vector3(r.mesh.position.x, 0, nz.z))) r.mesh.position.z = nz.z;
          if (!r.foe) r.yaw = Math.atan2(-dir.x, -dir.z);
        }
      }
      r.mesh.rotation.y = r.yaw;
      // 사격
      r.shootCd -= dt;
      if (r.foe && foeAlive && r.shootCd <= 0) {
        const fp = foe === 'me' ? this.pos : foe.mesh.position;
        const dist = fp.distanceTo(r.mesh.position);
        if (dist < 45) {
          r.shootCd = 1.2 + Math.random() * 1.6;
          r.flashT = 0.12; // 발사 모션/섬광
          if (Math.random() < Math.max(0.1, 0.5 - dist / 100)) {
            const dmg = 8 + Math.random() * 10;
            if (foe === 'me') {
              this.hp -= dmg;
              this.flashDamage(); this.updateHUD();
              if (this.hp <= 0) { this.hp = 0; this.onDeath(true, { nickname: name, weapon: 'BOT 소총' }); this.feed(`☠ ${name} → ${this.nick}`); this.deaths++; }
            } else if (r.foe.kind === 'bot') {
              this.damageBot(r.foe.name, foe, dmg, name, false, false);
            } else {
              this.socket.emit('bot:hit', { bot: name, botTeam: r.team, target: r.foe.name, damage: Math.round(dmg) });
            }
          }
        }
      }
    }
  }

  // ================= 전투 =================
  tryShoot(now) {
    const w = WEAPONS[this.wi], a = this.ammo[this.wi];
    const interval = 60000 / w.rpm;
    if (now - this.lastShot < interval || this.reloading || !this.alive) return;
    if (w.spinup) { // 게틀링 스핀업 0.5초
      const dtSpin = Math.min(0.1, (now - (this.gatLast || now)) / 1000);
      this.gatLast = now;
      this.gatSpin = Math.min(2, (this.gatSpin || 0) + dtSpin);
      if (this.gatSpin < w.spinup) {
        if (now - this.lastShot > 120) { this.lastShot = now; Sfx.noise(0.05, 0.07, 900); }
        return;
      }
    }
    if (w.melee) { this.lastShot = now; this.meleeAttack(w); return; }
    if (a.mag <= 0) { this.reload(); return; }
    this.lastShot = now; if (!w.op && !w.mad && !w.armor) a.mag--; // 사격해도 슬라이드는 유지 / 전용총은 무한탄
    if (w.rocket) { this.fireRocket(w); return; }
    // 발사 이펙트 (반동 없음: 에임 고정)
    this.vmFlashT = (w.op || w.armor) ? 0.08 : 0.05;
    if (w.mad) { this.vmPonyKick = 1; Sfx.boom(); Sfx.tone(180, 0.14, 'sawtooth', 0.3, 60); Sfx.tone(1600, 0.06, 'square', 0.16, 300); }
    else if (w.armor) { Sfx.tone(320, 0.12, 'square', 0.25, 900); Sfx.noise(0.12, 0.2, 1800); this.feed('🧠 개뇌절개!!'); }
    else if (w.op) { Sfx.boom(); Sfx.tone(1400, 0.09, 'sawtooth', 0.22, 180); }
    else Sfx.shoot(w.id);
    // 미친말총: 적 팀 전원 저격 (서버 권한 검증 + 스로틀)
    if (w.mad && now - this.lastMadBlast > 400) { this.lastMadBlast = now; this.socket.emit('mad:blast'); }
    // 타인 화면에 총구섬광 중계 (스로틀 80ms)
    if (now - this.lastShootEmit > 80) { this.lastShootEmit = now; this.socket.emit('player:shoot'); }

    const base = new THREE.Vector3(); this.camera.getWorldDirection(base);
    const origin = this.camera.position.clone();
    const n = w.pellets || 1;
    for (let i = 0; i < n; i++) {
      const dir = base.clone();
      const sp = w.spread * (w.pellets ? 2.4 : 2) * (this.crouch ? 0.7 : 1);
      dir.x += (Math.random() - 0.5) * sp; dir.y += (Math.random() - 0.5) * sp; dir.normalize();
      this.scanShot(origin, dir, w);
    }
    // 탄흔 이펙트
    this.updateHUD();
  }

  // 단일 탄환 판정 (산탄은 펠릿마다 호출)
  scanShot(origin, dir, w) {
    const rc = new THREE.Raycaster(origin, dir, 0.1, 200);
    const opMode = !!w.op;
    // 벽 체크 (OP총은 벽/오브젝트 무시)
    let wallDist = 200;
    if (!opMode) {
      for (const c of this.colliders) {
        const hit = new THREE.Vector3();
        if (rc.ray.intersectBox(c, hit)) wallDist = Math.min(wallDist, hit.distanceTo(this.camera.position));
      }
      if (w.range) wallDist = Math.min(wallDist, w.range); // 테이저 사거리 제한
    }
    // 목표물(델타포스식)
    if (this.objective && this.room.mode === 'operation') {
      const hb = new THREE.Box3().setFromObject(this.objective);
      const hp = new THREE.Vector3();
      if (rc.ray.intersectBox(hb, hp) && hp.distanceTo(origin) < wallDist) {
        this.socket.emit('objective:damage', { amount: w.dmg }); this.showHit();
        this.spawnTracer(origin, hp); this.spawnSparks(hp, 0xff5533, 8);
        return;
      }
    }
    // 적(원격+봇) 히트 (실측 병사 체형: 몸통 0~1.55 / 머리 1.5~1.95 = 2배, 앉으면 축소)
    let best = null, bestDist = wallDist, bestHead = false;
    const pierceHits = [];
    for (const [name, r] of this.remotes) {
      if (!r.alive || r.team === this.team) continue;
      const mx = r.mesh.position.x, mz = r.mesh.position.z, my = r.mesh.position.y;
      const cr = r.crouch ? 1 : 0;
      const head = new THREE.Box3(new THREE.Vector3(mx - 0.3, my + 1.5 - cr * 0.55, mz - 0.3), new THREE.Vector3(mx + 0.3, my + 1.95 - cr * 0.6, mz + 0.3));
      const body = new THREE.Box3(new THREE.Vector3(mx - 0.5, my, mz - 0.5), new THREE.Vector3(mx + 0.5, my + 1.6 - cr * 0.55, mz + 0.5));
      const hp2 = new THREE.Vector3();
      let d = Infinity, isHead = false;
      if (rc.ray.intersectBox(head, hp2)) { d = hp2.distanceTo(origin); isHead = true; }
      else if (rc.ray.intersectBox(body, hp2)) { d = hp2.distanceTo(origin); isHead = false; }
      if (!isFinite(d)) continue;
      if (opMode) pierceHits.push({ name, d, isHead });
      if (d < bestDist) { bestDist = d; best = name; bestHead = isHead; }
    }
    // 미친말총: 경로상의 모든 적을 관통 처형
    if (opMode) {
      if (!pierceHits.length) {
        const impact = origin.clone().addScaledVector(dir, 200);
        this.spawnTracer(origin, impact, w.mad ? 0xff2fd0 : 0xffd050);
        return;
      }
      pierceHits.sort((a, b) => a.d - b.d);
      for (const h of pierceHits) {
        const impact = origin.clone().addScaledVector(dir, h.d);
        const col = w.mad ? 0xff2fd0 : 0xffd050;
        this.spawnTracer(origin, impact, col); this.spawnSparks(impact, col, 12);
        this.showHit(h.isHead); Sfx.hit();
        const rr = this.remotes.get(h.name);
        if (rr.isBot) this.damageBot(h.name, rr, w.dmg * (h.isHead ? 2 : 1), `${this.nick} [${w.id}]`, h.isHead);
        else this.socket.emit('player:hit', { target: h.name, damage: w.dmg * (h.isHead ? 2 : 1), weapon: w.mad ? '미친말총' : 'OP총', op: !!w.op, mad: !!w.mad });
      }
      return;
    }
    if (best) {
      const dmgMul = (bestHead && !w.stun) ? 2 : 1;
      const fxCol = w.stun ? 0x66eeff : 0xcc2222;
      this.showHit(bestHead && !w.stun); if (w.stun) Sfx.zap(); else if (bestHead) Sfx.headshot(); else Sfx.hit();
      const impact = origin.clone().addScaledVector(dir, bestDist);
      this.spawnTracer(origin, impact, w.stun ? 0x66eeff : undefined); this.spawnSparks(impact, fxCol, 7);
      const r = this.remotes.get(best);
      if (r.isBot) { // 봇 데미지 로컬 처리
        if (w.stun) r.slowT = 2; // 감전 슬로우
        this.damageBot(best, r, w.dmg * dmgMul, `${this.nick} [${w.id}${w.stun ? '⚡' : ''}]`, bestHead && !w.stun);
      } else {
        this.socket.emit('player:hit', { target: best, damage: w.dmg * dmgMul, weapon: (bestHead && !w.stun) ? w.id + '(헤드샷)' : w.id, stun: !!w.stun });
      }
    } else {
      // 빗나감: 벽/바닥 탄착점까지 트레이서 + 스파크
      const d = Math.min(wallDist, 150);
      const impact = origin.clone().addScaledVector(dir, d);
      this.spawnTracer(origin, impact);
      if (wallDist < 150) this.spawnSparks(impact, 0xffaa33, 4);
    }
  }

  // RPG 발사: 로켓 투사체 + 대형 폭발
  fireRocket(w) {
    this.vmFlashT = 0.06;
    Sfx.boom();
    if (performance.now() - this.lastShootEmit > 80) { this.lastShootEmit = performance.now(); this.socket.emit('player:shoot'); }
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const from = this.camera.position.clone().addScaledVector(dir, 0.7);
    const vel = dir.clone().multiplyScalar(70); // 탄속 46→70
    this.spawnRocket(from, vel, true);
    this.socket.emit('player:rocket', { from: { x: from.x, y: from.y, z: from.z }, vel: { x: vel.x, y: vel.y, z: vel.z } });
    this.updateHUD();
  }
  spawnRocket(from, vel, mine) {
    const g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    tube.rotation.x = Math.PI / 2; g.add(tube);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffaa22 }));
    flame.position.z = 0.35; g.add(flame);
    g.position.copy(from);
    g.lookAt(from.clone().add(vel));
    this.scene.add(g);
    this.rocketList.push({ mesh: g, flame, vel: vel.clone(), life: 5, mine, trailT: 0 });
  }
  updateRockets(dt) {
    for (let i = this.rocketList.length - 1; i >= 0; i--) {
      const rk = this.rocketList[i];
      rk.life -= dt;
      rk.vel.y -= 4 * dt;
      const p = rk.mesh.position;
      p.addScaledVector(rk.vel, dt);
      rk.mesh.lookAt(p.clone().add(rk.vel));
      rk.trailT -= dt;
      if (rk.trailT <= 0) { rk.trailT = 0.03; this.spawnSparks(p, 0xffaa33, 1); }
      if (rk.life <= 0 || this.pointHits(p.x, p.y, p.z, 0.2) || p.y < 0.1) {
        this.scene.remove(rk.mesh); this.rocketList.splice(i, 1);
        this.explodeRocket(p.clone(), rk.mine);
      }
    }
  }
  explodeRocket(pos, mine) {
    pos.y = Math.max(0.6, pos.y);
    this.spawnSparks(pos, 0xff6622, 16);
    this.spawnSparks(pos, 0xffcc44, 10);
    Sfx.explode();
    const d0 = this.pos.distanceTo(pos);
    this.shake = Math.min(1, this.shake + Math.max(0, 0.8 - d0 * 0.04));
    if (!mine) return;
    for (const [name, r] of this.remotes) { // 봇 광역
      if (!r.alive || r.team === this.team || !r.isBot) continue;
      const d = r.mesh.position.distanceTo(pos);
      if (d < 12) this.damageBot(name, r, Math.max(20, Math.round(160 * (1 - d / 13))), `${this.nick} [RPG]`);
    }
    this.socket.emit('player:blast', { pos: { x: pos.x, y: pos.y, z: pos.z }, radius: 12, power: 160 });
    if (this.room.mode === 'operation') {
      const d2 = new THREE.Vector3(pos.x, 0, pos.z).distanceTo(new THREE.Vector3(60, 0, -60));
      if (d2 < 14) this.socket.emit('objective:damage', { amount: Math.max(50, Math.round(300 * (1 - d2 / 16))) });
    }
    if (d0 < 7 && this.alive) { // 자폭 → 서버 판정 (로컬 중복집계 방지)
      this.socket.emit('player:selfhit', { damage: Math.round(90 * (1 - d0 / 8)), weapon: 'RPG🚀' });
    }
  }
  meleeAttack(w) {
    this.vmSwipe = 0.32;
    Sfx.noise(0.1, 0.18, 4000);
    if (performance.now() - this.lastShootEmit > 80) { this.lastShootEmit = performance.now(); this.socket.emit('player:shoot'); }
    const origin = this.camera.position.clone();
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x).normalize();
    this.spawnTracer(origin.clone().addScaledVector(right, 0.35), origin.clone().addScaledVector(fwd, 2.0).addScaledVector(right, -0.35));
    // 벽 뒤 적은 맞지 않음
    const mrc = new THREE.Raycaster(origin, fwd, 0.1, w.range);
    let wallD = w.range;
    const _mh = new THREE.Vector3();
    for (const c of this.colliders) {
      if (mrc.ray.intersectBox(c, _mh)) wallD = Math.min(wallD, _mh.distanceTo(origin));
    }
    let best = null, bestD = wallD;
    for (const [name, r] of this.remotes) {
      if (!r.alive || r.team === this.team) continue;
      const chest = r.mesh.position.clone(); chest.y += r.crouch ? 0.75 : 1.1;
      const to = chest.sub(origin);
      const d = to.length();
      if (d < bestD && fwd.angleTo(to.normalize()) < 0.6) { bestD = d; best = name; }
    }
    if (best) {
      this.showHit(false); Sfx.hit();
      const r = this.remotes.get(best);
      const impact = origin.clone().addScaledVector(fwd, bestD);
      this.spawnSparks(impact, 0xcc2222, 6);
      if (r.isBot) this.damageBot(best, r, w.dmg, `${this.nick} [${w.id}]`);
      else this.socket.emit('player:hit', { target: best, damage: w.dmg, weapon: w.id });
    }
    this.updateHUD();
  }

  // 봇 피해 공용 (총탄·수류탄·봇간교전)
  damageBot(name, r, dmg, label, headshot = false, creditMe = true) {
    if (!r.alive) return;
    r.hp -= dmg;
    r.flashT = 0;
    this.drawNameplate(r.plate, name, r.team === this.team, Math.max(0, r.hp));
    if (r.hp <= 0) {
      this.setRemoteAlive(r, false);
      this.feed(`☠ ${label} → ${name}`);
      if (creditMe) {
        this.kills++; this.money += 300; Sfx.kill();
        this.firstBloodCheck(this.nick, name);
        this.onMyKill();
        this.showKillBanner(name, label);
        this.updateHUD(); // 건게임 진도·탄약 표시 갱신
      }
      // 폭파전: 그 라운드에선 부활 없음 / 그 외: 2초 후 부활
      if (this.room.mode !== 'defuse') {
        setTimeout(() => { if (this.disposed) return; r.hp = 100; this.setRemoteAlive(r, true); this.drawNameplate(r.plate, name, r.team === this.team, 100); }, 2000);
      }
    }
  }
  // 봇 전원 부활 (라운드/매치 전환 시)
  reviveBots() {
    for (const [name, r] of this.remotes) {
      if (!r.isBot || r.alive) continue;
      r.hp = 100; this.setRemoteAlive(r, true);
      this.drawNameplate(r.plate, name, r.team === this.team, 100);
    }
  }
  onMyKill() {
    const now2 = performance.now();
    this.streak = (now2 - this.streakT < 4000) ? this.streak + 1 : 1;
    this.streakT = now2;
    if (this.streak === 2) this.feed('🔥 더블킬!');
    else if (this.streak === 3) this.feed('🔥🔥 트리플킬!');
    else if (this.streak >= 4) this.feed(`🔥 RAMPAGE x${this.streak}!`);
  }
  firstBloodCheck(killer, victim) {
    if (this.firstBlood) return;
    this.firstBlood = true;
    this.feed(`🩸 FIRST BLOOD: ${killer} → ${victim}`);
  }

  showHit(headshot = false) {
    const h = document.getElementById('hitmarker');
    if (!h) return;
    h.textContent = headshot ? 'HEADSHOT' : '✕';
    h.style.color = headshot ? '#ffcf3f' : '#ff4040';
    h.style.opacity = 1; setTimeout(() => h.style.opacity = 0, headshot ? 300 : 120);
  }
  // 발로란트식 킬 배너 + 화면 플래시
  showKillBanner(victim, weapon) {
    const b = document.getElementById('kill-banner');
    if (b) {
      const hs = /헤드샷/.test(weapon || '');
      b.innerHTML = `<span class="kb-k">${hs ? '🎯 HEADSHOT' : '⚔ ELIMINATION'}</span><span class="kb-v">${victim}</span><span class="kb-w">[${weapon || '?'}]</span>`;
      b.classList.toggle('hs', hs);
      b.classList.remove('hidden', 'show');
      void b.offsetWidth;
      b.classList.add('show');
      clearTimeout(this._kbT);
      this._kbT = setTimeout(() => b.classList.add('hidden'), 1450);
    }
    const f = document.getElementById('kill-flash');
    if (f) { f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
  }
  showDamageDir(attacker) {
    const el = document.getElementById('dmg-dir');
    const atk = attacker && this.remotes.get(attacker);
    if (!el || !atk) return;
    const dx = atk.mesh.position.x - this.pos.x, dz = atk.mesh.position.z - this.pos.z;
    const deg = (this.yaw - Math.atan2(-dx, -dz)) * 180 / Math.PI;
    el.style.transform = `translate(-50%,-50%) rotate(${deg}deg) translateY(-70px)`;
    el.style.opacity = 1;
    clearTimeout(this._ddT);
    this._ddT = setTimeout(() => el.style.opacity = 0, 800);
  }
  flashDamage() { document.getElementById('hp-fill').style.background = '#e74c3c'; setTimeout(() => document.getElementById('hp-fill').style.background = '', 150); }

  onDeath(byEnemy, killer = null) {
    if (!this.alive) return;
    this.alive = false; this.firing = false;
    this.aiming = false; this.vmAdsK = 0; // 조준 해제 (부활 시 줌 고착 방지)
    this.gatSpin = 0; this.gatLast = 0;
    this.reloading = false; this.reloadSeq++; // 사망 시 장전 취소
    // 킬캠: 3초간 처치자를 3인칭으로 추적
    if (killer && killer.nickname) {
      this.killcam = { name: killer.nickname, until: performance.now() + 3000 };
      const db = (this.el && this.el.deathBy) || document.getElementById('death-by');
      if (db) db.textContent = `🔫 ${killer.nickname} [${killer.weapon || '?'}] 에게 처치됨 · 킬캠`;
    } else {
      this.killcam = null;
      const db = (this.el && this.el.deathBy) || document.getElementById('death-by');
      if (db) db.textContent = '';
    }
    document.getElementById('respawn-overlay').classList.remove('hidden');
    if (this.room.mode === 'defuse') {
      document.querySelector('#respawn-overlay p').textContent = '이번 라운드 관전 중...';
      return;
    }
    // 서버 부활 패킷 유실 대비 폴백 (서버가 정상이면 먼저 부활하므로 무효화됨)
    const ds = ++this.deathSeq;
    setTimeout(() => { if (!this.disposed && this.deathSeq === ds && !this.alive) this.reviveLocal(); }, 2200);
  }

  // ================= 이동/충돌 =================
  collideBox(x, yFeet, z, half = 0.4, height = 1.7) {
    const pBox = new THREE.Box3(new THREE.Vector3(x - half, yFeet, z - half), new THREE.Vector3(x + half, yFeet + height, z + half));
    for (const c of this.colliders) if (pBox.intersectsBox(c)) return true;
    return false;
  }
  collide(pos) { return this.collideBox(pos.x, 0, pos.z); } // 플레이어(지상) 구방식
  firstCollider(pos) {
    const pBox = new THREE.Box3(new THREE.Vector3(pos.x - 0.4, 0, pos.z - 0.4), new THREE.Vector3(pos.x + 0.4, 1.7, pos.z + 0.4));
    for (const c of this.colliders) if (pBox.intersectsBox(c)) return c;
    return null;
  }
  pointHits(x, y, z, pad = 0.15) { // 투사체용 3D 점 충돌 (Y 포함)
    const b = new THREE.Box3(new THREE.Vector3(x - pad, y - pad, z - pad), new THREE.Vector3(x + pad, y + pad, z + pad));
    for (const c of this.colliders) if (b.intersectsBox(c)) return true;
    return false;
  }
  resolveStuck() { // 박힘 시 최소침투축으로 완전히 밀어내기 (진동 없이 탈출)
    for (let i = 0; i < 40; i++) {
      const hit = this.firstCollider(this.pos);
      if (!hit) break;
      const px1 = (this.pos.x + 0.4) - hit.min.x;
      const px2 = hit.max.x - (this.pos.x - 0.4);
      const pz1 = (this.pos.z + 0.4) - hit.min.z;
      const pz2 = hit.max.z - (this.pos.z - 0.4);
      const m = Math.min(px1, px2, pz1, pz2);
      if (m === px1) this.pos.x = hit.min.x - 0.41;
      else if (m === px2) this.pos.x = hit.max.x + 0.41;
      else if (m === pz1) this.pos.z = hit.min.z - 0.41;
      else this.pos.z = hit.max.z + 0.41;
    }
    const B = this.mapBound();
    this.pos.x = Math.max(-B, Math.min(B, this.pos.x));
    this.pos.z = Math.max(-B, Math.min(B, this.pos.z));
  }
  updateMove(dt) {
    if (!this.alive || document.pointerLockElement !== this.canvas) { this.isMoving = false; this.endSlide(); return; }
    const wasGrounded = this.grounded; // 슬라이드 판정용 (눈높이 하강 중 false가 되어도 유지)
    const sprintKey = !!(this.keys.ShiftLeft || this.keys.ShiftRight);
    // 슬라이드 시작: 달리기로 충분히 달린 상태에서 C
    if (!this.sliding && sprintKey && this.keys.KeyC && this.moveSpeed > 6.5 && wasGrounded && this.stunT <= 0) {
      const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this.slideDir.copy(this.moveSpeed > 0.1 ? fw : fw);
      this.sliding = true; this.slideT = 1.15;
      this.slideSpeed = Math.max(this.moveSpeed, 10) + 2.2;
      this.pos.y = Math.min(this.pos.y, 0.7); this.vy = 0; // 슬라이드 진입 즉시 몸 낮춤
      Sfx.step(); this.feed('🛝 슬라이드!');
    }
    this.crouch = !!this.keys.KeyC || this.sliding;
    const eyeBase = this.sliding ? 0.7 : this.crouch ? 1.15 : 1.7;
    const sprint = sprintKey && !this.crouch;
    let speed;
    if (this.sliding) {
      this.slideT -= dt;
      this.slideSpeed = Math.max(2.6, this.slideSpeed - 7 * dt);
      speed = this.stunT > 0 ? this.slideSpeed * 0.35 : this.slideSpeed;
    } else speed = sprint ? 9 : this.crouch ? 2.8 : 5.5;
    if (this.stunT > 0 && !this.sliding) speed *= 0.35; // 감전 둔화
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const move = new THREE.Vector3();
    if (this.keys.KeyW) move.add(f); if (this.keys.KeyS) move.sub(f);
    if (this.keys.KeyD) move.add(r); if (this.keys.KeyA) move.sub(r);
    this.isMoving = move.length() > 0;
    if (this.sliding) {
      // 슬라이드는 진행방향 고정 + 약한 조향
      if (this.isMoving) { this.slideDir.lerp(move.normalize(), Math.min(1, dt * 4.5)).normalize(); }
      move.copy(this.slideDir).multiplyScalar(speed * dt);
      this.isMoving = true;
    } else if (this.isMoving) move.normalize().multiplyScalar(speed * dt);
    // 박힘 시 밀어내기 후 이동 (noclip 없이 탈출 보장)
    this.resolveStuck();
    const px0 = this.pos.x, pz0 = this.pos.z;
    const nx = this.pos.clone(); nx.x += move.x;
    if (!this.collide(nx)) this.pos.x = nx.x;
    const nz = this.pos.clone(); nz.z += move.z;
    if (!this.collide(nz)) this.pos.z = nz.z;
    // 실제 이동 속도 (슬라이드 발동 조건·조준 정확도용)
    this.moveSpeed = dt > 0 ? Math.hypot(this.pos.x - px0, this.pos.z - pz0) / dt : 0;
    // 맵 경계
    const B = this.mapBound();
    this.pos.x = Math.max(-B, Math.min(B, this.pos.x));
    this.pos.z = Math.max(-B, Math.min(B, this.pos.z));
    // 점프/중력 (Space) — 슬라이드는 점프로 취소
    if (this.keys.Space && this.pos.y <= eyeBase + 0.01) { this.vy = 5.4; Sfx.step(); if (this.sliding) this.endSlide(); }
    this.vy -= (this.sliding ? 44 : 14) * dt; // 슬라이드는 몸 낮추기가 빠름
    this.pos.y += this.vy * dt;
    if (this.pos.y <= eyeBase) {
      if (this.vy < -5) { Sfx.step(); this.vmLand = 1; }
      this.pos.y = eyeBase; this.vy = 0;
    }
    this.grounded = this.pos.y <= eyeBase + 0.05;
    // 슬라이드 종료 (C 해제 / 속도 소멸 / 시간 / 공중)
    if (this.sliding && (!this.keys.KeyC || this.slideT <= 0 || this.slideSpeed <= 3.2 || !wasGrounded)) this.endSlide();
    this.eyeBase = eyeBase;
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.y = this.yaw; this.camera.rotation.x = this.pitch;
    // 피격 화면 흔들림 (발사 반동 삭제됨)
    if (this.shake > 0.003) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.05;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.05;
    }
    if (this.sliding) this.camera.rotation.z += 0.085; // 슬라이드 기울임
    // 조준(우클릭): AWP 줌
    const w = WEAPONS[this.wi];
    if (this.aiming && w.zoom) { this.camera.fov = 18; } else if (this.aiming) { this.camera.fov = 52; } else { this.camera.fov = 70; }
    this.camera.updateProjectionMatrix();
    // 자동 점령 체크 (서서 점령)
    if (this.room.mode === 'conquest') {
      let near = null;
      for (const [id, fl] of Object.entries(this.flags)) if (this.pos.distanceTo(fl.pos) < 4) near = id;
      const tip = this.el.tip;
      if (tip) {
        if (near) { tip.textContent = `E 키: 거점 ${near} 점령`; tip.classList.remove('hidden'); }
        else tip.classList.add('hidden');
      }
    }
    if (this.room.mode === 'defuse') {
      const tip = this.el.tip;
      if (!tip) return;
      let t = null;
      if (this.team === 'T') for (const [id, s] of Object.entries(this.bombSites)) if (this.pos.distanceTo(s.pos) < 5) t = `E 키: ${id}에 폭탄 설치`;
      if (this.team === 'CT' && this.bombPlantedPos && this.pos.distanceTo(this.bombPlantedPos) < 4) t = this.defuseP > 0 ? `🛠 해체 중... ${Math.floor(this.defuseP * 100)}%` : 'E 홀드: 폭탄 해체 (3초 유지)';
      if (t) { tip.textContent = t; tip.classList.remove('hidden'); } else tip.classList.add('hidden');
    }
  }

  // ================= HUD =================
  updateHUD() {
    // 건게임: 킬 수로 무기 강제 변경
    if (this.room.mode === 'gungame') {
      const target = GUNGAME_ORDER[Math.min(this.kills, GUNGAME_ORDER.length - 1)];
      if (target !== this.wi) {
        this.wi = target; this.vmSwitchT = 0.2;
        this.vmGuns.forEach((g, k) => g.visible = k === target);
        this.updateVmFlashPos();
      }
    }
    const w = WEAPONS[this.wi], a = this.ammo[this.wi];
    const fmt = (v) => isFinite(v) ? v : '∞';
    const ownTag = w.op ? ' 👑' : w.mad ? ' 🐴' : w.armor ? ' ⭐' : '';
    const priv = w.op || w.mad || w.armor;
    document.getElementById('weapon-name').textContent = `${w.id}${ownTag}${priv ? (w.armor ? ' [관리자 · 장착중 무적]' : w.op ? ' [전용 · 장착중 무적]' : ' [전용]') : ''}${this.reloading ? ' - 장전중...' : ''}`;
    document.getElementById('ammo').textContent = priv ? '∞ / ∞' : `${fmt(a.mag)} / ${fmt(a.reserve)}`;
    const hb = document.getElementById('hotbar');
    hb.innerHTML = WEAPONS.map((ww, i) => {
      const aa = this.ammo[i];
      if ((ww.op && !this.hasOpGun) || (ww.mad && !this.hasMadGun) || (ww.armor && !this.isAdmin)) return ''; // 전용 무기는 권한자만 보임
      const key = ww.op ? 'O' : ww.mad ? 'H' : ww.armor ? 'U' : (i === 9 ? 0 : i + 1);
      const cls = `hslot${i === this.wi ? ' active' : ''}${this.reloading && i === this.wi ? ' reloading' : ''}`;
      const inf = ww.op || ww.mad || ww.armor;
      return `<div class="${cls}" data-w="${i}"><b>[${key}] ${ww.id}</b><br><span class="mag">${inf ? '∞' : fmt(aa.mag)}</span> / ${inf ? '∞' : fmt(aa.reserve)}</div>`;
    }).join('');
    hb.querySelectorAll('.hslot').forEach(el => el.onclick = (e) => { e.stopPropagation(); this.switchWeapon(parseInt(el.dataset.w)); });
    document.getElementById('hp-fill').style.width = this.hp + '%';
    document.getElementById('hp-text').textContent = Math.max(0, Math.round(this.hp));
    document.getElementById('team-tag').textContent = `${this.nick} · ${this.team}팀 · K ${this.kills} / D ${this.deaths}`;
    document.getElementById('nades').textContent = `💣 x${this.nades} (G)`;
    const low = document.getElementById('lowhp');
    if (low) low.classList.toggle('hidden', !(this.alive && this.hp <= 35));
    const m = document.getElementById('money');
    if (this.room.mode === 'defuse') { m.classList.remove('hidden'); m.textContent = '$' + this.money; }
    this.updateMatchInfo();
  }
  updateMatchInfo() {
    const st = this.serverState, el = document.getElementById('match-info'), fb = document.getElementById('flag-bar'), tm = document.getElementById('timer');
    if (!st) return;
    const rk = this.room.ranked ? '🏆경쟁 ' : '';
    if (this.room.mode === 'conquest') {
      el.textContent = `${rk}⚔ 정복전 | 🎫 ALPHA ${st.tickets?.alpha ?? '-'} : ${st.tickets?.bravo ?? '-'} BRAVO`;
      const f = st.flags || {};
      fb.textContent = `A:${f.A || '-'} B:${f.B || '-'} C:${f.C || '-'}`;
      for (const [id, owner] of Object.entries(f)) {
        const fl = this.flags[id]; if (!fl) continue;
        const col = owner === 'alpha' ? 0x2255ff : owner === 'bravo' ? 0xff3322 : 0xffffff;
        fl.mesh.material.color.set(col);
        fl.ring.material.color.set(col);
      }
      tm.textContent = '';
    } else if (this.room.mode === 'operation') {
      el.textContent = `${rk}🚁 블랙호크 작전 | 목표물 HP ${st.objectiveHp ?? 1000}`;
      fb.textContent = st.targetDestroyed ? '파괴됨' : '목표물을 파괴하라 (E 또는 사격)';
      tm.textContent = '';
      if (this.objectiveHpMesh) {
        const k = Math.max(0.001, (st.objectiveHp ?? 1000) / 1000);
        this.objectiveHpMesh.scale.x = k;
        this.objectiveHpMesh.material.color.set(k > 0.5 ? 0x00ff00 : k > 0.25 ? 0xffaa00 : 0xff0000);
      }
    } else if (this.room.mode === 'defuse') {
      el.textContent = `${rk}💣 폭파전 R${st.round}/${st.maxRounds} | CT ${st.score?.CT} : ${st.score?.T} T`;
      const mp = (st.score?.CT === st.maxRounds - 1 || st.score?.T === st.maxRounds - 1) ? ' · 🔥 매치포인트' : '';
      fb.textContent = (st.bomb?.planted ? `💣 ${st.bomb.site} 설치됨! ${st.bomb.timeLeft}s` : '폭탄 미설치') + mp;
      tm.textContent = '';
    } else if (this.room.mode === 'tdm') {
      const s = st.score || {};
      el.textContent = `${rk}💀 팀 데스매치 | ${s.alpha ?? s.CT ?? 0} : ${s.bravo ?? s.T ?? 0} (선착 ${st.target}킬)`;
      fb.textContent = ''; tm.textContent = '';
    } else if (this.room.mode === 'ffa') {
      const sc = st.scores || {}, names = st.scoreNames || {};
      const top = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([uid, k]) => `${names[uid] || '?'} ${k}킬`).join(' · ');
      const t = st.timeLeft || 0;
      el.textContent = `${rk}🔫 개인전 | ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} | 목표 ${st.target}킬`;
      fb.textContent = top || '아직 킬 없음'; tm.textContent = '';
    } else if (this.room.mode === 'gungame') {
      const lv = Math.min(this.kills, GUNGAME_ORDER.length - 1);
      el.textContent = `${rk}🔫 건게임 | Lv.${lv + 1}/9 ${WEAPONS[GUNGAME_ORDER[lv]].id}`;
      fb.textContent = lv >= 8 ? '나이프킬로 완주!' : '킬마다 다음 무기!'; tm.textContent = '';
    }
    this.drawMinimap();
  }
  feed(t) {
    const d = document.createElement('div'); d.textContent = t;
    const kf = document.getElementById('killfeed'); kf.prepend(d);
    while (kf.children.length > 6) kf.lastChild.remove();
  }
  log(t, sys) {
    const d = document.createElement('div'); d.textContent = t;
    if (sys) d.style.color = '#ffb300';
    const cl = document.getElementById('chat-log'); cl.appendChild(d);
    while (cl.children.length > 30) cl.firstChild.remove();
  }
  drawScoreboard() {
    if (document.getElementById('scoreboard').classList.contains('hidden')) return;
    const rows = [...this.remotes.entries()].map(([n, r]) => {
      const kd = (r.deaths || 0) > 0 ? ((r.kills || 0) / r.deaths).toFixed(2) : (r.kills || 0);
      return `<tr><td>${n}${r.isBot ? '(BOT)' : ''}</td><td>${r.team}</td><td>❤${Math.round(r.hp)}</td><td>K${r.kills || 0}/D${r.deaths || 0} (${kd})</td></tr>`;
    }).join('');
    document.getElementById('scoreboard').innerHTML = `<h3>스코어보드 (Tab)</h3><table><tr><th>플레이어</th><th>팀</th><th>HP</th><th>전적</th></tr><tr><td>${this.nick}(나)</td><td>${this.team}</td><td>❤${Math.round(this.hp)}</td><td>K${this.kills}/D${this.deaths}</td></tr>${rows}</table>`;
  }
  drawMinimap() {
    const now2 = performance.now();
    if (now2 - (this.mmT || 0) < 120) return; // 8Hz로 제한
    this.mmT = now2;
    const c = document.getElementById('minimap'); if (!c) return;
    const ctx = c.getContext('2d');
    const S = this.mapName === 'delta_valley' ? 320 : this.mapName === 'desert_storm' ? 220 : 120;
    const toMap = (x, z) => [80 + (x / S) * 160, 80 + (z / S) * 160];
    ctx.clearRect(0, 0, 160, 160);
    ctx.fillStyle = '#0e1a12'; ctx.fillRect(0, 0, 160, 160);
    for (const [id, f] of Object.entries(this.flags || {})) {
      const [mx, mz] = toMap(f.pos.x, f.pos.z);
      ctx.fillStyle = '#fff'; ctx.fillRect(mx - 4, mz - 4, 8, 8);
      ctx.fillStyle = '#ffb300'; ctx.fillText(id, mx - 3, mz - 6);
    }
    for (const [id, s] of Object.entries(this.bombSites || {})) {
      const [mx, mz] = toMap(s.pos.x, s.pos.z);
      ctx.fillStyle = '#ff5500'; ctx.fillRect(mx - 4, mz - 4, 8, 8);
      ctx.fillStyle = '#fff'; ctx.fillText(id, mx - 3, mz - 6);
    }
    if (this.mapName === 'delta_valley') { // 목표물
      const [mx, mz] = toMap(60, -60);
      ctx.fillStyle = '#ff0000'; ctx.fillRect(mx - 4, mz - 4, 8, 8);
      ctx.fillStyle = '#fff'; ctx.fillText('目', mx - 4, mz - 6);
    }
    if (this.bombPlantedPos) { // 설치된 폭탄 점멸
      const [mx, mz] = toMap(this.bombPlantedPos.x, this.bombPlantedPos.z);
      if (Math.floor(performance.now() / 400) % 2 === 0) {
        ctx.fillStyle = '#ff0000'; ctx.beginPath(); ctx.arc(mx, mz, 5, 0, 7); ctx.fill();
      }
    }
    const [px, pz] = toMap(this.pos.x, this.pos.z);
    ctx.fillStyle = '#00ff00'; ctx.beginPath(); ctx.arc(px, pz, 4, 0, 7); ctx.fill();
    for (const [, r] of this.remotes) {
      if (!r.alive) continue;
      const [mx, mz] = toMap(r.mesh.position.x, r.mesh.position.z);
      ctx.fillStyle = r.team === this.team ? '#2255ff' : '#ff3322';
      ctx.fillRect(mx - 2, mz - 2, 4, 4);
    }
  }

  // ================= 메인 루프 =================
  loop() {
    if (this.disposed) return;
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();
    const time = now / 1000;
    this.updateMove(dt);
    if (this.firing) {
      const w = WEAPONS[this.wi];
      if (w.auto) this.tryShoot(now);
    } else { this.gatSpin = 0; this.gatLast = 0; }
    // 원격 보간 → 봇 이동 → 인체 애니 일괄 (이동량 기반 걷기 모션)
    for (const [, r] of this.remotes) {
      if (!r.isBot && r.alive) {
        // XZ는 부드럽게, Y(점프)는 빠르게 추적해 흔들림 방지
        r.mesh.position.x += (r.targetPos.x - r.mesh.position.x) * 0.25;
        r.mesh.position.z += (r.targetPos.z - r.mesh.position.z) * 0.25;
        r.mesh.position.y += (r.targetPos.y - r.mesh.position.y) * Math.min(1, dt * 14);
      }
    }
    this.updateBots(dt);
    for (const [, r] of this.remotes) this.animateSoldier(r, dt, time);
    this.updateViewmodel(dt, now);
    this.updateFx(dt);
    this.updateNades(dt);
    this.updateRockets(dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    // 사망 캠: 옆으로 기울기 + 스트레이프 리언
    this.camera.rotation.z += ((this.alive ? 0 : 0.45) - this.camera.rotation.z) * Math.min(1, dt * 5);
    if (this.alive) this.camera.rotation.z += ((this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0)) * 0.025;
    // 킬캠: 처치자를 3초간 3인칭 추적
    if (this.killcam && now > this.killcam.until) {
      this.killcam = null;
      if (!this.alive) { // 시체 시점으로 복귀 (관전)
        this.camera.position.copy(this.pos);
        this.camera.rotation.set(0, 0, 0, 'YXZ');
        this.camera.rotation.y = this.yaw; this.camera.rotation.x = this.pitch;
      }
    }
    if (this.killcam && !this.alive) {
      const tgt = this.remotes.get(this.killcam.name);
      if (tgt && tgt.alive) {
        const bp = tgt.mesh.position;
        const fx = -Math.sin(tgt.yaw), fz = -Math.cos(tgt.yaw);
        this.camera.position.set(bp.x - fx * 4.5, 2.8, bp.z - fz * 4.5);
        this.camera.lookAt(bp.x, 1.2, bp.z);
      } else this.killcam = null;
    }
    // 아군 관전 (킬캠 끝난 뒤에도 사망 상태면 우리팀만)
    if (!this.alive && !this.killcam) {
      const mates = [...this.remotes.entries()].filter(([, r]) => r.team === this.team && r.alive);
      if (mates.length) {
        const [sn, sr] = mates[this.spectateIdx % mates.length];
        if (this.specName !== sn) { this.specName = sn; if (this.el.deathBy) this.el.deathBy.textContent = `👁 관전 중: ${sn} (Q로 전환)`; }
        const bp = sr.mesh.position;
        const fx = -Math.sin(sr.yaw), fz = -Math.cos(sr.yaw);
        this.camera.position.set(bp.x - fx * 4.5, 2.8, bp.z - fz * 4.5);
        this.camera.lookAt(bp.x, 1.2, bp.z);
      } else if (this.specName !== '') { this.specName = ''; if (this.el.deathBy) this.el.deathBy.textContent = '아군 전멸'; }
    } else if (this.alive) this.specName = '';
    // AWP 스코프 오버레이 + 조준선 확산
    const scoped = this.aiming && WEAPONS[this.wi].zoom && this.alive;
    if (this.el.scope) this.el.scope.classList.toggle('hidden', !scoped);
    const ch = this.el.cross;
    if (ch) {
      ch.style.opacity = (!this.alive || scoped) ? 0 : 1;
      if (this.vmRig) this.vmRig.visible = this.alive; // 킬캠/사망 시 뷰모델 숨김
      const spread = 1 + (this.isMoving ? 0.35 : 0);
      ch.style.transform = `translate(-50%,-50%) scale(${spread.toFixed(2)})`;
    }
    // 발소리
    if (this.isMoving && this.alive && document.pointerLockElement === this.canvas) {
      this.stepT -= dt * ((this.keys.ShiftLeft || this.keys.ShiftRight) ? 1.5 : 1);
      if (this.stepT <= 0) { this.stepT = 0.38; Sfx.step(); }
    }
    // CT 폭탄 해체: E 홀드 3초
    if (this.room.mode === 'defuse' && this.team === 'CT' && this.alive && this.bombPlantedPos) {
      if (this.keys.KeyE && this.pos.distanceTo(this.bombPlantedPos) < 4) {
        const before = this.defuseP;
        this.defuseP = Math.min(1, this.defuseP + dt / 3);
        if (Math.floor(this.defuseP * 10) !== Math.floor(before * 10)) Sfx.beep();
        if (this.defuseP >= 1) { this.socket.emit('bomb:defuse'); this.defuseP = 0; }
      } else this.defuseP = 0;
    } else this.defuseP = 0;
    // 네트워크 전송 20Hz
    this.netTimer += dt;
    if (this.netTimer > 0.05) { this.netTimer = 0; this.socket.emit('player:state', { pos: { x: this.pos.x, y: this.pos.y, z: this.pos.z }, yaw: this.yaw, pitch: this.pitch, wi: this.wi, fy: this.pos.y - this.eyeBase, crouch: !!this.crouch, sl: this.sliding, eid: this.emoteId }); }
    // 깃발 애니메이션
    const t = now / 500;
    for (const f of Object.values(this.flags || {})) f.mesh.rotation.y = Math.sin(t) * 0.3;
    this.renderer.render(this.scene, this.camera);
  }
}
