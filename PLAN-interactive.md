# World Engine: Interactive Giant Number Exhibition — Plan

## Background

The Giant Number Exhibition is currently a **read-only visualization**: predefined stations along a fractal coastline, with a Scale Waterfall animation for transitions. The goal is to make it **interactive** — users should *operate on magnitude*, not just read about it.

The user's instinct: a "calculator" or "game" where users achieve/discover numbers themselves.

Bailian consultation (qwen3.8-max, 2026-08-07) returned 5 concrete concepts plus a foundational architecture. Below is a synthesized plan.

---

## The Foundation: Magnitude Engine

All interactive concepts share one prerequisite: a **scale-aware number engine** that can evaluate expressions not by computing impossible integers, but by classifying their *magnitude* and placing them on the coastline.

### Why not just use BigInt or math.js?

Numbers like Graham's number, TREE(3), and Rayo's number **cannot be computed** — they exceed the universe's storage capacity. We need a representation that handles:

| Scale tier | Example | Representation |
|---|---|---|
| Exact small | `1`, `10000`, `factorial(20)` | `BigInt` with exact digits |
| Logarithmic | `10^100`, `factorial(100)` | `log10` value (Stirling's approximation for factorial) |
| Power tower | `10^10^10`, `3^^4` | Tower descriptor (base + height) |
| Arrow notation | `3↑↑↑↑3` | Arrow descriptor (operands + arrow count) |
| Named monsters | Graham, TREE(3), Rayo | Curated ordinal rank |

### Core API

```typescript
type Magnitude =
  | { kind: "exact"; value: bigint; log10: number }
  | { kind: "log"; log10: number }
  | { kind: "tower"; base: number; height: number }
  | { kind: "arrow"; left: number; arrows: number; right: number }
  | { kind: "named"; id: string; rank: number };

function compareMagnitude(a: Magnitude, b: Magnitude): -1 | 0 | 1;
function toScaleLevel(mag: Magnitude, stations: Station[]): number;
function describeMagnitude(mag: Magnitude): string;
function evaluateExpression(ast: ExprNode): Magnitude;
```

### Operation formulas (log-domain)

| Operation | Formula |
|---|---|
| `a + b` | If magnitudes differ by >10, larger dominates; else log-sum-exp |
| `a × b` | `log10(a×b) = log10(a) + log10(b)` |
| `a ^ b` | `log10(a^b) = b × log10(a)`; if b is huge, produce tower descriptor |
| `factorial(n)` | Stirling: `log10(n!) ≈ n·log10(n/e) + 0.5·log10(2πn)` |
| `tetration` | Tower descriptor: `{ base, height }` |
| `arrow` | Approximate by tower height or named rank |

### Placement on coastline

User-created numbers are placed by:
1. Compare against known stations using `compareMagnitude`
2. Find the two bracketing stations
3. Interpolate a position between them
4. If beyond the last station (Rayo), generate a foggy procedural extension

---

## Concept Evaluation

Bailian proposed 5 concepts. Here's my assessment of each, filtered through the current codebase:

### Concept 1: Expression Forge (Calculator Sandbox) ⭐ Recommended

**What**: Users build expressions using operator chips (`[10] [^] [100]`), see a live "scale needle" preview on the coastline, then click "Materialize" to trigger the Scale Waterfall and place a custom marker.

**Strengths**:
- Directly matches the user's "calculator" idea
- Reuses the existing Scale Waterfall animation
- Naturally extends the exhibition without restructuring it
- The expression builder (chips) is safe — no `eval()`, no security risk

**My take**: This is the strongest starting point. It's the most natural extension of what exists, and it immediately makes the exhibition feel alive. Users can type `10^10^10` and *see* where it lands relative to Graham's number.

### Concept 2: Scale Ascent (Progressive Puzzle Game) ⭐ Recommended

**What**: Users start at `1` and must reach each station using a limited set of operation cards. E.g., reach 10000 using only `×10` (4 moves). Later levels unlock `^`, `factorial`, `tetration`, `arrow`.

**Strengths**:
- Directly matches the user's "game to achieve the next number" idea
- Progression creates a narrative arc (begin with 1, become incomprehensible)
- Operation unlocks double as pedagogical reveals
- The "launch" action reuses the Scale Waterfall

**My take**: This pairs perfectly with the Forge. The Forge is the sandbox; Ascent is the campaign. Building both gives users freedom *and* direction.

### Concept 3: Curator Expedition (Hybrid Museum)

**What**: Three modes — Wander (free explore), Quest (station challenges), Curate (save custom markers). Personal monuments persist via localStorage; shareable via URL hash.

**My take**: This is the long-term vision — a "personal museum of magnitude." But it's a wrapper around Concepts 1+2, not a standalone mechanic. Build it after the Forge and Ascent are working.

### Concept 4: Magnitude Trials (Scale-Feeling Micro-Interactions)

**What**: Embedded micro-mechanics: "Zero Pour" (hold to pour zeros), "Universe Ledger" (comparison engine), "Zoom Gates" (intermediate log-scale rings during travel), "Operation Shockwaves" (distinct visual per operation), "Log Lens" (reveal logarithms).

**My take**: These are **enhancements** to be layered onto the Forge/Ascent, not standalone features. The "Log Lens" and "Zoom Gates" are particularly compelling — they solve the "disorienting jump" problem when the camera travels between very different scales.

### Concept 5: Notation Gauntlet (Symbol-Budget Challenge)

**What**: Using a limited symbol budget, create the largest possible number. Rayo's number appears as the final unbeatable boss — it's literally defined as "the largest number expressible in N symbols of set theory."

**My take**: Brilliant conceptually, but niche. Better as a late-game challenge mode within Scale Ascent rather than a separate feature.

---

## Recommended MVP: Forge + Ascent

Build two intertwined modes sharing one Magnitude Engine:

### Architecture

```
src/
├── engine/
│   ├── magnitude.ts          ← Magnitude type + compareMagnitude + toScaleLevel
│   ├── expressionParser.ts   ← Recursive descent parser: chips → AST
│   ├── evaluator.ts          ← AST → Magnitude (log-domain arithmetic)
│   ├── ScaleWaterfall.ts     ← (existing, upgrade to use Magnitude)
│   ├── Camera.ts             ← (existing)
│   └── coastline.ts          ← (existing)
├── content/giant-numbers/
│   ├── data.json             ← (existing, add rank/expression fields)
│   ├── numberScene.ts        ← (existing, add user marker support)
│   └── glyphLabel.ts         ← (existing)
├── ui/
│   ├── Timeline.tsx          ← (existing)
│   ├── ExpressionForge.tsx   ← NEW: chip-based expression builder + preview
│   ├── AscentPanel.tsx       ← NEW: level UI + operation cards + launch
│   └── LogLens.tsx           ← NEW: toggle logarithm overlay
├── game/
│   ├── levels.ts             ← Level definitions (start, target, ops, hints)
│   └── progression.ts        ← Unlock logic, localStorage persistence
└── App.tsx                   ← Integrate Forge + Ascent modes
```

### Phase 1: Magnitude Engine (prerequisite for everything)

- Define `Magnitude` union type
- Implement `compareMagnitude()` with tier-aware comparison
- Implement `toScaleLevel()` — bracket between stations, interpolate
- Implement `describeMagnitude()` — human-readable scale description
- Implement expression parser (recursive descent, right-associative for `^` and `↑`)
- Implement evaluator with log-domain formulas
- Unit tests: verify googol > 10000, Graham > googolplex, etc.

### Phase 2: Expression Forge (calculator)

- Chip-based expression builder UI (drag chips into slots)
- Supported chips: numbers (0-9), `+`, `×`, `^`, `!`, `^^`, `↑`, `↑↑`, named presets
- Live "scale needle" — as expression changes, a ghost marker previews position on coastline
- "Materialize" button → triggers Scale Waterfall from nearest station to the computed position
- Custom marker placed on coastline with user-chosen name
- Markers persist in localStorage

### Phase 3: Scale Ascent (game)

- Level definitions for 5 stations:
  1. `1 → 10000` (ops: `+1`, `×10`)
  2. `10000 → googol` (ops: `×10`, `^`)
  3. `googol → googolplex` (ops: `^`, named)
  4. `googolplex → 10^10^10` (ops: `tower builder`)
  5. `10^10^10 → Graham preview` (ops: `arrow`)
- Operation cards UI — drag into expression slots
- Move limit per level
- "Launch" → Scale Waterfall from current position to result
- Success: station awakens, unlock next level + new operation card
- Failure (overshoot/undershoot): show where it landed, allow retry
- Progress persists in localStorage

### Phase 4: Polish & Enhancements

- **Log Lens**: toggle button that overlays `log10` values on all visible stations
- **Zoom Gates**: when camera travels across >2 scale levels, show intermediate rings (`10^20`, `10^30`, ...)
- **Operation Shockwaves**: distinct particle effects per operation type
- **URL sharing**: encode expression in URL hash for shareable markers
- **Pedagogical copy**: "Your number has ~10^100 digits. If each digit were an atom..."

---

## Key Design Decisions (for user)

### 1. Input method: chips vs free text?

**Recommendation: chips first, text later.**
Chips are safe (no eval), game-like, and work on touch devices. Free-text input can be added as a power-user feature once the parser is solid.

### 2. MVP scope: Forge only, Ascent only, or both?

**Recommendation: both, but sequenced.**
The Magnitude Engine is the prerequisite for both. Build the Forge first (simpler, more open-ended), then layer Ascent on top (adds structure/progression).

### 3. How to handle numbers beyond Rayo?

**Recommendation: foggy procedural extension.**
If a user somehow constructs a number larger than Rayo's number (unlikely with chips, but possible with creative arrow notation), show a "Beyond Rayo — Unmapped Magnitude" zone with fog effects.

### 4. Expression parser: library or hand-written?

**Recommendation: hand-written recursive descent.**
The grammar is simple (numbers, binary ops with precedence, unary factorial, named constants). A hand-written parser avoids dependencies and keeps the bundle small for static deployment.

---

## What stays the same

- Coastline generation and fractal metaphor
- Camera system (zoom, pan, focus, right-edge pin)
- Scale Waterfall particle animation
- LOD rendering for stations
- Timeline UI
- The ∞ symbol as eternal right endpoint

## What changes

- `data.json`: add `expression` and `rank` fields to each station
- `ScaleWaterfall`: accept `Magnitude` objects, vary particle glyphs by scale tier
- `numberScene.ts`: support dynamic user-placed markers (not just predefined stations)
- `App.tsx`: add mode switching (Exhibition / Forge / Ascent)
- New: Magnitude Engine, expression parser, evaluator, Forge UI, Ascent UI
