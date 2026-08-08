/**
 * Evaluator — 表达式求值器
 *
 * 将 AST 节点求值为 Magnitude 对象。
 * 使用对数域运算，避免直接计算超大整数。
 *
 * 运算规则：
 *   a + b: 若量级差 > 10，大数主导；否则 log-sum-exp
 *   a × b: log10(a×b) = log10(a) + log10(b)
 *   a ^ b: log10(a^b) = b × log10(a)；若 b 巨大则升级为 tower
 *   n!:    小数精确，大数用 Stirling 近似
 *   a ^^ b: 幂塔描述符 { base: a, height: b }
 *   a ↑^n b: 箭头描述符
 */

import { type ExprNode, parseExpression } from './expressionParser';
import {
  type Magnitude,
  fromNumber,
  fromBigInt,
  powerOf10,
  log10Factorial,
  compareMagnitude,
} from './magnitude';

// ── 命名常量表 ──
// googol/googolplex 使用精确的 log/tower 类型，而非 named，
// 使其正确归入对应 tier（log/tower < arrow < named）。

const NAMED_MAGNITUDES: Record<string, Magnitude> = {
  googol: { kind: 'log', log10: 100 },
  googolplex: { kind: 'tower', base: 10, height: 2, label: '古戈尔普勒克斯' },
  graham: { kind: 'named', id: 'graham', rank: 9000, label: '葛立恒数' },
  tree3: { kind: 'named', id: 'tree3', rank: 9500, label: 'TREE(3)' },
  rayo: { kind: 'named', id: 'rayo', rank: 10000, label: '拉约数' },
};

// ── 辅助：获取 log10 值 ──
// 仅用于算术运算（加法/乘法/幂运算）的粗略 log10 估计。
// 不同 tier 的值域严格递增，避免旧的跨 tier 混乱。

function getLog10(m: Magnitude): number {
  switch (m.kind) {
    case 'exact': return m.log10;
    case 'log': return m.log10;
    case 'tower':
      // 幂塔的 log10 极大；用 height 递增保证 tower > log
      return 1e6 + m.height * 1e6;
    case 'arrow':
      // 箭头的 log10 更大；保证 arrow > tower
      return 1e9 + m.arrows * 1e9;
    case 'named':
      // 命名数最大；保证 named > arrow
      return 1e12 + m.rank * 1e6;
  }
}

/** 将 Magnitude 尽量降级为 log 表示 */
function toLog(m: Magnitude): number {
  return getLog10(m);
}

/** 尝试将 Magnitude 转为 number（仅小数） */
function tryToNumber(m: Magnitude): number | null {
  if (m.kind === 'exact' && m.value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(m.value);
  }
  if (m.kind === 'log' && m.log10 <= 15) {
    return Math.pow(10, m.log10);
  }
  return null;
}

// ── 二元运算 ──

function addMag(a: Magnitude, b: Magnitude): Magnitude {
  const la = getLog10(a);
  const lb = getLog10(b);

  // 若量级差 > 15，大数主导
  if (Math.abs(la - lb) > 15) {
    return compareMagnitude(a, b) > 0 ? a : b;
  }

  // 两个都是精确小数 → 精确加法
  if (a.kind === 'exact' && b.kind === 'exact') {
    const sum = a.value + b.value;
    if (sum <= BigInt(10) ** 1000n) {
      return fromBigInt(sum);
    }
  }

  // log-sum-exp: log10(a + b) = log10(a) + log10(1 + 10^(lb - la))
  const maxLog = Math.max(la, lb);
  const minLog = Math.min(la, lb);
  const result = maxLog + Math.log10(1 + Math.pow(10, minLog - maxLog));
  return { kind: 'log', log10: result };
}

function mulMag(a: Magnitude, b: Magnitude): Magnitude {
  const la = getLog10(a);
  const lb = getLog10(b);

  // 两个精确 → 精确乘法
  if (a.kind === 'exact' && b.kind === 'exact') {
    const product = a.value * b.value;
    if (product <= BigInt(10) ** 1000n) {
      return fromBigInt(product);
    }
  }

  // log10(a × b) = log10(a) + log10(b)
  return { kind: 'log', log10: la + lb };
}

