import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Camera } from './engine/Camera';
import type { PanBounds } from './engine/Camera';
import { generateCoastline } from './engine/coastline';
import type { CoastlineModel } from './engine/coastline';
import { ScaleWaterfall } from './engine/ScaleWaterfall';
import { createNumberScene, type SiteNode } from './content/giant-numbers/numberScene';
import { createReferenceMarkers } from './content/giant-numbers/referenceMarkers';
import { glyphLabel } from './content/giant-numbers/glyphLabel';
import data from './content/giant-numbers/data.json';
import { Timeline } from './ui/Timeline';
import { ExpressionForge } from './ui/ExpressionForge';
import { IntroOverlay } from './ui/IntroOverlay';
import { buildStationRefs } from './content/giant-numbers/stationMagnitudes';
import { createUserMarker, type UserMarkerNode } from './content/giant-numbers/userMarker';
import { NeighborIndicator } from './engine/neighborIndicator';
import type { IndicatorTarget } from './engine/neighborIndicator';
import type { Magnitude } from './engine/magnitude';
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
  SCALE_MAX,
  scaleLevelToX,
} from './worldConfig';

const ITEMS = data as unknown as GiantNumber[];
const SORTED = [...ITEMS].sort((a, b) => a.scale_level - b.scale_level);
const STATION_REFS = buildStationRefs(ITEMS);

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * 为指示器设置相邻站点目标。
 * 在 FOCUS_ZOOM 下，相邻站点通常在视口外，指示线让用户感知相对位置。
 */
