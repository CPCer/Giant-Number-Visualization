import * as PIXI from 'pixi.js';
import type { CoastlineModel } from '../../engine/coastline';
import type { CameraState } from '../../engine/Camera';
import { clamp } from '../../utils/scale';
import { scaleLevelToX } from '../../worldConfig';

/**
 * 参照线：在海岸线上标注现实世界中的量级刻度，
 * 帮助用户理解各站点数的「大小」在现实中的位置。
 */

export interface ReferenceMarkerData {
  id: string;
  label: string;
  value: string;
  note: string;
  scaleLevel: number;
}

const FONT = 'Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Inter, sans-serif';
const MONO = 'JetBrains Mono, Consolas, monospace';
const MARKER_COLOR = 0xfbbf24; // 琥珀色，与站点青蓝色区分
const LINE_HEIGHT = 280; // 垂直虚线高度（世界单位）

/**
 * 四条参照线，按 scale_level 升序排列。
 * 每条都标注一个现实世界中可感知的量级，
 * 让用户在海岸线上直观看到「人类的数走到了哪里」。
 */
export const REFERENCE_MARKERS: ReferenceMarkerData[] = [
  {
    id: 'universe-particles',
    label: '宇宙基本粒子总数',
    value: '≈ 10⁸⁰',
    note: '古戈尔（10¹⁰⁰）已超越',
    scaleLevel: 1.8,
  },
  {
    id: 'universe-volume',
    label: '可观测宇宙体积',
    value: '≈ 8.4×10¹⁸⁴ 普朗克体积',
    note: '超越古戈尔，远不及古戈尔普勒克斯',
    scaleLevel: 2.1,
  },
  {
    id: 'windows-calc',
    label: 'Windows 计算器上限',
    value: '10¹⁰⁰⁰⁰ − 1',
    note: '超越古戈尔',
    scaleLevel: 2.25,
  },
  {
    id: 'mersenne-prime',
    label: '最大已知梅森素数',
    value: '2¹³⁶²⁷⁹⁸⁴¹ − 1',
    note: '约 4100 万位数字',
    scaleLevel: 2.4,
  },
];

interface MarkerNode {
  data: ReferenceMarkerData;
  root: PIXI.Container;
  update(camera: CameraState, time: number, maxVisibleScale: number): void;
}

function createMarker(data: ReferenceMarkerData, coast: CoastlineModel): MarkerNode {
  const wx = scaleLevelToX(data.scaleLevel);
  const pos = coast.getPointAtX(wx);

  const root = new PIXI.Container();
  root.position.set(pos.x, pos.y);

  // 旋转使虚线垂直于海岸线（沿法线方向，朝陆地侧）
  // 法线 (normalX, normalY) 指向水面，-法线 指向陆地
  const rootRotation = Math.atan2(-pos.normalY, -pos.normalX) + Math.PI / 2;
  root.rotation = rootRotation;

  // 海岸线交叉点标记（菱形 + 光晕）
  const dot = new PIXI.Graphics();
  dot.beginFill(MARKER_COLOR, 0.12).drawCircle(0, 0, 18).endFill();
  dot.beginFill(MARKER_COLOR, 0.25).drawCircle(0, 0, 10).endFill();
  dot.beginFill(MARKER_COLOR, 0.9);
  dot.moveTo(0, -7).lineTo(7, 0).lineTo(0, 7).lineTo(-7, 0).closePath();
  dot.endFill();

  // 垂直于海岸线的虚线（在旋转后的局部坐标系中沿 -y 方向绘制）
  const line = new PIXI.Graphics();
  line.lineStyle(3, MARKER_COLOR, 0.55);
  const dashLen = 18;
  const gapLen = 10;
  for (let y = 0; y < LINE_HEIGHT; y += dashLen + gapLen) {
    const segEnd = Math.min(y + dashLen, LINE_HEIGHT);
    line.moveTo(0, -y);
    line.lineTo(0, -segEnd);
  }

  // 标签（counter-rotate 保持水平可读）
  const label = new PIXI.Text(
    data.label,
    new PIXI.TextStyle({
      fontFamily: FONT,
      fontSize: 14,
      fill: MARKER_COLOR,
      fontWeight: 'bold',
      padding: 4,
      stroke: 0x04101c,
      strokeThickness: 3,
    })
  );
  label.anchor.set(0.5, 1);
  label.position.set(0, -LINE_HEIGHT - 6);
  label.rotation = -rootRotation;

  // 数值（等宽，中间）
  const value = new PIXI.Text(
    data.value,
    new PIXI.TextStyle({
      fontFamily: MONO,
      fontSize: 12,
      fill: 0xfde68a,
      padding: 4,
      stroke: 0x04101c,
      strokeThickness: 3,
    })
  );
  value.anchor.set(0.5, 1);
  value.position.set(0, -LINE_HEIGHT - 24);
  value.rotation = -rootRotation;

  // 注释（最小，最远）
  const note = new PIXI.Text(
    data.note,
    new PIXI.TextStyle({
      fontFamily: FONT,
      fontSize: 11,
      fill: 0x9ca3af,
      padding: 4,
      stroke: 0x04101c,
      strokeThickness: 2,
    })
  );
  note.anchor.set(0.5, 1);
  note.position.set(0, -LINE_HEIGHT - 40);
  note.rotation = -rootRotation;

  root.addChild(line, dot, note, value, label);

  return {
    data,
    root,
    update(camera, time, maxVisibleScale) {
      // 认知可见性：超出当前认知阈值的参照线隐藏
      if (data.scaleLevel > maxVisibleScale + 0.01) {
        root.visible = false;
        return;
      }
      root.visible = true;

      const zoom = camera.zoom;

      // LOD：始终可见，聚焦时略微降低不透明度
      let alpha: number;
      if (zoom < 0.15) {
        alpha = 0.9;
      } else if (zoom < 0.50) {
        alpha = 0.9 - 0.3 * (zoom - 0.15) / 0.35;
      } else {
        alpha = 0.6;
      }
      root.alpha = alpha;

      // 文字与线条均随缩放调整，保证各层级可见
      const uiScale = clamp(1 / zoom, 0.1, 2.2);
      label.scale.set(uiScale);
      value.scale.set(uiScale);
      note.scale.set(uiScale);
      line.scale.set(uiScale);
      dot.scale.set(uiScale);

      // 虚线微脉动
      const pulse = 1 + Math.sin(time * 0.002 + data.scaleLevel * 10) * 0.08;
      line.alpha = alpha * 0.8 * pulse;
      dot.alpha = alpha;
    },
  };
}

export function createReferenceMarkers(coast: CoastlineModel): {
  container: PIXI.Container;
  update(camera: CameraState, time: number, maxVisibleScale: number): void;
  destroy(): void;
} {
  const container = new PIXI.Container();
  const markers = REFERENCE_MARKERS.map((data) => {
    const m = createMarker(data, coast);
    container.addChild(m.root);
    return m;
  });

  return {
    container,
    update(camera, time, maxVisibleScale) {
      markers.forEach((m) => m.update(camera, time, maxVisibleScale));
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
