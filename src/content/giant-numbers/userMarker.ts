/**
 * User Marker — 用户锻造的数字标记
 *
 * 当用户在表达式锻造炉中创建一个数后，此模块在海岸线上
 * 生成一个琥珀色标记节点，结构与 SiteNode 类似但更精简。
 */
import * as PIXI from 'pixi.js';
import type { CoastlineModel } from '../../engine/coastline';
import type { CameraState } from '../../engine/Camera';
import { clamp } from '../../utils/scale';
import { scaleLevelToX } from '../../worldConfig';

const FONT = 'Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Inter, sans-serif';
const MONO = 'JetBrains Mono, Consolas, monospace';
const MARKER_COLOR = 0xfbbf24; // 琥珀色，区别于预定义站点的青蓝色

export interface UserMarkerData {
  id: string;
  expressionText: string;
  scaleLevel: number;
}

export interface UserMarkerNode {
  id: string;
  data: UserMarkerData;
  focusX: number;
  focusY: number;
  scaleLevel: number;
  container: PIXI.Container;
  /** 从 alpha=0 渐显（瀑布凝聚阶段调用） */
  fadeIn(): void;
  /** 触发着陆脉冲：缩放 + 扩张环（瀑布着陆阶段调用） */
  triggerLandingPulse(): void;
  /** 每帧更新：LOD 缩放、渐显、脉冲动画 */
  update(camera: CameraState, time: number): void;
}

export function createUserMarker(
  data: UserMarkerData,
  coast: CoastlineModel
): UserMarkerNode {
  const wx = scaleLevelToX(data.scaleLevel);
  const pos = coast.getPointAtX(wx);
  const offset = 130;
  const mx = pos.x - pos.normalX * offset;
  const my = pos.y - pos.normalY * offset;
  const color = MARKER_COLOR;

  const container = new PIXI.Container();
  container.position.set(mx, my);

  // 曲线到标记的连接线
  const link = new PIXI.Graphics();
  link
    .lineStyle(1.5, color, 0.4)
    .moveTo(pos.x - mx, pos.y - my)
    .lineTo(0, 0);

  // 光晕 + 核心
  const aura = new PIXI.Graphics();
  aura.beginFill(color, 0.1).drawCircle(0, 0, 42).endFill();
  aura.beginFill(color, 0.22).drawCircle(0, 0, 24).endFill();
  aura.beginFill(color, 0.95).drawCircle(0, 0, 8).endFill();

  // 脉动环
  const ring = new PIXI.Graphics();
  ring.lineStyle(2, color, 0.7).drawCircle(0, 0, 20);

  // 表达式文本标签
  const label = new PIXI.Text(
    data.expressionText,
    new PIXI.TextStyle({
      fontFamily: MONO,
      fontSize: 22,
      fill: 0xeaf6ff,
      stroke: 0x04101c,
      strokeThickness: 5,
      padding: 8,
    })
  );
  label.anchor.set(0.5);
  label.y = -55;

  // 着陆扩张环（默认不可见，triggerLandingPulse 时绘制）
  const pulseRing = new PIXI.Graphics();

  container.addChild(link, aura, ring, label, pulseRing);
  container.alpha = 0;

  let fadingIn = false;
  let fadeStart = 0;
  let pulseStart = -1;

  return {
    id: data.id,
    data,
    focusX: mx,
    focusY: my - 40,
    scaleLevel: data.scaleLevel,
    container,
    fadeIn() {
      container.alpha = 0;
      fadingIn = true;
      fadeStart = performance.now();
    },
    triggerLandingPulse() {
      pulseStart = performance.now();
    },
    update(camera, time) {
      const zoom = camera.zoom;
      const uiScale = clamp(1 / zoom, 0.1, 2.2);
      label.scale.set(uiScale);

      // 渐显动画（瀑布凝聚阶段）
      if (fadingIn) {
        const ft = clamp((time - fadeStart) / 500, 0, 1);
        container.alpha = ft * (zoom < 0.06 ? 0.4 : 1);
        if (ft >= 1) fadingIn = false;
      } else {
        container.alpha = zoom < 0.06 ? 0.4 : 1;
      }

      // 脉动 + 着陆脉冲
      const pulse = 1 + Math.sin(time * 0.003) * 0.07;
      if (pulseStart >= 0) {
        const pt = clamp((time - pulseStart) / 500, 0, 1);
        const pulseScale = pt < 0.4 ? 0.5 + pt * 1.75 : 1.2 - (pt - 0.4) * 0.333;
        aura.scale.set(pulseScale);
        ring.scale.set(pulseScale);
        pulseRing.clear();
        if (pt < 1) {
          const rr = pt * 90;
          const ra = (1 - pt) * 0.8;
          pulseRing.lineStyle(3, color, ra).drawCircle(0, 0, rr);
        }
        if (pt >= 1) {
          pulseStart = -1;
          aura.scale.set(1);
          ring.scale.set(pulse);
        }
      } else {
        aura.scale.set(1);
        ring.scale.set(pulse);
        pulseRing.clear();
      }
    },
  };
}