function setupNeighborIndicators(
  indicator: NeighborIndicator,
  nodes: SiteNode[],
  originX: number,
  originY: number,
  scaleLevel: number,
  isNearInfinity: boolean
): void {
  indicator.setOrigin(originX, originY);
  const targets: IndicatorTarget[] = [];

  // 下方相邻站点（scale_level 最近的较小站点）
  let below: SiteNode | null = null;
  for (const n of nodes) {
    if (n.data.scale_level < scaleLevel - 0.01) below = n;
  }
  if (below) {
    targets.push({
      id: below.id,
      name: below.data.name,
      worldX: below.focusX,
      worldY: below.focusY,
      color: hexToNumber(below.data.color),
    });
  }

  // 上方相邻站点（近 ∞ 时跳过——∞ 已通过 rightEdgePin 可见）
  if (!isNearInfinity) {
    let above: SiteNode | null = null;
    for (const n of nodes) {
      if (n.data.scale_level > scaleLevel + 0.01 && !above) {
        above = n;
        break;
      }
    }
    if (above) {
      targets.push({
        id: above.id,
        name: above.data.name,
        worldX: above.focusX,
        worldY: above.focusY,
        color: hexToNumber(above.data.color),
      });
    }
  }

  indicator.setTargets(targets);
}

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
  const [forgeOpen, setForgeOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;
  const prevSelectedRef = useRef<string | null>(null);
  const waterfallRef = useRef<ScaleWaterfall | null>(null);
  const userMarkerNodesRef = useRef<UserMarkerNode[]>([]);
  const maxVisibleScaleRef = useRef(SCALE_MAX);

  const worldRef = useRef<{
    camera?: Camera;
    nodes?: SiteNode[];
    app?: PIXI.Application;
    infinityWrap?: PIXI.Container;
    world?: PIXI.Container;
    coast?: CoastlineModel;
    neighborIndicator?: NeighborIndicator;
    referenceMarkers?: ReturnType<typeof createReferenceMarkers>;
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

    // 量级参照线（在站点之前添加，使站点渲染在上层）
    const refMarkers = createReferenceMarkers(coast);
    world.addChild(refMarkers.container);

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
    worldRef.current.world = world;
    worldRef.current.coast = coast;
    worldRef.current.referenceMarkers = refMarkers;

    // 邻站指示器（屏幕空间，添加到 stage 而非 world）
    const neighborIndicator = new NeighborIndicator();
    neighborIndicator.setViewport(app.screen.width, app.screen.height);
    app.stage.addChild(neighborIndicator.container);
    worldRef.current.neighborIndicator = neighborIndicator;

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
      userMarkerNodesRef.current.forEach((m) => m.update(camera.state, time));
      neighborIndicator.update(camera.state);
      refMarkers.update(camera.state, time, maxVisibleScaleRef.current);
      const wf = waterfallRef.current;
      if (wf?.active) {
        const done = wf.update(time);
        if (done) {
          wf.destroy();
          waterfallRef.current = null;
        }
      }
    });

    const onResize = () => {
      app.renderer.resize(window.innerWidth, window.innerHeight);
      neighborIndicator.setViewport(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      neighborIndicator.destroy();
      refMarkers.destroy();
      app.destroy(true, { children: true, texture: true, baseTexture: true });
    };
  }, []);

  // 选中/取消选中时的认知层级与相机控制
  useEffect(() => {
    const camera = worldRef.current.camera;
    const nodes = worldRef.current.nodes;
    const infWrap = worldRef.current.infinityWrap;
    const app = worldRef.current.app;
    const world = worldRef.current.world;
    const coast = worldRef.current.coast;
    const neighborIndicator = worldRef.current.neighborIndicator;
    if (!camera || !nodes || !app) return;

    // 取消正在進行的瀑布動畫
    if (waterfallRef.current) {
      waterfallRef.current.destroy();
      waterfallRef.current = null;
    }

    if (!selectedId) {
      // 恢复默认：所有站点可见，默认边界，清除钉定
      nodes.forEach((n) => n.setCognitiveVisible(true));
      maxVisibleScaleRef.current = SCALE_MAX;
      if (infWrap) infWrap.visible = true;
      camera.setRightEdgePin(null);
      camera.setBounds(DEFAULT_BOUNDS, DEFAULT_MIN_ZOOM);
      neighborIndicator?.clear();
      const viewW = INFINITY_X - DATA_START_X;
      const viewH = WORLD_HEIGHT * 0.92;
      const fitZoom = Math.min(app.screen.width / viewW, app.screen.height / viewH) * 0.92;
      camera.focusOn((DATA_START_X + INFINITY_X) / 2, WORLD_HEIGHT * 0.52, fitZoom, 1200);
      prevSelectedRef.current = null;
      return;
    }

    // 选中某站点
    const idx = SORTED.findIndex((d) => d.id === selectedId);
    if (idx < 0) return;
    const clicked = SORTED[idx];
    const nextLarger = idx < SORTED.length - 1 ? SORTED[idx + 1] : null;
    const isLargest = idx === SORTED.length - 1;
    const clickedX = scaleLevelToX(clicked.scale_level);
    maxVisibleScaleRef.current = clicked.scale_level;

    // 檢測是否為 scale_level 上升轉場
    const prevId = prevSelectedRef.current;
    const prevIdx = prevId ? SORTED.findIndex((d) => d.id === prevId) : -1;
    const prevData = prevIdx >= 0 ? SORTED[prevIdx] : null;
    const isScaleUp = !!(prevData && clicked.scale_level > prevData.scale_level);

    if (isScaleUp && world && coast) {
      // ── 數階瀑布動畫 ──
      const sourceNode = nodes.find((n) => n.id === prevId);
      const targetNode = nodes.find((n) => n.id === selectedId);
      if (sourceNode && targetNode) {
        // 認知可見性：隱藏 > clicked，暫時隱藏 target（凝聚時顯現）
        nodes.forEach((n) => {
          if (n.id === selectedId) {
            n.setCognitiveVisible(false);
          } else {
            n.setCognitiveVisible(n.data.scale_level <= clicked.scale_level);
          }
        });

        const scaleJump = clicked.scale_level - prevData!.scale_level;
        const duration = 3500 + Math.min(Math.floor(scaleJump * 500), 2000);
        const fromX = scaleLevelToX(prevData!.scale_level);
        const fromSample = coast.getPointAtX(fromX);
        const toSample = coast.getPointAtX(clickedX);

        // 噴發即刻推動相機 — camera glides to target alongside the particle stream
        const camDuration = Math.floor(duration * 0.6);
        if (isLargest) {
          if (infWrap) infWrap.visible = true;
          const pinX = INFINITY_X + 140;
          camera.setRightEdgePin(pinX);
          camera.setBounds(
            { minX: CAM_MIN_X, maxX: INFINITY_X, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
            0.035
          );
          const rayoGap = pinX - clickedX;
          const rayoZoom = Math.min(FOCUS_ZOOM, app.screen.width / (rayoGap + 600));
          camera.focusOn(targetNode.focusX, targetNode.focusY, rayoZoom, camDuration);
        } else {
          if (infWrap) infWrap.visible = false;
          camera.setRightEdgePin(null);
          const maxX = nextLarger
            ? (clickedX + scaleLevelToX(nextLarger.scale_level)) / 2
            : INFINITY_X;
          camera.setBounds(
            { minX: CAM_MIN_X, maxX, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
            0.035
          );
          camera.focusOn(targetNode.focusX, targetNode.focusY, FOCUS_ZOOM, camDuration);
        }

        // 邻站指示器：FOCUS_ZOOM 下相邻站点在视口外，用指示线标注方向
        if (neighborIndicator) {
          setupNeighborIndicators(
            neighborIndicator, nodes,
            targetNode.focusX, targetNode.focusY,
            clicked.scale_level, isLargest
          );
        }

        const wf = new ScaleWaterfall(app);
        world.addChild(wf.container);
        wf.start({
          fromPos: { x: fromSample.x, y: fromSample.y },
          toPos: { x: toSample.x, y: toSample.y },
          coast,
          scaleJump,
          sourceGlyph: glyphLabel(prevData!),
          sourceColor: hexToNumber(prevData!.color),
          targetColor: hexToNumber(clicked.color),
          duration,
        });

        // 65% — 目標站點漸顯
        wf.onCondense = () => {
          targetNode.fadeIn();
        };

        // 85% — 著陸脈衝
        wf.onLanding = () => {
          targetNode.triggerLandingPulse();
        };

        waterfallRef.current = wf;
      }
    } else {
      // ── 即時切換（非升級或首次點擊）──
      nodes.forEach((n) => {
        n.setCognitiveVisible(n.data.scale_level <= clicked.scale_level);
      });

      if (isLargest) {
        if (infWrap) infWrap.visible = true;
        const pinX = INFINITY_X + 140;
        camera.setRightEdgePin(pinX);
        camera.setBounds(
          { minX: CAM_MIN_X, maxX: INFINITY_X, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
          0.035
        );
        const rayoGap = pinX - clickedX;
        const rayoZoom = Math.min(FOCUS_ZOOM, app.screen.width / (rayoGap + 600));
        const node = nodes.find((n) => n.id === selectedId);
        if (node) camera.focusOn(node.focusX, node.focusY, rayoZoom, 1200);
      } else {
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

      // 邻站指示器
      if (neighborIndicator) {
        const clickedNode = nodes.find((n) => n.id === selectedId);
        if (clickedNode) {
          setupNeighborIndicators(
            neighborIndicator, nodes,
            clickedNode.focusX, clickedNode.focusY,
            clicked.scale_level, isLargest
          );
        }
      }
    }

    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  const handleReset = () => setSelectedId(null);

  const handleForge = (
    _magnitude: Magnitude,
    scaleLevel: number,
    expressionText: string
  ) => {
    const { camera, coast, world, app, nodes, infinityWrap, neighborIndicator } = worldRef.current;
    if (!camera || !coast || !world || !app || !nodes) return;

    // 取消正在進行的瀑布動畫
    if (waterfallRef.current) {
      waterfallRef.current.destroy();
      waterfallRef.current = null;
    }

    // 创建用户标记
    const marker = createUserMarker(
      { id: `user-${Date.now()}`, expressionText, scaleLevel },
      coast
    );
    world.addChild(marker.container);
    userMarkerNodesRef.current.push(marker);

    // 确定瀑布源：当前选中的站点，或默认"一"
    const sourceId = selectedRef.current ?? 'one';
    const sourceData = SORTED.find((d) => d.id === sourceId) ?? SORTED[0];
    const sourceX = scaleLevelToX(sourceData.scale_level);
    const sourcePos = coast.getPointAtX(sourceX);
    const targetPos = coast.getPointAtX(scaleLevelToX(scaleLevel));

    const scaleJump = Math.max(0.5, scaleLevel - sourceData.scale_level);
    const duration = 3500 + Math.min(Math.floor(scaleJump * 500), 2000);
    const camDuration = Math.floor(duration * 0.6);

    // 查找相邻站点（用于邻站指示器和可见性）
    let belowData = SORTED[0];
    let aboveData: GiantNumber | null = null;
    for (const s of SORTED) {
      if (s.scale_level <= scaleLevel) belowData = s;
      if (s.scale_level > scaleLevel && !aboveData) {
        aboveData = s;
        break;
      }
    }

    // 认知可见性：显示到下一个更大站点（让用户看到相对位置）
    const visibleThreshold = aboveData ? aboveData.scale_level + 0.1 : scaleLevel;
    nodes.forEach((n) => {
      n.setCognitiveVisible(n.data.scale_level <= visibleThreshold);
    });
    maxVisibleScaleRef.current = visibleThreshold;

    // 相机控制（大数近 ∞ 时用右端钉定）
    if (scaleLevel >= 6.0) {
      if (infinityWrap) infinityWrap.visible = true;
      const pinX = INFINITY_X + 140;
      camera.setRightEdgePin(pinX);
      camera.setBounds(
        { minX: CAM_MIN_X, maxX: INFINITY_X, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
        0.035
      );
      const gap = pinX - scaleLevelToX(scaleLevel);
      const zoom = Math.min(FOCUS_ZOOM, app.screen.width / (gap + 600));
      camera.focusOn(marker.focusX, marker.focusY, zoom, camDuration);
    } else {
      if (infinityWrap) infinityWrap.visible = false;
      camera.setRightEdgePin(null);

      const maxX = aboveData
        ? Math.min(scaleLevelToX(aboveData.scale_level + 0.5), INFINITY_X)
        : Math.min(scaleLevelToX(scaleLevel + 1.5), INFINITY_X);
      camera.setBounds(
        { minX: CAM_MIN_X, maxX, minY: CAM_MIN_Y, maxY: CAM_MAX_Y },
        0.035
      );
      // 保持 FOCUS_ZOOM — 相邻站点通过指示线标注
      camera.focusOn(marker.focusX, marker.focusY, FOCUS_ZOOM, camDuration);
    }

    // 邻站指示器：在 FOCUS_ZOOM 下用指示线标注离屏相邻站点
    if (neighborIndicator) {
      setupNeighborIndicators(
        neighborIndicator, nodes,
        marker.focusX, marker.focusY,
        scaleLevel, scaleLevel >= 6.0
      );
    }

    // 瀑布动画
    const wf = new ScaleWaterfall(app);
    world.addChild(wf.container);
    wf.start({
      fromPos: { x: sourcePos.x, y: sourcePos.y },
      toPos: { x: targetPos.x, y: targetPos.y },
      coast,
      scaleJump,
      sourceGlyph: glyphLabel(sourceData),
      sourceColor: hexToNumber(sourceData.color),
      targetColor: 0xfbbf24,
      duration,
    });

    wf.onCondense = () => {
      marker.fadeIn();
    };
    wf.onLanding = () => {
      marker.triggerLandingPulse();
    };

    waterfallRef.current = wf;
    setForgeOpen(false);
  };

  return (
    <div className="app">
      <div id="pixi-root" ref={pixiRoot} />
      {showIntro && <IntroOverlay onStart={() => setShowIntro(false)} />}
      <header className="topbar">
        <div className="brand">攀升之路</div>
        <div className="subtitle">Ascent to Infinity · 大数认知之旅</div>
        <button
          className={`forge-toggle ${forgeOpen ? 'active' : ''}`}
          onClick={() => setForgeOpen((v) => !v)}
        >
          锻造炉
        </button>
        <button className="reset-btn" onClick={handleReset}>
          俯瞰全局
        </button>
      </header>
      <Timeline
        items={ITEMS}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))}
      />
      {forgeOpen && (
        <ExpressionForge
          stationRefs={STATION_REFS}
          onForge={handleForge}
          onClose={() => setForgeOpen(false)}
        />
      )}
      {showInfinityHint && (
        <div className="infinity-hint">
          <div className="infinity-hint-title">∞ 无限</div>
          <div className="infinity-hint-body">
            这里是人类认知的尽头。也许有一天，点击此处将带你进入「无限的世界」——
            那里有不同大小的无限，也有无穷小。敬请期待。
          </div>
        </div>
      )}
      <footer className="hint">滚轮缩放 · 拖拽平移 · 点击站点探索 · 锻造炉构建你的大数</footer>
    </div>
  );
}
