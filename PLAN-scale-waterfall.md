# 數階瀑布 (Scale Waterfall) — Implementation Plan

## Concept

**Core metaphor: Accumulation.** The target number is literally *built from*
copies of the source number. When the user levels up from 一 to 万, thousands
of "1" glyphs erupt and stream upward along the coastline, condensing into 万
— because 万 = ten thousand ones.

The bigger the `scale_level` jump, the more glyphs erupt, the wider and denser
the stream — conveying the incomprehensible scale of the gap.

Animation flow:
1. Copies of the **source number's glyph** erupt upward from the source station.
2. They form a glowing waterfall stream rising along the coastline curve.
3. At the top they compress and condense into the new station with a pulse + ring.

### Glyph selection (what text appears on particles)

| Source number | Particle glyph | Why |
|---|---|---|
| 一 | `1` | Short, instantly recognizable |
| 万 | `万` | Name is compact; value `10⁴` also works |
| 古戈尔 | `10¹⁰⁰` | Mathematical notation |
| 古戈尔普勒克斯 | `10^G` | Abbreviated (full value too long for a particle) |
| 斯奎斯数 | `e^e^e^79` | Abbreviated |
| 葛立恒数 | `G₆₄` | Arrow notation abbreviation |
| TREE(3) | `TREE(3)` | Compact enough |
| 拉约数 | `Rayo` | Name (value is just "Rayo's number") |

Rule: use `value` field if ≤ 8 chars, else use `name` or a manual abbreviation.
This mapping lives in a `glyphLabel(data: GiantNumber): string` helper.

---

## Trigger Logic

| Situation | Behavior |
|---|---|
| `scale_level` increases (bigger number clicked) | **Full waterfall animation** — source glyphs erupt |
| First click from overview (no previous selection) | Milder version — glyphs rise from coastline at target |
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
  sourceGlyph: string;                 // text shown on glyph particles (e.g. "1")
  sourceColor: number;                 // source station color (hex)
  targetColor: number;                 // target station color (hex)
  duration?: number;                   // ms, default 1500
}

interface Particle {
  sprite: PIXI.Sprite;
  vx: number; vy: number;
  life: number; maxLife: number;
  pathT: number;          // 0-1 position along curve
  isGlyph: boolean;       // number glyph vs glow spark (glyphs are primary)
  glyphScale: number;     // individual size variation
}
```

### Class outline

```
class ScaleWaterfall {
  container: PIXI.ParticleContainer   // added to world
  private particles: Particle[]
  private trailTexture: PIXI.RenderTexture
  private glyphTexture: PIXI.Texture  // pre-rendered source glyph
  private sparkTexture: PIXI.Texture  // soft glow circle
  private config: WaterfallConfig | null
  private startTime: number
  active: boolean

