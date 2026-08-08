import * as PIXI from 'pixi.js';
import type { CoastlineModel } from './coastline';

export interface WaterfallConfig {
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  coast: CoastlineModel;
  scaleJump: number;
  sourceGlyph: string;
  sourceColor: number;
  targetColor: number;
  duration: number;
}

interface Particle {
  sprite: PIXI.Sprite;
  pathT: number;
  pathSpeed: number;
  baseOffset: number;
  wavePhase: number;
  waveFreq: number;
  waveAmp: number;
  isGlyph: boolean;
  baseScale: number;
  rotation: number;
  rotSpeed: number;
  age: number;
  maxAge: number;
  active: boolean;
}

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(c1: number, c2: number, t: number): number {
  const [r1, g1, b1] = hexToRgb(c1);
  const [r2, g2, b2] = hexToRgb(c2);
  return (
    (Math.round(lerp(r1, r2, t)) << 16) |
    (Math.round(lerp(g1, g2, t)) << 8) |
    Math.round(lerp(b1, b2, t))
  );
}

/**
 * 數階瀑布 — a massive particle eruption visualizing the accumulation metaphor.
 *
 * The source number's glyph erupts in overwhelming quantity — thousands of
 * copies boom from the source station, fill the screen, and stream upward
 * along the coastline curve to condense into the target number.
 *
 * Particle count scales exponentially with scaleJump:
 *   一→万 (jump 1):  ~5,000 glyphs  (because 10,000 ones make a 万)
 *   jump 2:          ~10,000 glyphs
 *   jump 3+:         ~10,000 (capped for performance)
 *
 * Performance: all sprites are pre-allocated at start() — zero GC pressure
 * during animation. Tint is set once at spawn for large counts. Dead
 * particles are marked inactive (no array splicing).
 *
 * Phases (progress 0→1):
 *   0-20%   Eruption  — massive burst + shockwave + flash
 *   20-65%  Ascend    — particles dance along curve: wave-sway + tumble
 *   65-85%  Condense  — inward spiral, accelerate, target fades in
 *   85-100% Landing   — convergence + landing pulse (handled by SiteNode)
 */
export class ScaleWaterfall {
  container: PIXI.Container;
  active = false;

  onAscendStart?: () => void;
  onCondense?: () => void;
  onLanding?: () => void;

  private particles: Particle[] = [];
  private glyphTexture: PIXI.Texture | null = null;
  private sparkTexture: PIXI.Texture | null = null;
  private config: WaterfallConfig | null = null;
  private startTime = 0;
  private lastTime = 0;
  private emitAcc = 0;
  private totalToEmit = 0;
  private emittedCount = 0;
  private phaseFlags = { ascend: false, condense: false, landing: false };
  private app: PIXI.Application;
  private shockwave: PIXI.Graphics | null = null;
  private alphaScale = 1;
  private doPerFrameTint = true;

  constructor(app: PIXI.Application) {
    this.app = app;
    this.container = new PIXI.Container();
  }

  start(config: WaterfallConfig): void {
    this.config = config;
    this.active = true;
    this.startTime = performance.now();
    this.lastTime = this.startTime;
    this.emitAcc = 0;
    this.emittedCount = 0;
    this.phaseFlags = { ascend: false, condense: false, landing: false };

    // ── Exponential particle count ──
    // 一→万 (jump 1) should feel like ~10,000 ones erupting.
    // Double per scale_level jump, cap for performance.
    const baseCount = 5000;
    const glyphCount = Math.min(
      Math.max(2500, Math.floor(baseCount * Math.pow(2, config.scaleJump - 1))),
      10000
    );
    const sparkRatio = glyphCount > 5000 ? 0.25 : 0.4;
    const sparkCount = Math.min(Math.floor(glyphCount * sparkRatio), 4000);
    this.totalToEmit = glyphCount + sparkCount;

    // Alpha scaling: prevent whiteout when thousands of ADD-blended particles overlap
    this.alphaScale = Math.max(0.06, 1 - glyphCount / 13000);

    // Skip per-frame tint for large counts (set once at spawn instead)
    this.doPerFrameTint = this.totalToEmit < 800;

    this.initTextures(config);
    this.preAllocateParticles(glyphCount, sparkCount, config);

    if (this.shockwave) this.shockwave.destroy();
    this.shockwave = new PIXI.Graphics();
    this.container.addChild(this.shockwave);
  }

