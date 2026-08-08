/**
 * Neighbor Indicator — 屏幕边缘方向指示器
 *
 * 聚焦在 FOCUS_ZOOM 时，相邻站点可能在视口外。
 * 此模块在屏幕空间（app.stage，不受 world 变换影响）绘制
 * 虚线 + 箭头 + 标签，指向离屏的相邻站点，
 * 让用户感知当前数字在海岸线上的相对位置。
 */
import * as PIXI from 'pixi.js';
import type { CameraState } from './Camera';

const FONT = 'Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Inter, sans-serif';

export interface IndicatorTarget {
  id: string;
  name: string;
  worldX: number;
  worldY: number;
  color: number;
}

export class NeighborIndicator {
  /** 添加到 app.stage（屏幕空间） */
  readonly container: PIXI.Container;
  private targets: IndicatorTarget[] = [];
  private fromWorld = { x: 0, y: 0 };
  private viewport = { width: 0, height: 0 };

  constructor() {
    this.container = new PIXI.Container();
    this.container.interactiveChildren = false;
  }

  setViewport(width: number, height: number): void {
    this.viewport = { width, height };
  }

  setOrigin(worldX: number, worldY: number): void {
    this.fromWorld = { x: worldX, y: worldY };
  }

  setTargets(targets: IndicatorTarget[]): void {
    this.targets = targets;
  }

  clear(): void {
    this.targets = [];
    this.container.removeChildren();
  }

  private toScreen(wx: number, wy: number, cam: CameraState) {
    return {
      x: (wx - cam.x) * cam.zoom + this.viewport.width / 2,
      y: (wy - cam.y) * cam.zoom + this.viewport.height / 2,
    };
  }

  /**
   * 计算线段 from→to 与视口矩形（含 margin）的交点。
   * 返回从 from 出发、碰到的第一个边界点。
   */
  private clipToEdge(
    fx: number, fy: number,
    tx: number, ty: number,
    margin: number
  ): { x: number; y: number } {
    const minX = margin;
    const maxX = this.viewport.width - margin;
    const minY = margin;
    const maxY = this.viewport.height - margin;

    const dx = tx - fx;
    const dy = ty - fy;
    let t = 1;

    if (dx > 0) {
      const tX = (maxX - fx) / dx;
      if (tX >= 0 && tX < t) t = tX;
    } else if (dx < 0) {
      const tX = (minX - fx) / dx;
      if (tX >= 0 && tX < t) t = tX;
    }
    if (dy > 0) {
      const tY = (maxY - fy) / dy;
      if (tY >= 0 && tY < t) t = tY;
    } else if (dy < 0) {
      const tY = (minY - fy) / dy;
      if (tY >= 0 && tY < t) t = tY;
    }

    return { x: fx + dx * t, y: fy + dy * t };
  }

  update(camera: CameraState): void {
    this.container.removeChildren();
    if (this.targets.length === 0) return;

    const w = this.viewport.width;
    const h = this.viewport.height;
    const edgeMargin = 45;

    const fromRaw = this.toScreen(this.fromWorld.x, this.fromWorld.y, camera);
    // 钳制起点到视口内（动画期间 origin 可能在屏幕外）
    const from = {
      x: Math.max(edgeMargin, Math.min(w - edgeMargin, fromRaw.x)),
      y: Math.max(edgeMargin, Math.min(h - edgeMargin, fromRaw.y)),
    };

    for (const target of this.targets) {
      const ts = this.toScreen(target.worldX, target.worldY, camera);

      const pad = 50;
      const offScreen =
        ts.x < pad || ts.x > w - pad || ts.y < pad || ts.y > h - pad;
      if (!offScreen) continue;

      // 线段 from→ts 与视口边界的交点
      const edge = this.clipToEdge(from.x, from.y, ts.x, ts.y, edgeMargin);

      const dx = ts.x - from.x;
      const dy = ts.y - from.y;
      const angle = Math.atan2(dy, dx);
      const lineLen = Math.hypot(edge.x - from.x, edge.y - from.y);

      // ── 虚线 from → edge ──
      const line = new PIXI.Graphics();
      const dashLen = 9;
      const gapLen = 6;
      const ndx = lineLen > 0 ? (edge.x - from.x) / lineLen : 0;
      const ndy = lineLen > 0 ? (edge.y - from.y) / lineLen : 0;
      let d = 0;
      while (d < lineLen) {
        const dEnd = Math.min(d + dashLen, lineLen);
        line
          .lineStyle(1.5, target.color, 0.5)
          .moveTo(from.x + ndx * d, from.y + ndy * d)
          .lineTo(from.x + ndx * dEnd, from.y + ndy * dEnd);
        d = dEnd + gapLen;
      }

      // ── 箭头 at edge, pointing toward target ──
      const arrow = new PIXI.Graphics();
      const sz = 11;
      arrow.beginFill(target.color, 0.9);
      arrow.moveTo(sz, 0);
      arrow.lineTo(-sz * 0.5, sz * 0.65);
      arrow.lineTo(-sz * 0.5, -sz * 0.65);
      arrow.closePath();
      arrow.endFill();
      arrow.rotation = angle;
      arrow.position.set(edge.x, edge.y);

      // ── 标签 at edge, offset inward ──
      const label = new PIXI.Text(
        target.name,
        new PIXI.TextStyle({
          fontFamily: FONT,
          fontSize: 14,
          fill: 0xeaf6ff,
          stroke: 0x04101c,
          strokeThickness: 4,
          padding: 4,
        })
      );
      label.anchor.set(0.5);
      const inwardAngle = angle + Math.PI;
      const labelOffset = 26;
      let lx = edge.x + Math.cos(inwardAngle) * labelOffset;
      let ly = edge.y + Math.sin(inwardAngle) * labelOffset;
      lx = Math.max(60, Math.min(w - 60, lx));
      ly = Math.max(30, Math.min(h - 30, ly));
      label.position.set(lx, ly);

      this.container.addChild(line, arrow, label);
    }
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
