/**
 * Magnitude Engine — 量级引擎
 *
 * 不直接计算超大整数，而是按「量级层级」分类和比较。
 * 支持从精确小数到命名怪物的全谱系。
 *
 * 层级体系（从小到大）：
 *   exact    → BigInt 精确值（≤ 10^1000 左右）
 *   log      → log10 对数表示（10^100 ~ 10^10^10）
 *   tower    → 幂塔描述符（10^^n）
 *   arrow    → 高德纳箭头描述符（a↑^n b）
 *   named    → 命名怪物（Graham, TREE(3), Rayo 等）
 */

// ── 量级类型 ──

export interface ExactMag {
  kind: 'exact';
  value: bigint;
  /** log10(value), 精确值可用 Number(value.toString().length - 1) 估算 */
  log10: number;
}

export interface LogMag {
  kind: 'log';
  /** log10(value) — 对数域表示 */
  log10: number;
}

export interface TowerMag {
  kind: 'tower';
  base: number;
  height: number;
  /** 描述字符串 */
  label: string;
}

export interface ArrowMag {
  kind: 'arrow';
  left: number;
  arrows: number;
  right: number;
  /** 近似幂塔高度（用于比较） */
  approxTowerHeight: number;
}

export interface NamedMag {
  kind: 'named';
  id: string;
  /** 展览序数排名（非数学值，仅用于排序） */
  rank: number;
  label: string;
}

export type Magnitude = ExactMag | LogMag | TowerMag | ArrowMag | NamedMag;

// ── 分级体系 ──
// tier 越高，量级越大。跨层级比较时直接按 tier 定序，
// 不再将不同层级混入同一标量（旧 rankValue 的根因 bug）。

const TIER_ORDER: Record<Magnitude['kind'], number> = {
  exact: 0,
  log: 1,
  tower: 2,
  arrow: 3,
  named: 4,
};

// ── 辅助函数 ──

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function log10BigInt(n: bigint): number {
  const s = n.toString();
  if (s.length <= 15) return Math.log10(Number(n));
  // 估算：位数 + 首几位数字的对数尾数
  const digits = s.length - 1;
  const leading = parseFloat(s.slice(0, 4));
  return digits + Math.log10(leading / 1000);
}

/** 安全的 log10(x!)，使用 Stirling 近似 */
export function log10Factorial(n: number): number {
  if (n <= 1) return 0;
  if (n <= 170) {
    const fact = factorialSmall(n);
    return log10BigInt(fact);
  }
  // Stirling: log10(n!) ≈ n·log10(n/e) + 0.5·log10(2πn)
  return n * Math.log10(n / Math.E) + 0.5 * Math.log10(2 * Math.PI * n);
}

function factorialSmall(n: number): bigint {
  let result = 1n;
  for (let i = 2n; i <= BigInt(n); i++) {
    result *= i;
  }
  return result;
}

// ── 构造器 ──

export function fromNumber(n: number): Magnitude {
  if (!Number.isFinite(n)) return { kind: 'log', log10: Infinity };
  if (n < 0) return { kind: 'log', log10: NaN };
  if (n === 0) return { kind: 'log', log10: -Infinity };
  if (Number.isInteger(n) && n <= 1e15) {
    const bi = BigInt(n);
    return { kind: 'exact', value: bi, log10: Math.log10(n) };
  }
  return { kind: 'log', log10: Math.log10(n) };
}

export function fromBigInt(n: bigint): Magnitude {
  const s = n.toString();
  if (s.length <= 1000) {
    return { kind: 'exact', value: n, log10: log10BigInt(n) };
  }
  // 超过 1000 位，转 log
  return { kind: 'log', log10: log10BigInt(n) };
}

/** 从 10^exp 构造 */
export function powerOf10(exp: Magnitude): Magnitude {
  if (exp.kind === 'exact') {
    const e = Number(exp.value);
    if (e <= 1000) {
      // 10^1000 可以精确表示为 BigInt
      let val = 1n;
      for (let i = 0; i < e; i++) val *= 10n;
      return { kind: 'exact', value: val, log10: e };
    }
    if (e <= 1e15) {
      return { kind: 'log', log10: e };
    }
    // 指数本身就是巨大数 → 幂塔
    return { kind: 'tower', base: 10, height: 2, label: `10^10^${Math.floor(e)}` };
  }
  if (exp.kind === 'log') {
    if (exp.log10 <= 1e15) {
      return { kind: 'log', log10: exp.log10 };
    }
    // 10^(10^x) → 幂塔
    return { kind: 'tower', base: 10, height: 2, label: `10^10^${exp.log10}` };
  }
  if (exp.kind === 'tower') {
    // 10^(tower) → 更高的塔
    return { kind: 'tower', base: 10, height: exp.height + 1, label: `10^^${exp.height + 1}` };
  }
  if (exp.kind === 'arrow' || exp.kind === 'named') {
    // 超出可计算范围
    return { kind: 'tower', base: 10, height: 100, label: '10^^100+' };
  }
  return { kind: 'log', log10: NaN };
}

