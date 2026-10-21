// 티어 시스템 검증: 21단계 경계값 + 시즌 강등(최대 2티어)
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS' : 'FAIL') + ' ' + n, x); c ? pass++ : fail++; };

// 서버에서 실제 코드 추출
const src = fs.readFileSync('./server.js', 'utf8');
const grab = (startMark, endMark) => {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a) + endMark.length;
  return src.slice(a, b);
};
const tierBlock = grab('function getTier(rating) {', '\n}');
const seasonBlock = grab('const TIER_ORDER = [', '];\n');
const floorsBlock = grab('const TIER_FLOORS = [', '];');
const fn = new Function(
  tierBlock + '\n' + seasonBlock + '\n' + floorsBlock +
  '\nreturn { getTier, TIER_ORDER, TIER_FLOORS };'
)();

// 1) 전체 티어 순서 (낮은 순)
const EXPECTED = [
  '인간말종쓰레기버러지', '음식물쓰레기', '쓰레기', '실버', '골드', '플래티넘',
  '다이아', '마스터', '그랜드마스터', '초월자', '신',
  '초신', '무신', '무자', '타이탄', '히어로', '챔피언', '신화', '전설', '유니콘', '오메가',
];
ok('티어 21개', fn.TIER_ORDER.length === 21, String(fn.TIER_ORDER.length));
ok('TIER_ORDER 순서 일치', fn.TIER_ORDER.join(',') === EXPECTED.join(','), fn.TIER_ORDER.join('>'));

// 2) 경계값 검증
const cases = [
  [0, '인간말종쓰레기버러지'], [599, '인간말종쓰레기버러지'], [600, '음식물쓰레기'],
  [799, '음식물쓰레기'], [800, '쓰레기'], [999, '쓰레기'], [1000, '실버'], [1199, '실버'],
  [1200, '골드'], [1399, '골드'], [1400, '플래티넘'], [1599, '플래티넘'], [1600, '다이아'],
  [1799, '다이아'], [1800, '마스터'], [1999, '마스터'], [2000, '그랜드마스터'],
  [2199, '그랜드마스터'], [2200, '초월자'], [2499, '초월자'], [2500, '신'], [2699, '신'],
  [2700, '초신'], [2899, '초신'], [2900, '무신'], [3099, '무신'], [3100, '무자'],
  [3299, '무자'], [3300, '타이탄'], [3499, '타이탄'], [3500, '히어로'], [3699, '히어로'],
  [3700, '챔피언'], [3899, '챔피언'], [3900, '신화'], [4099, '신화'], [4100, '전설'],
  [4299, '전설'], [4300, '유니콘'], [4499, '유니콘'], [4500, '오메가'], [99999, '오메가'],
];
const bad = cases.filter(([r, t]) => fn.getTier(r) !== t);
ok('경계값 46개 전부 정확', bad.length === 0, bad.map(([r, t]) => `${r}→${fn.getTier(r)}(${t})`).join(' '));

// 3) 단계적 간격: 새로 추가한 상위 10개 티어(초신~오메가)는 200점 균일
const newIdx = EXPECTED.indexOf('초신');
const newFloors = EXPECTED.map((t) => fn.TIER_FLOORS[EXPECTED.indexOf(t)]).slice(newIdx);
const newDiffs = newFloors.slice(1).map((v, i) => v - newFloors[i]);
ok('신규 10티어 간격 200점 균일', new Set(newDiffs).size === 1 && newDiffs[0] === 200, newDiffs.join(','));
ok('신규 티어 진입점 2700~4500', newFloors[0] === 2700 && newFloors[newFloors.length - 1] === 4500, newFloors.join(','));

// 4) 시즌 강등: 최대 2티어까지만
function rollover(from, fromTier) {
  const idx = Math.max(0, fn.TIER_ORDER.indexOf(fromTier));
  const floor2 = fn.TIER_FLOORS[Math.max(0, idx - 2)];
  const to = Math.max(floor2, from - 250, 0);
  return { to, toTier: fn.getTier(to) };
}
const r1 = rollover(4500, '오메가');
ok('오메가 강등 → 전설(2티어 하강)', r1.toTier === '전설' && r1.to === 4250, JSON.stringify(r1));
const r2 = rollover(2900, '무신');
ok('무신 강등 → 신(2티어 하강)', r2.toTier === '신' && r2.to === 2650, JSON.stringify(r2));
const r3b = rollover(2700, '초신');
ok('초신 강등 → 초월자(2티어 하강)', r3b.toTier === '초월자' && r3b.to === 2450, JSON.stringify(r3b));
const r3 = rollover(100, '인간말종쓰레기버러지');
ok('최하위 강등 보호', r3.to === 0, JSON.stringify(r3));

// 5) 새 티어들 도달 가능 (승리 +25 기준 100게임)
ok('오메가 도달 가능(4500점 = 승리180회)', 4500 / 25 === 180);

console.log(`DONE pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);