function powMag(base: Magnitude, exp: Magnitude): Magnitude {
  const lb = getLog10(base);
  const le = getLog10(exp);

  // 特殊情况：10^x
  const baseNum = tryToNumber(base);
  if (baseNum === 10) {
    return powerOf10(exp);
  }

  // 指数是精确小数
  const expNum = tryToNumber(exp);
  if (expNum !== null && expNum <= 1000) {
    // log10(a^b) = b × log10(a)
    const resultLog = expNum * lb;

    // 底数也是精确小数 → 尝试精确计算
    if (base.kind === 'exact' && baseNum !== null && expNum <= 300) {
      let result = 1n;
      const baseBi = base.value;
      for (let i = 0; i < expNum; i++) {
        result *= baseBi;
        if (result > BigInt(10) ** 1000n) {
          // 超出精确范围，转 log
          return { kind: 'log', log10: resultLog };
        }
      }
      return fromBigInt(result);
    }

    if (resultLog <= 1e15) {
      return { kind: 'log', log10: resultLog };
    }
    // 结果太大 → 幂塔
    return { kind: 'tower', base: baseNum ?? 10, height: 2, label: `${baseNum}^${describeExp(exp)}` };
  }

  // 指数也是巨大数 → 升级为幂塔
  if (le > 15) {
    const baseN = baseNum ?? 10;
    return {
      kind: 'tower',
      base: baseN,
      height: 2,
      label: `${baseN}^${describeExp(exp)}`,
    };
  }

  // 一般情况：log10(a^b) = b × log10(a)
  const resultLog = le * lb;
  if (resultLog <= 1e15) {
    return { kind: 'log', log10: resultLog };
  }
  return {
    kind: 'tower',
    base: baseNum ?? 10,
    height: 2,
    label: `${baseNum ?? 'a'}^${describeExp(exp)}`,
  };
}

function describeExp(m: Magnitude): string {
  switch (m.kind) {
    case 'exact': return m.value.toString();
    case 'log': return `10^${m.log10.toFixed(0)}`;
    case 'tower': return m.label;
    case 'arrow': return `${m.left}↑${m.arrows}${m.right}`;
    case 'named': return m.label;
  }
}

function tetrateMag(base: Magnitude, height: Magnitude): Magnitude {
  const baseNum = tryToNumber(base);
  const heightNum = tryToNumber(height);

  const b = baseNum ?? 10;
  const h = heightNum ?? 2;

  if (h <= 0) return fromNumber(1);
  if (h === 1) return base;
  if (h === 2 && b <= 100) {
    // a^^2 = a^a，尝试精确
    return powMag(base, base);
  }

  // 幂塔描述符
  return {
    kind: 'tower',
    base: b,
    height: h,
    label: `${b}^^${h}`,
  };
}

function arrowMag(left: Magnitude, arrows: number, right: Magnitude): Magnitude {
  const leftNum = tryToNumber(left);
  const rightNum = tryToNumber(right);

  // 单箭头 = 幂运算
  if (arrows === 1) {
    return powMag(left, right);
  }

  // 双箭头 = 迭幂
  if (arrows === 2) {
    return tetrateMag(left, right);
  }

  const l = leftNum ?? 3;
  const r = rightNum ?? 3;

  // 3+ 箭头：尝试逐步归约到更简单的类型
  // a↑^n 1 = a
  if (r === 1) return left;

  // a↑^n 2 = a↑^(n-1) a
  if (r === 2) return arrowMag(left, arrows - 1, left);

  // r >= 3: 尝试归约
  const reduced = tryReduceArrow(l, arrows, r);
  if (reduced !== null) return reduced;

  // 无法归约 — 使用 arrow 描述符
  // approxTowerHeight 设为 Infinity 表示量级超出可表示范围
  return {
    kind: 'arrow',
    left: l,
    arrows,
    right: r,
    approxTowerHeight: Infinity,
  };
}

/** 格式化箭头表达式标签 */
function formatArrowLabel(left: number, arrows: number, right: number): string {
  return `${left}↑${'↑'.repeat(arrows - 1)}${right}`;
}

/**
 * 尝试将 base↑^arrows right 归约到更简单的 Magnitude。
 * 核心思路：a↑^n r = a↑^(n-1)(a↑^n(r-1))，递归降低 right 或 arrows。
 * 当 arrows 降到 2 时，结果为 tower(base, height)。
 * 返回 null 表示无法归约（值太大）。
 */
