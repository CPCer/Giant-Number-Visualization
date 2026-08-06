import type { Container } from 'pixi.js';
import { clamp, easeInOutCubic } from '../utils/scale';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PanBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Camera 控制 world 容器的缩放与平移，并支持以某世界点为目标的平滑动画。
 * 变换关系：screen = world * zoom + position，position = viewport/2 - center * zoom
 *
 * 支持：
 * - panBounds 限制相机中心位置
 * - rightEdgePin 将视口右边缘钉在指定世界坐标（用于拉约数 → ∞ 永远在最右）
 * - setBounds / setRightEdgePin 可在运行时动态更新
 */
export class Camera {
  private world: Container;
  private getViewport: () => Viewport;
  private current: CameraState;
  private target: CameraState;
  private animating = false;
  private animFrom: CameraState | null = null;
  private animTo: CameraState | null = null;
  private animStart = 0;
  private animDuration = 0;

  minZoom: number;
  readonly maxZoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 当非 null 时，视口右边缘始终对齐此世界 x 坐标（横向拖动被禁用） */
  rightEdgePin: number | null = null;

  constructor(
    world: Container,
    getViewport: () => Viewport,
    initial: CameraState,
    minZoom = 0.015,
    maxZoom = 12,
    panBounds?: PanBounds
  ) {
    this.world = world;
    this.getViewport = getViewport;
    this.current = { ...initial };
    this.target = { ...initial };
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.minX = panBounds?.minX ?? -Infinity;
    this.maxX = panBounds?.maxX ?? Infinity;
    this.minY = panBounds?.minY ?? -Infinity;
    this.maxY = panBounds?.maxY ?? Infinity;
    this.apply();
  }

  get state(): CameraState {
    return { ...this.current };
  }

  /** 根据 rightEdgePin 计算钉定的 x 坐标 */
  private pinnedX(zoom: number): number {
    const vp = this.getViewport();
    return this.rightEdgePin! - vp.width / 2 / zoom;
  }

  private clampPos(x: number, y: number, zoom?: number): { x: number; y: number } {
    if (this.rightEdgePin !== null) {
      const z = zoom ?? this.target.zoom;
      return { x: this.pinnedX(z), y: clamp(y, this.minY, this.maxY) };
    }
    return {
      x: clamp(x, this.minX, this.maxX),
      y: clamp(y, this.minY, this.maxY),
    };
  }

  /** 设置 / 清除右边缘钉定 */
  setRightEdgePin(value: number | null): void {
    this.rightEdgePin = value;
    if (value !== null) {
      this.target.x = this.pinnedX(this.target.zoom);
      this.current.x = this.target.x;
      this.animating = false;
      this.apply();
    }
  }

  /** 动态更新平移边界与最小缩放 */
  setBounds(bounds: PanBounds, minZoom: number): void {
    this.minX = bounds.minX;
    this.maxX = bounds.maxX;
    this.minY = bounds.minY;
    this.maxY = bounds.maxY;
    this.minZoom = minZoom;
    if (this.rightEdgePin !== null) {
      this.target.x = this.pinnedX(this.target.zoom);
    } else {
      const p = this.clampPos(this.target.x, this.target.y);
      this.target.x = p.x;
      this.target.y = p.y;
    }
    this.target.zoom = clamp(this.target.zoom, this.minZoom, this.maxZoom);
    this.current.x = this.target.x;
    this.current.y = this.target.y;
    this.current.zoom = this.target.zoom;
    this.animating = false;
    this.apply();
  }

  setView(x: number, y: number, zoom: number): void {
    const z = clamp(zoom, this.minZoom, this.maxZoom);
    const p = this.clampPos(x, y, z);
    this.current = { x: p.x, y: p.y, zoom: z };
    this.target = { x: p.x, y: p.y, zoom: z };
    this.animating = false;
    this.apply();
  }