  private initTextures(config: WaterfallConfig): void {
    if (this.glyphTexture) {
      this.glyphTexture.destroy(true);
      this.glyphTexture = null;
    }
    if (this.sparkTexture) {
      this.sparkTexture.destroy(true);
      this.sparkTexture = null;
    }

    const text = new PIXI.Text(
      config.sourceGlyph,
      new PIXI.TextStyle({
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: 28,
        fill: 0xffffff,
        stroke: config.sourceColor,
        strokeThickness: 2,
        padding: 4,
      })
    );
    this.glyphTexture = this.app.renderer.generateTexture(text);
    text.destroy();

    const g = new PIXI.Graphics();
    g.beginFill(0xffffff, 0.12).drawCircle(0, 0, 14).endFill();
    g.beginFill(0xffffff, 0.3).drawCircle(0, 0, 8).endFill();
    g.beginFill(0xffffff, 0.9).drawCircle(0, 0, 4).endFill();
    this.sparkTexture = this.app.renderer.generateTexture(g);
    g.destroy();
  }

  private preAllocateParticles(
    glyphCount: number,
    sparkCount: number,
    config: WaterfallConfig
  ): void {
    // Destroy old pool
    this.particles.forEach((p) => p.sprite.destroy());
    this.particles = [];

    const sw = 60 + Math.min(config.scaleJump * 300, 2000);
    const glyphTravel = config.duration * 0.55;
    const sparkTravel = config.duration * 0.45;

    // Pre-allocate glyph particles
    for (let i = 0; i < glyphCount; i++) {
      const sprite = new PIXI.Sprite(this.glyphTexture!);
      sprite.anchor.set(0.5);
      sprite.blendMode = PIXI.BLEND_MODES.ADD;
      sprite.visible = false;
      // Set tint once at spawn: random blend toward target for variety
      const initT = Math.random() * 0.3;
      sprite.tint = this.doPerFrameTint
        ? config.sourceColor
        : lerpColor(config.sourceColor, config.targetColor, initT);
      this.container.addChild(sprite);

      this.particles.push({
        sprite,
        pathT: 0,
        pathSpeed: (1 / glyphTravel) * (0.7 + Math.random() * 0.6),
        baseOffset: (Math.random() - 0.5) * sw + (Math.random() - 0.5) * 20,
        wavePhase: Math.random() * Math.PI * 2,
        waveFreq: 0.002 + Math.random() * 0.003,
        waveAmp: 15 + Math.random() * 35,
        isGlyph: true,
        baseScale: 0.7 + Math.random() * 0.5,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.008,
        age: 0,
        maxAge: config.duration * 0.7,
        active: false,
      });
    }

    // Pre-allocate spark particles
    for (let i = 0; i < sparkCount; i++) {
      const sprite = new PIXI.Sprite(this.sparkTexture!);
      sprite.anchor.set(0.5);
      sprite.blendMode = PIXI.BLEND_MODES.ADD;
      sprite.visible = false;
      sprite.tint = config.sourceColor;
      this.container.addChild(sprite);

      this.particles.push({
        sprite,
        pathT: 0,
        pathSpeed: (1 / sparkTravel) * (0.6 + Math.random() * 0.8),
        baseOffset: (Math.random() - 0.5) * sw,
        wavePhase: Math.random() * Math.PI * 2,
        waveFreq: 0.003 + Math.random() * 0.004,
        waveAmp: 10 + Math.random() * 30,
        isGlyph: false,
        baseScale: 0.4 + Math.random() * 0.4,
        rotation: 0,
        rotSpeed: 0,
        age: 0,
        maxAge: config.duration * 0.5,
        active: false,
      });
    }

    // Shuffle so glyphs and sparks interleave during emission
    for (let i = this.particles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.particles[i], this.particles[j]] = [this.particles[j], this.particles[i]];
    }
  }

  update(time: number): boolean {
    if (!this.config || !this.active) return true;

    const elapsed = time - this.startTime;
    const progress = elapsed / this.config.duration;

    if (progress >= 1) {
      this.cleanup();
      return true;
    }

    const dt = Math.min(time - this.lastTime, 50);
    this.lastTime = time;

    // ── Phase callbacks ──
    if (progress >= 0.25 && !this.phaseFlags.ascend) {
      this.phaseFlags.ascend = true;
      this.onAscendStart?.();
    }
    if (progress >= 0.65 && !this.phaseFlags.condense) {
      this.phaseFlags.condense = true;
      this.onCondense?.();
    }
    if (progress >= 0.85 && !this.phaseFlags.landing) {
      this.phaseFlags.landing = true;
      this.onLanding?.();
    }

    // ── Beat system ──
    const beatInterval = this.config.duration / 8;
    const beatPhase = (elapsed / beatInterval) * Math.PI * 2;
    const beatPulse = Math.pow(Math.max(0, Math.sin(beatPhase)), 2);
    const beatMult = 0.4 + 0.6 * beatPulse;
    this.container.alpha = 0.82 + 0.18 * beatPulse;

    // ── Eruption: boom burst — emit ALL particles in first 20% ──
    if (progress < 0.20 && this.emittedCount < this.particles.length) {
      const emissionMs = this.config.duration * 0.20;
      const rate = (this.totalToEmit / emissionMs) * 1000 * beatMult;
      this.emitAcc += rate * dt;
      while (this.emitAcc >= 1 && this.emittedCount < this.particles.length) {
        const p = this.particles[this.emittedCount];
        p.active = true;
        p.sprite.visible = true;
        p.sprite.alpha = 0;
        this.emittedCount++;
        this.emitAcc -= 1;
      }
    }

    // ── Shockwave + flash (0-15%) ──
    if (this.shockwave && progress < 0.15) {
      const swT = progress / 0.15;
      const swMaxRadius = 100 + Math.min(this.totalToEmit * 0.04, 400);
      this.shockwave.clear();
      // Flash fill — bright burst that quickly fades
      const flashAlpha = (1 - swT) * 0.25 * this.alphaScale;
      this.shockwave.beginFill(this.config.sourceColor, flashAlpha);
      this.shockwave.drawCircle(
        this.config.fromPos.x,
        this.config.fromPos.y,
        50 + swT * swMaxRadius * 0.5
      );
      this.shockwave.endFill();
      // Expanding ring
      this.shockwave.lineStyle(3, this.config.sourceColor, (1 - swT) * 0.7);
      this.shockwave.drawCircle(
        this.config.fromPos.x,
        this.config.fromPos.y,
        20 + swT * swMaxRadius
      );
    } else if (this.shockwave) {
      this.shockwave.clear();
    }

    // ── Update all emitted particles ──
    const condenseBoost = progress > 0.65 ? 1 + (progress - 0.65) * 4 : 1;

    for (let i = 0; i < this.emittedCount; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      p.age += dt;
      p.pathT += p.pathSpeed * dt * condenseBoost;

      if (p.pathT >= 1) {
        // Reached target — fade out
        p.sprite.alpha *= 0.82;
        if (p.sprite.alpha < 0.02) {
          p.active = false;
          p.sprite.visible = false;
        } else {
          p.sprite.x = this.config.toPos.x;
          p.sprite.y = this.config.toPos.y;
        }
        continue;
      }

      // Position: coastline path + sine sway + condense spiral
      const x = lerp(this.config.fromPos.x, this.config.toPos.x, p.pathT);
      const sample = this.config.coast.getPointAtX(x);

      const waveOffset = Math.sin(time * p.waveFreq + p.wavePhase) * p.waveAmp;
      const totalOffset = p.baseOffset + waveOffset;

      let swirlX = 0;
      let swirlY = 0;
      if (progress > 0.5) {
        const swirlT = (progress - 0.5) / 0.5;
        const swirlAmount = swirlT * 60 * (1 - p.pathT * 0.3);
        const swirlAngle = p.pathT * Math.PI * 5 + p.wavePhase + time * 0.004;
        swirlX = Math.cos(swirlAngle) * swirlAmount;
        swirlY = Math.sin(swirlAngle) * swirlAmount;
      }

      p.sprite.x = sample.x + sample.normalX * totalOffset + swirlX;
      p.sprite.y = sample.y + sample.normalY * totalOffset + swirlY;

      // Tumble glyphs
      if (p.isGlyph) {
        p.rotation += p.rotSpeed * dt;
        p.sprite.rotation = p.rotation;
      }

      // Per-frame tint only for small counts
      if (this.doPerFrameTint) {
        p.sprite.tint = lerpColor(
          this.config.sourceColor,
          this.config.targetColor,
          p.pathT
        );
      }

      // Scale: shrink during condense
      let scale = p.baseScale;
      if (progress > 0.65) {
        const ct = (progress - 0.65) / 0.35;
        scale *= 1 - ct * 0.5;
      }
      p.sprite.scale.set(scale);

      // Alpha: fade in on birth, fade out with age + condense
      const ageT = p.age / p.maxAge;
      let alpha = 1;
      if (ageT < 0.1) {
        alpha = ageT / 0.1;
      } else if (ageT > 0.7) {
        alpha = 1 - (ageT - 0.7) / 0.3;
      }
      if (progress > 0.65) {
        alpha *= 1 - ((progress - 0.65) / 0.35) * 0.4;
      }
      p.sprite.alpha = Math.max(0, alpha * this.alphaScale);
    }

    return false;
  }

  private cleanup(): void {
    this.particles.forEach((p) => p.sprite.destroy());
    this.particles = [];
    if (this.glyphTexture) {
      this.glyphTexture.destroy(true);
      this.glyphTexture = null;
    }
    if (this.sparkTexture) {
      this.sparkTexture.destroy(true);
      this.sparkTexture = null;
    }
    if (this.shockwave) {
      this.shockwave.destroy();
      this.shockwave = null;
    }
    this.container.removeChildren();
    this.container.alpha = 1;
    this.active = false;
  }

  destroy(): void {
    this.cleanup();
    if (this.container.parent) {
      this.container.parent.removeChild(this.container);
    }
    this.container.destroy({ children: true });
  }
}
