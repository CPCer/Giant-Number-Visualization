export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// 时间线归一化：把年份映射到 0~1
const YEAR_MIN = -3500;
const YEAR_MAX = 2025;
export function yearFraction(year: number): number {
  return clamp((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN), 0, 1);
}