  panByScreen(dx: number, dy: number): void {
    if (this.rightEdgePin !== null) {
      // 钉定时仅允许纵向拖动
      const z = this.target.zoom;
      const ny = clamp(this.target.y - dy / z, this.minY, this.maxY);
      this.target.y = ny;
      this.current.y = this.target.y;
      this.animating = false;
      this.apply();
      return;
    }
    const z = this.target.zoom;
    const p = this.clampPos(this.target.x - dx / z, this.target.y - dy / z);
    this.target.x = p.x;
    this.target.y = p.y;
    this.current.x = this.target.x;
    this.current.y = this.target.y;
    this.animating = false;
    this.apply();
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const vp = this.getViewport();
    const z0 = this.target.zoom;
    const newZoom = clamp(z0 * factor, this.minZoom, this.maxZoom);

    if (this.rightEdgePin !== null) {
      // 钉定时：X 由 zoom 决定，Y 保持鼠标下方世界点
      const worldY = this.target.y + (screenY - vp.height / 2) / z0;
      const ny = worldY - (screenY - vp.height / 2) / newZoom;
      this.target.x = this.pinnedX(newZoom);
      this.target.y = clamp(ny, this.minY, this.maxY);
      this.target.zoom = newZoom;
      this.current.x = this.target.x;
      this.current.y = this.target.y;
      this.current.zoom = this.target.zoom;
      this.animating = false;
      this.apply();
      return;
    }

    const worldX = this.target.x + (screenX - vp.width / 2) / z0;
    const worldY = this.target.y + (screenY - vp.height / 2) / z0;
    let nx = worldX - (screenX - vp.width / 2) / newZoom;
    let ny = worldY - (screenY - vp.height / 2) / newZoom;
    const p = this.clampPos(nx, ny, newZoom);
    nx = p.x;
    ny = p.y;
    this.target.x = nx;
    this.target.y = ny;
    this.target.zoom = newZoom;
    this.current.x = this.target.x;
    this.current.y = this.target.y;
    this.current.zoom = this.target.zoom;
    this.animating = false;
    this.apply();
  }

  focusOn(worldX: number, worldY: number, targetZoom: number, duration = 1200): void {
    const z = clamp(targetZoom, this.minZoom, this.maxZoom);
    const p = this.clampPos(worldX, worldY, z);
    this.animFrom = { ...this.current };
    if (this.rightEdgePin !== null) {
      this.animFrom.x = this.pinnedX(this.animFrom.zoom);
    }
    this.animTo = { x: p.x, y: p.y, zoom: z };
    this.animStart = performance.now();
    this.animDuration = duration;
    this.animating = true;
    this.target = { ...this.animTo };
  }

  update(): void {
    if (this.animating && this.animFrom && this.animTo) {
      const t = clamp((performance.now() - this.animStart) / this.animDuration, 0, 1);
      const e = easeInOutCubic(t);
      this.current.x = this.animFrom.x + (this.animTo.x - this.animFrom.x) * e;
      this.current.y = this.animFrom.y + (this.animTo.y - this.animFrom.y) * e;
      this.current.zoom = this.animFrom.zoom + (this.animTo.zoom - this.animFrom.zoom) * e;
      if (t >= 1) this.animating = false;
    } else {
      this.current.x = this.target.x;
      this.current.y = this.target.y;
      this.current.zoom = this.target.zoom;
    }
    // 钉定右边缘：覆盖 X 为当前 zoom 对应的钉定值
    if (this.rightEdgePin !== null) {
      this.current.x = this.pinnedX(this.current.zoom);
      if (!this.animating) this.target.x = this.current.x;
    }
    this.apply();
  }

  private apply(): void {
    const vp = this.getViewport();
    const z = this.current.zoom;
    this.world.scale.set(z);
    this.world.position.set(
      vp.width / 2 - this.current.x * z,
      vp.height / 2 - this.current.y * z
    );
  }
}
