import * as PIXI from 'pixi.js';
import type { CoastlineModel } from '../../engine/coastline';
import type { CameraState } from '../../engine/Camera';
import { clamp } from '../../utils/scale';
import { scaleLevelToX } from '../../worldConfig';
import type { GiantNumber } from '../../types';

export interface SiteNode {
  id: string;
  data: GiantNumber;
  focusX: number;
  focusY: number;
  scaleLevel: number;
  /** 认知可见性：false 时整个站点不可见（被更大数的认知边界遮挡） */
  cognitiveVisible: boolean;
  setCognitiveVisible(visible: boolean): void;
  /** 从 alpha=0 渐显（瀑布凝聚阶段调用） */
  fadeIn(): void;
  /** 触发着陸脈衝：縮放 + 擴張環（瀑布著陸階段調用） */
  triggerLandingPulse(): void;
  update(camera: CameraState, time: number, selectedId: string | null): void;
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

const FONT = 'Noto Sans CJK SC, Microsoft YaHei, PingFang SC, Inter, sans-serif';
const MONO = 'JetBrains Mono, Consolas, monospace';

/**
 * 把 data.json 中的大数转成攀升之路上的站点节点：
 * 按 scale_level 计算 x（对数尺度，体现大小关系），
 * 在曲线法线方向（陆地侧）放置标记，并做三级 LOD。
 */
export function createNumberScene(
  items: GiantNumber[],
  coast: CoastlineModel,
  onSelect: (id: string) => void
): { container: PIXI.Container; nodes: SiteNode[] } {
  const container = new PIXI.Container();
  const nodes: SiteNode[] = [];

  items.forEach((item, index) => {
    const wx = scaleLevelToX(item.scale_level);
    const pos = coast.getPointAtX(wx);
    const color = hexToNumber(item.color);
    const offset = 130;
    const mx = pos.x - pos.normalX * offset;
    const my = pos.y - pos.normalY * offset;

    const root = new PIXI.Container();
    root.position.set(mx, my);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new PIXI.Rectangle(-230, -420, 460, 500);

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

    // 名称
    const label = new PIXI.Text(
      item.name,
      new PIXI.TextStyle({
        fontFamily: FONT,
        fontSize: 30,
        fill: 0xeaf6ff,
        stroke: 0x04101c,
        strokeThickness: 5,
        padding: 8,
      })
    );
    label.anchor.set(0.5);
    label.y = -60;

    const card = createCard(item, color);
    card.y = -480;

    root.on('pointertap', () => onSelect(item.id));
    root.addChild(link, aura, ring, label, card);
    container.addChild(root);

    let cognitiveVisible = true;
    let fadingIn = false;
    let fadeStart = 0;
    let pulseStart = -1;

    // 着陸擴張環（默認不可見，triggerLandingPulse 時繪製）
    const pulseRing = new PIXI.Graphics();
    root.addChild(pulseRing);

    nodes.push({
      id: item.id,
      data: item,
      focusX: mx,
      focusY: my - 40,
      scaleLevel: item.scale_level,
      get cognitiveVisible() { return cognitiveVisible; },
      setCognitiveVisible(visible: boolean) {
        cognitiveVisible = visible;
        root.visible = visible;
      },
      fadeIn() {
        cognitiveVisible = true;
        root.visible = true;
        root.alpha = 0;
        fadingIn = true;
        fadeStart = performance.now();
      },
      triggerLandingPulse() {
        pulseStart = performance.now();
      },
      update(camera, time, selectedId) {
        if (!cognitiveVisible) return;
        const zoom = camera.zoom;
        const dx = root.position.x - camera.x;
        const dy = root.position.y - camera.y;
        const screenDist = Math.hypot(dx, dy) * zoom;
        const isSelected = selectedId === item.id;
        const near = (zoom > 0.45 && screenDist < 900) || (isSelected && zoom > 0.25);
        const mid = zoom > 0.12 && screenDist < 2400;
        card.visible = near || isSelected;
        label.visible = mid && !card.visible;
        const uiScale = clamp(1 / zoom, 0.1, 2.2);
        label.scale.set(uiScale);
        card.scale.set(uiScale);
        const pulse = 1 + Math.sin(time * 0.003 + index) * 0.07;
        aura.alpha = isSelected ? 0.95 : 0.6;

        // 漸顯動畫（瀑布凝聚階段）
        if (fadingIn) {
          const ft = clamp((time - fadeStart) / 500, 0, 1);
          root.alpha = ft * (zoom < 0.06 ? 0.4 : 1);
          if (ft >= 1) fadingIn = false;
        } else {
          root.alpha = zoom < 0.06 ? 0.4 : 1;
        }

        // 著陸脈衝（瀑布著陸階段）
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
    });
  });

  return { container, nodes };
}

/**
 * 站点卡片：名称、数值、描述、年份·发明者、故事（放大后可阅读）
 */
function createCard(item: GiantNumber, color: number): PIXI.Container {
  const card = new PIXI.Container();
  const bg = new PIXI.Graphics();
  bg.beginFill(0x08131f, 0.94);
  bg.lineStyle(1.5, color, 0.45);
  bg.drawRoundedRect(-210, -170, 420, 350, 18);
  bg.endFill();

  const title = new PIXI.Text(
    item.name,
    new PIXI.TextStyle({ fontFamily: FONT, fontSize: 30, fill: 0xeaf6ff, fontWeight: 'bold', padding: 6 })
  );
  title.anchor.set(0.5, 0);
  title.position.set(0, -150);

  const value = new PIXI.Text(
    item.value,
    new PIXI.TextStyle({ fontFamily: MONO, fontSize: 24, fill: color, padding: 6 })
  );
  value.anchor.set(0.5, 0);
  value.position.set(0, -108);

  const desc = new PIXI.Text(
    item.value_description,
    new PIXI.TextStyle({ fontFamily: FONT, fontSize: 15, fill: 0x6b8aa3, padding: 6 })
  );
  desc.anchor.set(0.5, 0);
  desc.position.set(0, -72);

  const meta = new PIXI.Text(
    `${item.year_text} · ${item.inventor}`,
    new PIXI.TextStyle({ fontFamily: FONT, fontSize: 17, fill: 0x9fd8ff, padding: 6 })
  );
  meta.anchor.set(0.5, 0);
  meta.position.set(0, -34);

  const story = new PIXI.Text(
    item.story,
    new PIXI.TextStyle({
      fontFamily: FONT,
      fontSize: 14,
      fill: 0xc0d8e8,
      wordWrap: true,
      wordWrapWidth: 360,
      breakWords: true,
      padding: 6,
      lineHeight: 20,
    })
  );
  story.anchor.set(0.5, 0);
  story.position.set(0, 0);

  card.addChild(bg, title, value, desc, meta, story);
  card.visible = false;
  card.eventMode = 'none';
  return card;
}
