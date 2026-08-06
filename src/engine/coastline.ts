import * as PIXI from 'pixi.js';
import { clamp } from '../utils/scale';
import {
  LEFT_X,
  RIGHT_X,
  INFINITY_X,
  DATA_END_X,
  DATA_START_X,
  WORLD_HEIGHT,
} from '../worldConfig';

export interface CoastlineOptions {
  worldWidth: number;
  worldHeight: number;
  seed?: number;
  iterations?: number;
  roughness?: number;
  amplitude?: number;
}

export interface CoastlinePoint {
  x: number;
  y: number;
}

export interface CoastlineSample {
  x: number;
  y: number;
  angle: number;
  normalX: number;
  normalY: number;
}

export interface CoastlineModel {
  points: CoastlinePoint[];
  getPointAtX(x: number): CoastlineSample;
  draw(world: PIXI.Container, onInfinity?: () => void): PIXI.Container;
}

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成一条从左下攀升至右上的分形曲线（「认知之路」）。
 * 左端延伸很远并渐隐（无穷小方向，看不到尽头）；
 * 站点区为实线；拉约数之后变为渐隐虚线；
 * 曲线在 ∞ 处终止——∞ 是永恒的右端，曲线在终点处趋于水平。
 */
export function generateCoastline(opts: CoastlineOptions): CoastlineModel {
  const {
    worldHeight,
    seed = 20260805,
    iterations = 10,
    roughness = 0.52,
    amplitude = worldHeight * 0.1,
  } = opts;

  const rng = mulberry32(seed);

  const leftBaseY = worldHeight * 0.92;
  const dataEndY = worldHeight * 0.18;
  const infinityY = worldHeight * 0.10;

  // 分段基线：数据区线性上升，∞ 附近强缓出趋于水平
  const baseY = (x: number): number => {
    if (x <= DATA_END_X) {
      const t = (x - LEFT_X) / (DATA_END_X - LEFT_X);
      return leftBaseY + (dataEndY - leftBaseY) * t;
    }
    // DATA_END_X → INFINITY_X：缓出，曲线趋于水平
    const t = (x - DATA_END_X) / (INFINITY_X - DATA_END_X);
    const eased = 1 - Math.pow(1 - t, 3);
    return dataEndY + (infinityY - dataEndY) * eased;
  };

  let points: CoastlinePoint[] = [
    { x: LEFT_X, y: baseY(LEFT_X) },
    { x: RIGHT_X, y: baseY(RIGHT_X) },
  ];
  let amp = amplitude;
  for (let i = 0; i < iterations; i++) {
    const next: CoastlinePoint[] = [];
    for (let j = 0; j < points.length - 1; j++) {
      const a = points[j];
      const b = points[j + 1];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2 + (rng() * 2 - 1) * amp;
      next.push(a, { x: midX, y: midY });
    }
    next.push(points[points.length - 1]);
    points = next;
    amp *= roughness;
  }

  // 在 ∞ 附近压制噪声，让终点明显趋于水平
  const flattenStart = DATA_END_X - 2000;
  points = points.map((p) => {
    if (p.x < flattenStart) return p;
    const t = clamp((p.x - flattenStart) / (INFINITY_X - flattenStart), 0, 1);
    const target = baseY(p.x);
    return { x: p.x, y: p.y + (target - p.y) * t * 0.85 };
  });

  const yMin = worldHeight * 0.02;
  const yMax = worldHeight * 0.98;
  points = points.map((p) => ({ x: p.x, y: clamp(p.y, yMin, yMax) }));

  for (let s = 0; s < 2; s++) {
    const smoothed: CoastlinePoint[] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      smoothed.push({
        x: points[i].x,
        y: (points[i - 1].y + points[i].y * 2 + points[i + 1].y) / 4,
      });
    }
    smoothed.push(points[points.length - 1]);
    points = smoothed;
  }

  const indexOfX = (x: number): number => {
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].x < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const getPointAtX = (x: number): CoastlineSample => {
    if (x <= points[0].x) {
      const dx = points[1].x - points[0].x;
      const dy = points[1].y - points[0].y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: points[0].x, y: points[0].y, angle: Math.atan2(dy, dx), normalX: -dy / len, normalY: dx / len };
    }
    if (x >= points[points.length - 1].x) {
      const n = points.length;
      const dx = points[n - 1].x - points[n - 2].x;
      const dy = points[n - 1].y - points[n - 2].y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: points[n - 1].x, y: points[n - 1].y, angle: Math.atan2(dy, dx), normalX: -dy / len, normalY: dx / len };
    }
    const i = Math.max(1, indexOfX(x));
    const a = points[i - 1];
    const b = points[i];
    const t = (x - a.x) / (b.x - a.x || 1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x, y: a.y + dy * t, angle: Math.atan2(dy, dx), normalX: -dy / len, normalY: dx / len };
  };

  function traceRange(g: PIXI.Graphics, fromIdx: number, toIdx: number) {
    g.moveTo(points[fromIdx].x, points[fromIdx].y);
    for (let i = fromIdx + 1; i <= toIdx && i < points.length; i++) {
      g.lineTo(points[i].x, points[i].y);
    }
  }

  function dashedRange(g: PIXI.Graphics, fromIdx: number, toIdx: number, dashN: number, gapN: number) {
    let on = true;
    let count = 0;
    for (let i = fromIdx; i < toIdx; i++) {
      if (on) {
        if (count === 0) g.moveTo(points[i].x, points[i].y);
        else g.lineTo(points[i].x, points[i].y);
      }
      count++;
      if (on && count >= dashN) { on = false; count = 0; }
      else if (!on && count >= gapN) { on = true; count = 0; }
    }
  }

  return {
    points,
    getPointAtX,
    draw(world: PIXI.Container, onInfinity?: () => void): PIXI.Container {
      const iStart = indexOfX(DATA_START_X);
      const iEnd = indexOfX(DATA_END_X);
      const iInf = indexOfX(INFINITY_X);
      const last = points.length - 1;

      // 陆地多边形（曲线下方）
      const land = new PIXI.Graphics();
      land.beginFill(0x0c1f30, 0.9);
      land.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) land.lineTo(points[i].x, points[i].y);
      land.lineTo(points[last].x, worldHeight + 3000);
      land.lineTo(points[0].x, worldHeight + 3000);
      land.closePath();
      land.endFill();
      world.addChild(land);

      // 星点
      const stars = new PIXI.Graphics();
      const srng = mulberry32(seed + 99);
      for (let i = 0; i < 1200; i++) {
        const sx = LEFT_X + srng() * (RIGHT_X - LEFT_X);
        const sample = getPointAtX(sx);
        const sy = sample.y + srng() * (worldHeight - sample.y) * 0.9 + 20;
        const r = srng() * 1.5 + 0.3;
        stars.beginFill(0xffffff, srng() * 0.4 + 0.1).drawCircle(sx, sy, r).endFill();
      }
      world.addChild(stars);

      // 辉光底层
      const glow1 = new PIXI.Graphics();
      glow1.lineStyle(16, 0x67e8f9, 0.04);
      traceRange(glow1, 0, last);
      world.addChild(glow1);
      const glow2 = new PIXI.Graphics();
      glow2.lineStyle(7, 0x67e8f9, 0.1);
      traceRange(glow2, 0, last);
      world.addChild(glow2);

      // 左端延伸：多段渐隐实线（无穷小方向，看不到尽头）
      const leftSegs = 8;
      const leftSegLen = Math.max(1, Math.floor(iStart / leftSegs));
      for (let s = 0; s < leftSegs; s++) {
        const from = s * leftSegLen;
        const to = Math.min((s + 1) * leftSegLen, iStart);
        if (to <= from) continue;
        const alpha = 0.02 + (s / leftSegs) * 0.25;
        const g = new PIXI.Graphics();
        g.lineStyle(2, 0x9be8ff, alpha);
        traceRange(g, from, to);
        world.addChild(g);
      }

      // 站点区实线（主体）
      const main = new PIXI.Graphics();
      main.lineStyle(2.5, 0x9be8ff, 0.9);
      traceRange(main, iStart, iEnd);
      world.addChild(main);

      // 虚线延伸区（拉约数 → ∞），三段渐隐
      const seg = Math.max(1, Math.floor((iInf - iEnd) / 3));
      const dashAlphas = [0.5, 0.32, 0.15];
      const dashConfigs = [{ dash: 9, gap: 7 }, { dash: 7, gap: 10 }, { dash: 5, gap: 14 }];
      for (let s = 0; s < 3; s++) {
        const from = iEnd + s * seg;
        const to = Math.min(iEnd + (s + 1) * seg, iInf);
        if (to <= from) continue;
        const g = new PIXI.Graphics();
        g.lineStyle(2, 0xb8eaff, dashAlphas[s]);
        const cfg = dashConfigs[s];
        dashedRange(g, from, to, cfg.dash, cfg.gap);
        world.addChild(g);
      }

      // ∞ 符号（曲线终点，永恒的右端）
      const infPos = getPointAtX(INFINITY_X);
      const infWrap = new PIXI.Container();
      infWrap.position.set(infPos.x, infPos.y - 50);
      infWrap.name = 'infinity';

      const infGlow3 = new PIXI.Graphics();
      infGlow3.beginFill(0xffffff, 0.035).drawCircle(0, 0, 200).endFill();
      const infGlow2b = new PIXI.Graphics();
      infGlow2b.beginFill(0xe0f7ff, 0.06).drawCircle(0, 0, 120).endFill();
      const infGlow1 = new PIXI.Graphics();
      infGlow1.beginFill(0xe0f7ff, 0.12).drawCircle(0, 0, 64).endFill();

      const infText = new PIXI.Text('∞', new PIXI.TextStyle({
        fontFamily: 'Georgia, serif', fontSize: 180, fill: 0xffffff,
        stroke: 0x67e8f9, strokeThickness: 3, padding: 12,
      }));
      infText.anchor.set(0.5);
      infWrap.addChild(infGlow3, infGlow2b, infGlow1, infText);

      const farLabel = new PIXI.Text('拉约数离这里还很远…', new PIXI.TextStyle({
        fontFamily: 'Noto Sans CJK SC, Microsoft YaHei, sans-serif',
        fontSize: 22, fill: 0x6b8aa3, padding: 6,
      }));
      farLabel.anchor.set(0.5, 0);
      farLabel.position.set(0, 120);
      infWrap.addChild(farLabel);

      infWrap.eventMode = 'static';
      infWrap.cursor = 'pointer';
      infWrap.hitArea = new PIXI.Circle(0, 0, 130);
      infWrap.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
        e.stopPropagation();
        onInfinity?.();
      });
      world.addChild(infWrap);

      return infWrap;
    },
  };
}
