// FPS 뷰모델 스모크 테스트 (three.js 자동 스텁)
const fs = require('fs');
let src = fs.readFileSync('./public/js/game.js', 'utf8');
src = src.replace(/^import .*$/m, '').replace('export class FPSGame', 'class FPSGame');
src = src.replace(/const \{[^}]*\} = require\([^)]*\);/g, '').replace(/^const .*require\(.*$/gm, '');

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { if (x !== undefined) this.x = x; if (y !== undefined) this.y = y; if (z !== undefined) this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { const a = this.x - v.x, b = this.y - v.y, c = this.z - v.z; return a * a + b * b + c * c; }
  normalize() { const l = this.length() || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  crossVectors() { return this.set(0, 0, 0); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  applyMatrix4() { return this; }
  lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this; }
  lerp(b, t) { this.x += (b.x - this.x) * t; this.y += (b.y - this.y) * t; this.z += (b.z - this.z) * t; return this; }
}
class Box3 {
  constructor(a, b) { this.min = a || new V3(); this.max = b || new V3(); }
  setFromObject() { return this; } intersectsBox() { return false; } intersectsSphere() { return false; }
  getCenter(v) { return v || new V3(); } getSize(v) { return v || new V3(); }
}
class Ray { constructor(o, d) { this.o = o; this.d = d; } intersectBox() { return null; } }
class Raycaster { constructor(o, d) { this.ray = new Ray(o, d); this.far = 100; } setFromCamera() {} intersectObjects() { return []; } }
class Obj3D {
  constructor() {
    this.children = []; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0, set() {} };
    this.scale = { x: 1, y: 1, z: 1, set() {} }; this.quaternion = { setFromUnitVectors() {} };
    this.userData = {}; this.visible = true; this.castShadow = false; this.receiveShadow = false;
    this.up = new V3(0, 1, 0); this.intensity = 1; this.color = 0xffffff;
    this.shadow = { camera: { left: 0, right: 0, top: 0, bottom: 0 }, mapSize: { set() {} }, bias: 0, map: null };
    this.target = { position: new V3(), rotation: { x: 0, y: 0, z: 0, set() {} } };
    this.map = null; this.isLight = false;
  }
  add(o) { this.children.push(o); } remove() {} traverse() {} lookAt() {} clone() { return this; }
  updateMatrix() {} updateMatrixWorld() {} getWorldPosition(v) { return v || new V3(); } getWorldDirection(v) { return v.set(0, 0, -1); }
  translateX(x) { this.position.x += x; return this; } translateY(y) { this.position.y += y; return this; } translateZ(z) { this.position.z += z; return this; }
  setFromPoints() { return this; } setFromBufferAttribute() { return this; } setDrawRange() {} computeBoundingSphere() {} computeBoundingBox() {}
  setAttribute() {} getAttribute() { return { array: [], count: 0, setXYZ() {} }; }
}
class Group extends Obj3D { }
class Mesh extends Obj3D { constructor(g, m) { super(); this.material = m; this.geometry = g; } }
class Scene extends Group { }
class Camera extends Obj3D { constructor() { super(); this.aspect = 1; this.fov = 70; this.near = 0.05; this.far = 600; } updateProjectionMatrix() {} getWorldDirection(v) { return v.set(0, 0, -1); } }

const SPECIFIC = {
  Vector3: V3, Box3, Raycaster, Group, Mesh, Scene, Camera, Object3D: Obj3D,
  PerspectiveCamera: class extends Camera { constructor(fov, aspect, near, far) { super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far; } },
  WebGLRenderer: class {
    constructor() { this.domElement = { style: {}, addEventListener() {}, removeEventListener() {} }; this.shadowMap = { enabled: false, type: 0 }; this.info = { render: { calls: 0 } }; }
    setPixelRatio() {} setSize() {} render() { this.info.render.calls++; } dispose() {} setClearColor() {} clear() {}
  },
  Clock: class { constructor() { this.t = 0; } getDelta() { this.t += 0.016; return 0.016; } },
  CanvasTexture: class { constructor() { this.repeat = { set() {} }; this.offset = { set() {} }; this.image = { width: 64, height: 64 }; } clone() { return new THREE.CanvasTexture(); } set() {} setRepeat() {} },
  MeshBasicMaterial: class { constructor(o) { this.color = (o && o.color) || 0; } },
  MeshLambertMaterial: class { constructor(o) { this.color = (o && o.color) || 0; this.emissive = { setHex() {} }; } },
  MeshStandardMaterial: class { constructor(o) { this.color = (o && o.color) || 0; this.emissive = { setHex() {} }; this.emissiveIntensity = 1; } },
  SpriteMaterial: class { constructor(o) { this.color = (o && o.color) || 0; } },
};
const THREE = new Proxy(SPECIFIC, {
  get(t, k) {
    if (k in t) return t[k];
    if (typeof k !== 'string') return undefined;
    const gen = class extends Obj3D {
      constructor(...args) { super(); this.args = args; }
      set() { return this; } copy() { return this; } clone() { return this; }
      setFromObject() { return this; } setFromCamera() {} lookAt() {}
      intersectBox() { return null; } intersectObjects() { return []; }
      getWorldDirection(v) { return v.set(0, 0, -1); } updateProjectionMatrix() {}
    };
    t[k] = gen;
    return gen;
  },
});
global.THREE = THREE;

const mkEl = () => ({
  style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  textContent: '', innerHTML: '', value: '', width: 0, height: 0,
  querySelector: () => null, querySelectorAll: () => [], appendChild() {}, prepend() {}, remove() {},
  onclick: null, addEventListener() {}, removeEventListener() {},
  children: [], firstChild: null, lastChild: null, parentNode: null,
  getContext: () => ({
    fillRect() {}, clearRect() {}, fillText() {}, strokeText() {}, beginPath() {}, arc() {}, fill() {},
    moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {}, translate() {}, rotate() {},
    createLinearGradient: () => ({ addColorStop() {} }), measureText: () => ({ width: 10 }),
    font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '',
  }),
});
global.document = {
  getElementById: () => mkEl(), createElement: () => mkEl(),
  querySelector: () => mkEl(), querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, exitPointerLock() {}, pointerLockElement: null, body: { appendChild() {} },
};
global.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() {}, location: { origin: 'http://x' } };
global.innerWidth = 1280; global.innerHeight = 720;
global.performance = { now: () => Date.now() };
global.addEventListener = () => {}; global.removeEventListener = () => {};
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
global.io = () => ({ on() {}, off() {}, emit() {}, connect() {}, disconnect() {}, once() {} });

