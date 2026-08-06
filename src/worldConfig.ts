/**
 * 世界配置：攀升之路的坐标体系。
 *
 * 视觉隐喻：一条从左下攀升至右上的「认知之路」。
 *   左端  →  无穷小方向，曲线延伸很远并渐隐，永远看不到尽头
 *   站点区 →  人类已命名的大数，按 scale_level 对数尺度排列
 *   拉约数 →  曲线变为虚线，继续攀升、渐隐
 *   ∞     →  曲线的终点、永恒的右端，不管怎么缩放都在那里
 */
export const WORLD_WIDTH = 130000;
export const WORLD_HEIGHT = 8000;

/** 每个 scale_level 对应的世界单位距离（越大越震撼） */
export const UNITS_PER_LEVEL = 8000;

/** 拉约数的 scale_level，作为站点区映射的上界 */
export const SCALE_MAX = 6.5;

// 攀升曲线的关键 x 坐标（世界单位）
export const LEFT_X = -60000; // 左端延伸起点（无穷小方向，很远）
export const DATA_START_X = 5000; // 第一个站点（scale 0，「一」）
export const DATA_END_X = DATA_START_X + SCALE_MAX * UNITS_PER_LEVEL; // 最后站点（scale 6.5，拉约数）
export const INFINITY_X = DATA_END_X + 1500; // ∞ 符号位置 = 曲线终点（距拉约数更近，聚焦时统一 0.40 缩放）
export const RIGHT_X = INFINITY_X; // 曲线在 ∞ 处终止，不向右延伸

/** 默认相机平移边界（全局俯瞰模式） */
export const CAM_MIN_X = -12000; // 可左移看渐隐海岸，但到不了左端
export const CAM_MAX_X = DATA_END_X; // 默认不能拖到 ∞——∞ 不可达
export const CAM_MIN_Y = -2000;
export const CAM_MAX_Y = WORLD_HEIGHT + 2000;

/** 默认最小缩放（防止缩太小看到左端） */
export const DEFAULT_MIN_ZOOM = 0.022;

/** 点击站点后的聚焦缩放 */
export const FOCUS_ZOOM = 0.40;

/** 把 scale_level 映射到世界 x 坐标（站点区线性映射） */
export function scaleLevelToX(level: number): number {
  return DATA_START_X + level * UNITS_PER_LEVEL;
}