  private initTextures(renderer): void  // pre-render glyph + spark to textures
  start(config: WaterfallConfig): void
  update(time: number): boolean          // returns isDone
  destroy(): void
}
```

### Glyph pre-rendering

Before the animation starts, render the source glyph text (e.g. "1") to a
`PIXI.RenderTexture` using `PIXI.Text` → `app.renderer.generateTexture()`.

```typescript
const text = new PIXI.Text(sourceGlyph, new PIXI.TextStyle({
  fontFamily: 'JetBrains Mono, Consolas, monospace',
  fontSize: 28,
  fill: 0xffffff,
  stroke: sourceColor,
  strokeThickness: 2,
}));
const glyphTexture = app.renderer.generateTexture(text);
```

All glyph particles share this one texture → **single draw call** for all glyphs.

### Animation Phases (~1500 ms, +200 ms per scale_jump)

| Phase | Range | What happens |
|---|---|---|
| **Eruption** | 0-25 % | Source station dims (alpha → 0.3). Glyph particles burst upward in a widening cone — **these are copies of the source number** (e.g. dozens of "1"s for 一→万). A few glow sparks intermixed for texture. |
| **Ascend** | 25-65 % | Glyph particles flow along the coastline curve toward target. Trail texture accumulates → persistent waterfall stream. Color tint gradually shifts source→target. **Stream widens with bigger jumps** — a jump of 5.5 (万→拉约数) creates a much wider, denser stream than 1.0 (一→万), conveying incomprehensible scale. Continuous emission of new glyphs. |
| **Condense** | 65-85 % | Glyphs accelerate toward target, shrinking and overlapping. Emission stops. Trail fades faster. Glyphs visually "compress" into the target station. Target station glows in (alpha 0 → 1). |
| **Landing** | 85-100 % | Remaining glyphs snap to target and fade. Target station: scale pulse (0.5 → 1.2 → 1.0). Expanding ring (radius 0 → 80, alpha 1 → 0). Trail fully clears. |

### Stream width = scale gap

| Jump | Stream width | Glyph count | Duration |
|---|---|---|---|
| 1.0 (一→万) | narrow, ~60 units | 40 glyphs | 1500 ms |
| 2.0 (万→古戈尔) | medium, ~120 units | 80 glyphs | 1700 ms |
| 3.5 (万→葛立恒) | wide, ~200 units | 120 glyphs | 1900 ms |
| 5.5 (万→拉约数) | very wide, ~300 units | 160 glyphs | 2100 ms |

Wider streams + more glyphs = visceral sense of "this gap is incomprehensibly
larger." The viewer sees the swarm get impossibly dense for big jumps.

### Trail RenderTexture technique

Each frame:
1. Draw a semi-transparent dark rect over the texture (fade ≈ 0.88).
2. Render particles onto the texture.
3. Display the texture as a sprite overlay.

Result: persistent motion trails with ~1 extra draw call.

### Particle budget

| Type | Base | Per scale_jump | Cap |
|---|---|---|---|
| Glyph particles (source number) | 30 | +15 | 160 |
| Glow sparks (accent) | 15 | +5 | 60 |

Glyphs share 1 texture → 1 draw call.
Sparks share 1 texture → 1 draw call.
Trail texture → 1 draw call.
**Total overhead during animation: ~3 draw calls.**

---

## New Helper: `src/content/giant-numbers/glyphLabel.ts`

```typescript
import type { GiantNumber } from '../../types';

/** Short label for particle glyphs — source number's identity */
export function glyphLabel(data: GiantNumber): string {
  const v = data.value;
  if (v.length <= 8) return v;
  // Manual abbreviations for long values
  const abbrev: Record<string, string> = {
    'googolplex': '10^G',
    'skewes': 'e^e^e^79',
    'graham': 'G₆₄',
    'tree3': 'TREE(3)',
    'rayo': 'Rayo',
  };
  return abbrev[data.id] ?? data.name;
}
```

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
   - Build `WaterfallConfig` from source/target node positions + glyph label.
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
| 400-1400 ms | `camera.focusOn(target, zoom, 1000)` — smooth pan/zoom follows the rising stream |
| 1400-1500 ms | Settled on target; animation finishes |

---

## Edge Cases

1. **Rapid clicks during animation** — cancel current waterfall, start new from current camera position.
2. **拉约数 (largest)** — waterfall goes to ∞ area; right-edge pin activates at landing.
3. **Large jump (e.g. 万 → 拉约数, jump = 5.5)** — duration 2100 ms, 160 glyphs, very wide stream — the incomprehensible density is the point.
4. **First click from overview** — no source station → glyphs of the target number itself rise from coastline at target (simpler version, no eruption from a previous station).

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
| `src/content/giant-numbers/glyphLabel.ts` | **NEW** | Source number → short glyph label helper |
| `src/App.tsx` | MODIFY | Integrate trigger, manage animation state |
| `src/content/giant-numbers/numberScene.ts` | MODIFY | Add `triggerLandingPulse()` |