function tryReduceArrow(base: number, arrows: number, right: number): Magnitude | null {
  if (arrows <= 2) return null; // 由 tetrateMag 处理
  if (right === 1) return fromNumber(base);
  if (right === 2) return tryReduceArrow(base, arrows - 1, base);

  // right >= 3: 先计算 a↑^n(right-1) 的数值
  const innerValue = computeArrowAsNumber(base, arrows, right - 1);
  if (innerValue === null) return null; // 内部值太大，无法继续

  // 用 innerValue 作为 right，降低 arrows
  if (arrows - 1 === 2) {
    // a↑↑(innerValue) = 幂塔，高度 = innerValue
    if (innerValue <= 1e15) {
      return { kind: 'tower', base, height: innerValue, label: formatArrowLabel(base, arrows, right) };
    }
    return null;
  }

  // arrows - 1 >= 3: 递归归约
  if (innerValue <= 100) {
    return tryReduceArrow(base, arrows - 1, innerValue);
  }

  return null;
}

/**
 * 计算 base↑^arrows right 的数值，如果足够小（<= 1e15）。
 * 返回 null 表示值太大无法用 number 表示。
 */
function computeArrowAsNumber(base: number, arrows: number, right: number): number | null {
  if (arrows === 1) {
    const result = Math.pow(base, right);
    return Number.isFinite(result) && result <= 1e15 ? result : null;
  }
  if (arrows === 2) {
    // base↑↑right = 迭幂
    if (right === 0) return 1;
    if (right === 1) return base;
    if (right === 2) {
      const result = Math.pow(base, base);
      return result <= 1e15 ? result : null;
    }
    if (right === 3 && base <= 10) {
      const result = Math.pow(base, Math.pow(base, base));
      return result <= 1e15 ? result : null;
    }
    if (right === 4 && base === 2) return 65536; // 2^(2^(2^2)) = 2^16
    return null; // 幂塔，太大
  }

  // arrows >= 3
  if (right === 1) return base;
  if (right === 2) return computeArrowAsNumber(base, arrows - 1, base);

  // right >= 3: a↑^n right = a↑^(n-1)(a↑^n(right-1))
  const inner = computeArrowAsNumber(base, arrows, right - 1);
  if (inner === null) return null;
  return computeArrowAsNumber(base, arrows - 1, inner);
}

function factorialMag(operand: Magnitude): Magnitude {
  const n = tryToNumber(operand);

  if (n !== null && n <= 170) {
    // 精确计算
    let result = 1n;
    for (let i = 2n; i <= BigInt(n); i++) {
      result *= i;
    }
    if (result <= BigInt(10) ** 1000n) {
      return fromBigInt(result);
    }
    return { kind: 'log', log10: log10Factorial(n) };
  }

  if (n !== null) {
    // Stirling 近似
    return { kind: 'log', log10: log10Factorial(n) };
  }

  // 操作数不是小数 → log10(n!) ≈ n × log10(n)
  const logN = getLog10(operand);
  const approx = logN * logN; // 非常粗略
  return { kind: 'log', log10: approx };
}

// ── 主求值函数 ──

export function evaluate(node: ExprNode): Magnitude {
  switch (node.type) {
    case 'num':
      return fromNumber(node.value);

    case 'named':
      if (node.id in NAMED_MAGNITUDES) {
        return NAMED_MAGNITUDES[node.id];
      }
      throw new Error(`未知命名常量: ${node.id}`);

    case 'binop': {
      const left = evaluate(node.left);
      const right = evaluate(node.right);
      switch (node.op) {
        case 'add': return addMag(left, right);
        case 'mul': return mulMag(left, right);
        case 'pow': return powMag(left, right);
        case 'tetrate': return tetrateMag(left, right);
      }
    }

    case 'factorial': {
      const operand = evaluate(node.operand);
      return factorialMag(operand);
    }

    case 'arrow': {
      const left = evaluate(node.left);
      const right = evaluate(node.right);
      return arrowMag(left, node.arrows, right);
    }

    case 'func': {
      const args = node.args.map(evaluate);
      switch (node.name) {
        case 'factorial':
          if (args.length !== 1) throw new Error('factorial 需要 1 个参数');
          return factorialMag(args[0]);
        case 'tower':
          if (args.length !== 2) throw new Error('tower 需要 2 个参数 (base, height)');
          return tetrateMag(args[0], args[1]);
        default:
          throw new Error(`未知函数: ${node.name}`);
      }
    }
  }
}

/** 从文本表达式直接求值 */
export function evaluateExpression(input: string): Magnitude {
  const ast = parseExpression(input);
  return evaluate(ast);
}