// ── 比较 ──

/** 同层级内的精比标量（仅用于同 tier 比较时区分大小） */
function tierRank(m: Magnitude): number {
  switch (m.kind) {
    case 'exact':
      return m.log10;
    case 'log':
      return m.log10;
    case 'tower':
      // 幂塔：height 是主因素，base 次之
      return m.height * 1000 + Math.log10(m.base);
    case 'arrow':
      // 箭头：arrows 数为主，approachTowerHeight 为辅
      return m.arrows * 10000 + m.approxTowerHeight;
    case 'named':
      return m.rank;
  }
}

/**
 * 分级比较：先按 tier 定序（exact < log < tower < arrow < named），
 * 同 tier 再用 tierRank 精比。这修复了旧 rankValue 将不同层级
 * 混入同一标量导致 Skewes(log10=1e10) > Graham(rank=9000) 的 bug。
 */
export function compareMagnitude(a: Magnitude, b: Magnitude): -1 | 0 | 1 {
  const ta = TIER_ORDER[a.kind];
  const tb = TIER_ORDER[b.kind];
  if (ta !== tb) return ta < tb ? -1 : 1;

  // 同层级 — 先用 tierRank 粗排
  const ra = tierRank(a);
  const rb = tierRank(b);
  if (ra < rb) return -1;
  if (ra > rb) return 1;

  // tierRank 相等时的结构化精比
  if (a.kind === 'exact' && b.kind === 'exact') {
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return 0;
  }
  if (a.kind === 'log' && b.kind === 'log') {
    if (a.log10 < b.log10) return -1;
    if (a.log10 > b.log10) return 1;
    return 0;
  }
  if (a.kind === 'tower' && b.kind === 'tower') {
    if (a.height !== b.height) return a.height < b.height ? -1 : 1;
    if (a.base !== b.base) return a.base < b.base ? -1 : 1;
    return 0;
  }
  if (a.kind === 'arrow' && b.kind === 'arrow') {
    if (a.arrows !== b.arrows) return a.arrows < b.arrows ? -1 : 1;
    if (a.approxTowerHeight !== b.approxTowerHeight)
      return a.approxTowerHeight < b.approxTowerHeight ? -1 : 1;
    return 0;
  }
  if (a.kind === 'named' && b.kind === 'named') {
    return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  }
  return 0;
}

// ── 站点引用 ──

export interface StationRef {
  id: string;
  name: string;
  scaleLevel: number;
  magnitude: Magnitude;
  /** 归一化排名 (0-100)，用于海岸线插值，人工标定 */
  displayRank: number;
}

// ── displayRank 计算 ──

/** 幂塔层级的 displayRank (15-50) */
function towerDisplayRank(height: number): number {
  if (height <= 1) return 8;
  if (height === 2) return 16;
  if (height === 3) return 20;
  if (height <= 10) return 20 + (height - 3) * 1.5; // 20-25.5
  if (height <= 100) return 25.5 + Math.log10(height / 10) * 2; // 25.5-27.5
  if (height <= 1000) return 27.5 + Math.log10(height / 100) * 2.5; // 27.5-30
  // 超高幂塔仍远不及 Graham，压缩到 30-40 而非 40-50
  return 30 + Math.min(10, Math.log10(height / 1000) * 2); // 30-40
}

/** 箭头层级的 displayRank (35-54.5)，渐近但不超越 Graham(55) */
function arrowDisplayRank(m: ArrowMag): number {
  const base = 30 + 22 * (1 - 1 / Math.max(1, m.arrows - 1));
  const leftBoost = Math.min(3, Math.log10(m.left) * 1.5);
  const heightBoost =
    Number.isFinite(m.approxTowerHeight) && m.approxTowerHeight > 0
      ? Math.min(7, Math.log10(m.approxTowerHeight) * 0.5)
      : 7;
  return Math.min(54.5, base + leftBoost + heightBoost);
}