const FPSGame = new Function('THREE', 'document', 'window', 'performance', 'addEventListener', 'requestAnimationFrame', 'removeEventListener', src + '\nreturn FPSGame;')(THREE, global.document, global.window, global.performance, global.addEventListener, global.requestAnimationFrame, global.removeEventListener);

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };
const where = (e) => {
  const st = (e.stack || '').split('\n').slice(1, 3);
  for (const line of st) {
    const m = line.match(/<anonymous>:(\d+):(\d+)/);
    if (m) { const ln = parseInt(m[1], 10); const lines = src.split('\n'); return lines.slice(Math.max(0, ln - 2), ln + 1).map((l, i) => (Math.max(0, ln - 2) + i + 1 === ln ? '>>' : '  ') + l.trim().slice(0, 100)).join('\n      '); }
  }
  return '';
};

try {
  const g = new FPSGame({
    canvas: { addEventListener() {}, removeEventListener() {}, style: {}, requestPointerLock() { return { catch() {} }; } },
    socket: { on() {}, off() {}, emit() {} },
    room: { mode: 'conquest', map: 'desert_storm', name: 'test' },
    team: 'alpha', nick: '테스터',
    state: { score: { CT: 0, T: 0 }, round: 1, phase: 'buy', flags: {} },
  });
  ok('FPSGame 생성', !!g);
  g.start();
  ok('start() 실행', !!g.scene && !!g.renderer && !!g.vmRig);

  const now = performance.now();
  let err = null;
  try { for (let i = 0; i < 60; i += 1) g.updateViewmodel(0.016, now + i * 16); } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('updateViewmodel 60프레임 무예외', !err, err || '');

  // 에임 스웨이 입력 후 동작
  err = null;
  try {
    g.vmSwayX = 0.04; g.vmSwayY = -0.03; g.vmStrafe = 1; g.grounded = false;
    for (let i = 0; i < 20; i += 1) g.updateViewmodel(0.016, now + i * 16);
  } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('스웨이/스트레이프/공중 상태 무예외', !err, err || '');

  // 재장전 3단계 전 구간
  err = null;
  try {
    for (const p of [0.1, 0.3, 0.5, 0.6, 0.8, 0.95]) {
      g.reloading = true; g.vmReloadStart = now - p * g.vmReloadDur; g.vmReloadDur = 1500;
      g.updateViewmodel(0.016, now);
    }
  } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('재장전 단계별 무예외', !err, err || '');

  err = null;
  try { for (let i = 0; i < 15; i += 1) { g.switchWeapon(i); g.updateViewmodel(0.016, now); } } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('15종 무기 전환 무예외', !err, err || '');

  err = null;
  try { g.aiming = true; g.vmAdsK = 1; for (let i = 0; i < 10; i += 1) g.updateViewmodel(0.016, now + i * 16); g.aiming = false; } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('조준(ADS) 무예외', !err, err || '');

  err = null;
  try { g.emote = 'L'; g.emoteT = 2; for (let i = 0; i < 20; i += 1) g.updateViewmodel(0.016, now + i * 16); g.emote = ''; g.emoteT = 0; } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('이모트 무예외', !err, err || '');

  err = null;
  try { for (let i = 0; i < 20; i += 1) { g.updateMove(0.016); g.updateHUD(); } g.renderer.render(g.scene, g.camera); } catch (e) { err = e.message + ' @ ' + where(e); }
  ok('이동/HUD/렌더 무예외', !err, err || '');

  ok('총 15개 생성', g.vmGuns && g.vmGuns.length === 15, String(g.vmGuns && g.vmGuns.length));
  ok('양손 생성', !!g.vmArmL && !!g.vmArmR);
  ok('스웨이 상태 존재', typeof g.vmSwayX === 'number' && typeof g.vmStrafe === 'number');
} catch (e) {
  ok('테스트 실행', false, e.message + ' @ ' + where(e));
}

console.log(`DONE pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);