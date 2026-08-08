/**
 * Station Magnitudes — 将现有站点映射到 Magnitude 对象
 * 用于 Expression Forge 的实时比较和海岸线定位
 *
 * 关键修正：
 *   - googolplex 从 named 改为 tower(height=2)，因为 10^(10^100) 本质是幂塔
 *   - skewes 从 log(log10=1e10) 改为 tower(height=3)，因为 e^e^e^79 本质是三重幂塔
 *   - 旧的 log 类型导致 skewes 的 rankValue=1e10 >> graham 的 rank=9000，排序错乱
 *   - 新的 tower 类型将 skewes 正确归入 tower tier，低于 arrow/named tier
 */
import type { GiantNumber } from '../../types';
import type { Magnitude, StationRef } from '../../engine/magnitude';

const STATION_MAG_MAP: Record<string, Magnitude> = {
  one: { kind: 'exact', value: 1n, log10: 0 },
  wan: { kind: 'exact', value: 10000n, log10: 4 },
  googol: { kind: 'log', log10: 100 },
  // 10^(10^100) = 幂塔 height=2
  googolplex: { kind: 'tower', base: 10, height: 2, label: '古戈尔普勒克斯' },
  // e^e^e^79 ≈ 10^10^10^34 = 幂塔 height=3
  skewes: { kind: 'tower', base: 10, height: 3, label: '斯奎斯数' },
  graham: { kind: 'named', id: 'graham', rank: 9000, label: '葛立恒数' },
  tree3: { kind: 'named', id: 'tree3', rank: 9500, label: 'TREE(3)' },
  rayo: { kind: 'named', id: 'rayo', rank: 10000, label: '拉约数' },
};

/** 站点的 displayRank — 人工标定的归一化排名 (0-100) */
const STATION_DISPLAY_RANKS: Record<string, number> = {
  one: 0,
  wan: 5,
  googol: 12,
  googolplex: 16,
  skewes: 20,
  graham: 55,
  tree3: 75,
  rayo: 95,
};

/** 从站点数据构建 StationRef 数组 */
export function buildStationRefs(items: GiantNumber[]): StationRef[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    scaleLevel: item.scale_level,
    magnitude: STATION_MAG_MAP[item.id] ?? { kind: 'log', log10: item.scale_level * 10 },
    displayRank: STATION_DISPLAY_RANKS[item.id] ?? 0,
  }));
}
