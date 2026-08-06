# 數階瀑布 (Scale Waterfall) — Implementation Plan

## Concept

When the user clicks a number with a higher `scale_level` than the currently
selected one, a "Scale Waterfall" animation plays instead of an instant cut:

1. Particles erupt upward from the current station.
2. They form a glowing waterfall stream rising along the coastline curve.
3. At the top they condense into the new station with a scale pulse + ring.

The bigger the `scale_level` jump, the taller and more intense the waterfall.

---

## Trigger Logic

| Situation | Behavior |
|---|---|
| `scale_level` increases (bigger number clicked) | **Full waterfall animation** |
| First click from overview (no previous selection) | Milder version — particles rise from coastline at target |
| Same number clicked | Toggle off (existing behavior, no animation) |
| `scale_level` decreases or equal | Instant switch (existing behavior) |

---

## New File: `src/engine/ScaleWaterfall.ts`

Core animation module. Manages a `PIXI.ParticleContainer`, a particle pool,
and a trail render-texture.

### Interfaces

```typescript
interface WaterfallConfig {
  fromPos: { x: number; y: number };  // source station world position
  toPos:   { x: number; y: number };  // target station world position
  coast:   CoastlineModel;             // curve-following path
  scaleJump: number;                   // intensity / particle count
  color: number;                       // target station color (hex)
  duration?: number;                   // ms, default 1500
}

interface Particle {
  sprite: PIXI.Sprite;
  vx: number; vy: number;
  life: number; maxLife: number;
  pathT: number;          // 0-1 position along curve
  isGlyph: boolean;       // number glyph vs glow spark
}
```

### Class outline

```
class ScaleWaterfall {
  container: PIXI.ParticleContainer   // added to world
  private particles: Particle[]
  private trailTexture: PIXI.RenderTexture
  private glyphTextures: Map<string, PIXI.Texture>
  private config: WaterfallConfig | null
  private startTime: number
  active: boolean

  private initGlyphs(renderer): void     // pre-render 0-9, ↑, etc.
  start(config: WaterfallConfig): void
  update(time: number): boolean           // returns isDone
  destroy(): void
}
```

### Animation Phases (~1500 ms, +200 ms per scale_jump)

| Phase | Range | What happens |
|---|---|---|
| **Eruption** | 0-25 % | Source station dims (alpha → 0.3). 30-80 glow sparks burst upward in a cone. A few number-glyph particles (digits from source value) rise and fade. |
| **Ascend** | 25-65 % | Particles flow along the coastline curve toward target. Trail texture accumulates positions → persistent waterfall stream. Color gradient: source color → target color. Continuous emission. |
| **Condense** | 65-85 % | Particles accelerate toward target. Emission stops. Trail fades faster. Target station glows in (alpha 0 → 1). |
| **Landing** | 85-100 % | Remaining particles snap to target and fade. Target station: scale pulse (0.5 → 1.2 → 1.0). Expanding ring (radius 0 → 80, alpha 1 → 0). Trail fully clears. |

### Trail RenderTexture technique

Each frame:
1. Draw a semi-transparent dark rect over the texture (fade ≈ 0.88).
2. Render particles onto the texture.
3. Display the texture as a sprite overlay.

Result: persistent motion trails with ~1 extra draw call.

### Particle budget

| Type | Base | Per scale_jump | Cap |
|---|---|---|---|
| Glow sparks | 40 | +20 | 200 |
| Number glyphs | 10 | +3 | 30 |

ParticleContainer batches sprites → 1-2 draw calls.
Trail texture → 1 draw call.
**Total overhead during animation: ~3 draw calls.**

---

## Modified: `src/App.tsx`

### New refs / state

```typescript
const waterfallRef = useRef<ScaleWaterfall | null>(null);
const prevSelectedRef = useRef<string | null>(null);
```

### Selection flow change (inside `useEffect([selectedId])`)

1. Compare clicked `scale_level` vs `prevSelectedRef.current` scale_level.
2. If increased AND both exist:
   - Build `WaterfallConfig` from source/target node positions.
   - `waterfallRef.current.start(config)`.
   - **Delay** cognitive-visibility change until phase 3 (condense, ~65 %).
   - **Delay** `camera.focusOn()` until phase 2 start (~25 %) so camera follows the rise.
3. Else → existing instant behavior.
4. `prevSelectedRef.current = selectedId`.

### Ticker integration

```typescript
app.ticker.add(() => {
  camera.update();
  const time = performance.now();
  nodes.forEach((n) => n.update(camera.state, time, selectedRef.current));
  if (waterfallRef.current?.active) {
    const done = waterfallRef.current.update(time);
    if (done) { waterfallRef.current.destroy(); waterfallRef.current = null; }
  }
});
```

---

## Modified: `src/content/giant-numbers/numberScene.ts`

### Add to `SiteNode`

```typescript
triggerLandingPulse(): void;  // called when waterfall reaches target
```

### Landing pulse (time-based tween, no library)

- `root.scale`: 0.5 → 1.2 → 1.0 over 400 ms.
- New expanding ring `Graphics`: radius 0 → 80, alpha 1 → 0.

---

## Camera Choreography

| Time | Camera action |
|---|---|
| 0-400 ms | Hold on source (slight zoom-in for drama) |
| 400-1400 ms | `camera.focusOn(target, zoom, 1000)` — smooth pan/zoom |
| 1400-1500 ms | Settled on target; animation finishes |

---

## Edge Cases

1. **Rapid clicks during animation** — cancel current waterfall, start new from current camera position.
2. **拉约数 (largest)** — waterfall goes to ∞ area; right-edge pin activates at landing.
3. **Large jump (e.g. 万 → 拉约数, jump = 5.5)** — duration 2000 ms, more particles, taller waterfall.
4. **First click from overview** — no source station → particles rise from coastline at target (simpler version, no eruption from a previous station).

---

## Dependencies

- PixiJS 7.4.2 only (already installed).
- `ParticleContainer`, `RenderTexture`, `Sprite`, `Graphics` — all built-in.
- **No new npm packages.**

---

## File Summary

| File | Action | Purpose |
|---|---|---|
| `src/engine/ScaleWaterfall.ts` | **NEW** | Particle system + animation controller |
| `src/App.tsx` | MODIFY | Integrate trigger, manage animation state |
| `src/content/giant-numbers/numberScene.ts` | MODIFY | Add `triggerLandingPulse()` |
