import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Camera } from './engine/Camera';
import type { PanBounds } from './engine/Camera';
import { generateCoastline } from './engine/coastline';
import { createNumberScene, type SiteNode } from './content/giant-numbers/numberScene';
import data from './content/giant-numbers/data.json';
import { Timeline } from './ui/Timeline';
import type { GiantNumber } from './types';
import {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  INFINITY_X,
  DATA_START_X,
  CAM_MIN_X,
  CAM_MAX_X,
  CAM_MIN_Y,
  CAM_MAX_Y,
  DEFAULT_MIN_ZOOM,
  FOCUS_ZOOM,
  scaleLevelToX,
} from './worldConfig';

const ITEMS = data as unknown as GiantNumber[];
const SORTED = [...ITEMS].sort((a, b) => a.scale_level - b.scale_level);

interface DragState {
  down: boolean;
  moved: boolean;
  lastX: number;
  lastY: number;
}

const DEFAULT_BOUNDS: PanBounds = {
  minX: CAM_MIN_X,
  maxX: CAM_MAX_X,
  minY: CAM_MIN_Y,
  maxY: CAM_MAX_Y,
};

export default function App() {
  const pixiRoot = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showInfinityHint, setShowInfinityHint] = useState(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const worldRef = useRef<{
    camera?: Camera;
    nodes?: SiteNode[];
    app?: PIXI.Application;
    infinityWrap?: PIXI.Container;
    drag: DragState;
  }>({ drag: { down: false, moved: false, lastX: 0, lastY: 0 } });

  // 初始化 PixiJS 世界
  useEffect(() => {
    const rootEl = pixiRoot.current;
    if (!rootEl) return;

    const app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    rootEl.appendChild(app.view as HTMLCanvasElement);

    const world = new PIXI.Container();
    app.stage.addChild(world);

    // 生成攀升曲线
    const coast = generateCoastline({
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      seed: 20260805,
      iterations: 10,
      amplitude: WORLD_HEIGHT * 0.12,
      roughness: 0.52,
    });
    const infWrap = coast.draw(world, () => {
      setShowInfinityHint(true);
      window.setTimeout(() => setShowInfinityHint(false), 4000);
    });

    // 大数站点
    const { container: sites, nodes } = createNumberScene(ITEMS, coast, (id) => {
      if (!worldRef.current.drag.moved) setSelectedId((prev) => (prev === id ? null : id));
    });
    world.addChild(sites);

    // 相机：初始俯瞰（从站点区到 ∞）
    const camera = new Camera(
      world,
      () => ({ width: app.screen.width, height: app.screen.height }),
      { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT * 0.5, zoom: 0.05 },
      DEFAULT_MIN_ZOOM,
      8,
      DEFAULT_BOUNDS
    );
    const viewW = INFINITY_X - DATA_START_X;
    const viewH = WORLD_HEIGHT * 0.92;
    const fitZoom = Math.min(app.screen.width / viewW, app.screen.height / viewH) * 0.92;
    const centerX = (DATA_START_X + INFINITY_X) / 2;
    camera.setView(centerX, WORLD_HEIGHT * 0.52, fitZoom);

    worldRef.current.camera = camera;
    worldRef.current.nodes = nodes;
    worldRef.current.app = app;
    worldRef.current.infinityWrap = infWrap;

    const drag = worldRef.current.drag;
    const canvas = app.view as HTMLCanvasElement;

    const onPointerDown = (e: PointerEvent) => {
      drag.down = true;
      drag.moved = false;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag.down) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      camera.panByScreen(dx, dy);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    };
    const onPointerUp = () => {
      drag.down = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0014);
      const rect = canvas.getBoundingClientRect();
      camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    app.ticker.add(() => {
      camera.update();
      const time = performance.now();
      nodes.forEach((n) => n.update(camera.state, time, selectedRef.current));
    });

    const onResize = () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, []);

  // 选中/取消选中时的认知层级与相机控制
  useEffect(() => {
    const camera = worldRef.current.camera;
    const nodes = worldRef.current.nodes;
    const infWrap = worldRef.current.infinityWrap;
    const app = worldRef.current.app;
    if (!camera || !nodes || !app) return;

    if (!selectedId) {
      // 恢复默认：所有站点可见，默认边界，清除钉定
      nodes.forEach((n) => n.setCognitiveVisible(true));
      if (infWrap) infWrap.visible = true;
      camera.setRightEdgePin(null);
      camera.setBounds(DEFAULT_BOUNDS, DEFAULT_MIN_ZOOM);
      const viewW = INFINITY_X - DATA_START_X;
      const viewH = WORLD_HEIGHT * 0.92;
      const fitZoom = Math.min(app.screen.width / viewW, app.screen.height / viewH) * 0.92;
      camera.focusOn((DATA_START_X + INFINITY_X) / 2, WORLD_HEIGHT * 0.52, fitZoom, 1200);
      return;
    }

    // 选中某站点：设置认知层级
    const idx = SORTED.findIndex((d) => d.id === selectedId);
    if (idx < 0) return;
    const clicked = SORTED[idx];
    const nextLarger = idx < SORTED.length - 1 ? SORTED[idx + 1] : null;
    const isLargest = idx === SORTED.length - 1;

    // 隐藏 scale_level 更大的站点
    nodes.forEach((n) => {
      n.setCognitiveVisible(n.data.scale_level <= clicked.scale_level);
    });

    const clickedX = scaleLevelToX(clicked.scale_level);

    if (isLargest) {
      // 拉约数：∞ 可见且钉定在视口右边缘
      if (infWrap) infWrap.visible = true;
      // 钉定位置略超 ∞ 中心，使完整 ∞ 符号可见而非半截
      const pinX = INFINITY_X + 140;
      camera.setRightEdgePin(pinX);
      camera.setBounds(
        { minX: CAM_MIN_X, maxX: INFINITY_X, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
        0.035
      );
      // 确保拉约数和 ∞ 同框：gap 缩小后，常规屏幕下 zoom 统一为 0.40
      const rayoGap = pinX - clickedX;
      const rayoZoom = Math.min(FOCUS_ZOOM, app.screen.width / (rayoGap + 600));
      const node = nodes.find((n) => n.id === selectedId);
      if (node) camera.focusOn(node.focusX, node.focusY, rayoZoom, 1200);
    } else {
      // 非最大站点：∞ 不可见，无钉定
      if (infWrap) infWrap.visible = false;
      camera.setRightEdgePin(null);
      const maxX = nextLarger
        ? (clickedX + scaleLevelToX(nextLarger.scale_level)) / 2
        : INFINITY_X;
      camera.setBounds(
        { minX: CAM_MIN_X, maxX, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
        0.035
      );
      const node = nodes.find((n) => n.id === selectedId);
      if (node) camera.focusOn(node.focusX, node.focusY, FOCUS_ZOOM, 1200);
    }
  }, [selectedId]);

  const handleReset = () => setSelectedId(null);

  return (
    <div className="app">
      <div id="pixi-root" ref={pixiRoot} />
      <header className="topbar">
        <div className="brand">攀升之路</div>
        <div className="subtitle">Ascent to Infinity · 大数认知之旅</div>
        <button className="reset-btn" onClick={handleReset}>
          俯瞰全局
        </button>
      </header>
      <Timeline
        items={ITEMS}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
      />
      {showInfinityHint && (
        <div className="infinity-hint">
          <div className="infinity-hint-title">∞ 无限</div>
          <div className="infinity-hint-body">
            这里是人类认知的尽头。也许有一天，点击此处将带你进入「无限的世界」——
            那里有不同大小的无限，也有无穷小。敬请期待。
          </div>
        </div>
      )}
      <footer className="hint">滚轮缩放 · 拖拽平移 · 点击站点探索 · 点击 ∞ 预览彩蛋</footer>
    </div>
  );
}