/** 命名数层级的 displayRank，按 rank 映射到 35-100 */
function namedRankToDisplay(rank: number): number {
  if (rank <= 0) return 35;
  if (rank < 9000) return 35 + (rank / 9000) * 20; // 35-55
  if (rank < 9500) return 55 + ((rank - 9000) / 500) * 20; // 55-75
  if (rank < 10000) return 75 + ((rank - 9500) / 500) * 20; // 75-95
  return 95 + Math.min(5, (rank - 10000) / 1000); // 95-100
}

/**
 * 将任意 Magnitude 映射到统一的 displayRank (0-100)。
 * 与 compareMagnitude 单调一致：compareMagnitude(a,b)<0 ⟹ displayRank(a)<displayRank(b)。
 * 用于海岸线 scale_level 插值。
 */
export function computeDisplayRank(m: Magnitude): number {
  switch (m.kind) {
    case 'exact':
      return clamp(m.log10 * 1.25, 0, 8);
    case 'log':
      if (m.log10 <= 10) return clamp(8 + (m.log10 - 10) * 0.4, 0, 12);
      if (m.log10 <= 100) return 8 + (m.log10 - 10) * 0.044; // 8-12
      if (m.log10 <= 1e10) return 12 + Math.log10(m.log10 / 100) * 1.5; // 12-15
      return Math.min(16, 15 + Math.log10(Math.log10(m.log10)) * 0.5);
    case 'tower':
      return towerDisplayRank(m.height);
    case 'arrow':
      return arrowDisplayRank(m);
    case 'named':
      return namedRankToDisplay(m.rank);
  }
}

/**
 * 将用户创建的 Magnitude 映射到海岸线的 scale_level 坐标。
 * 使用 displayRank 在两个已知站点之间插值；超出范围则延伸。
 */
export function toScaleLevel(mag: Magnitude, stations: StationRef[]): number {
  const sorted = [...stations].sort((a, b) => a.displayRank - b.displayRank);
  if (sorted.length === 0) return 0;

  const userRank = computeDisplayRank(mag);

  // 小于最小站点
  if (userRank <= sorted[0].displayRank) {
    if (userRank === sorted[0].displayRank) return sorted[0].scaleLevel;
    return Math.max(0, sorted[0].scaleLevel - 0.5);
  }

  // 在站点之间插值
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (userRank >= lo.displayRank && userRank <= hi.displayRank) {
      const t = hi.displayRank > lo.displayRank
        ? (userRank - lo.displayRank) / (hi.displayRank - lo.displayRank)
        : 0.5;
      return lo.scaleLevel + t * (hi.scaleLevel - lo.scaleLevel);
    }
  }

  // 大于最大站点
  const last = sorted[sorted.length - 1];
  if (userRank === last.displayRank) return last.scaleLevel;

  // 超出最大站点 — 向右延伸（但不触碰 ∞）
  const overflow = Math.min(0.5, (userRank - last.displayRank) / 100);
  return Math.min(last.scaleLevel + overflow, 6.4);
}

// ── 描述 ──

export function describeMagnitude(mag: Magnitude): string {
  switch (mag.kind) {
    case 'exact': {
      const digits = mag.value.toString().length;
      if (digits <= 6) return mag.value.toString();
      if (digits <= 20) return mag.value.toString();
      return `约 ${digits} 位的整数`;
    }
    case 'log': {
      if (!Number.isFinite(mag.log10)) return '∞';
      const e = mag.log10;
      if (e <= 6) return `(10^${e.toFixed(2)})`;
      if (e <= 100) return `10^${Math.floor(e)}`;
      if (e <= 1e6) return `10^${e.toExponential(2)}`;
      return `10^(10^${Math.log10(e).toFixed(2)})`;
    }
    case 'tower':
      return mag.label;
    case 'arrow':
      return `${mag.left}↑${'↑'.repeat(mag.arrows - 1)}${mag.right}`;
    case 'named':
      return mag.label;
  }
}

/** 人类可读的量级比较描述 */
export function scaleDescription(mag: Magnitude): string {
  const dr = computeDisplayRank(mag);
  if (dr < 2) return '日常数量级';
  if (dr < 6) return '千到百万级';
  if (dr < 10) return '万亿级';
  if (dr < 14) return '接近可观测宇宙的原子总数';
  if (dr < 17) return '与古戈尔同阶';
  if (dr < 21) return '超越物理世界的量级';
  if (dr < 35) return '幂塔领域';
  if (dr < 50) return '高阶幂塔领域';
  if (dr < 55) return '接近葛立恒数';
  if (dr < 75) return '葛立恒数级';
  if (dr < 95) return '终极命名数领域';
  return '超越已知命名';
}

/** 获取量级的近似 displayRank（用于显示和比较） */
export function approximateLog10(mag: Magnitude): number {
  return computeDisplayRank(mag);
}
