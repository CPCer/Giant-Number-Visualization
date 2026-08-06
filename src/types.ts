export interface GiantNumber {
  id: string;
  name: string;
  value: string;
  value_description: string;
  year: number;
  year_text: string;
  inventor: string;
  story: string;
  /**
   * 概念对数等级（近似体现该数的大小）。
   * 用于在「攀升之路」上定位：等级越大 → 数越大 → 位于曲线越高的位置。
   * 这是一个人工设定的相对刻度，旨在近似呈现各数之间的大小关系，并非精确值。
   */
  scale_level: number;
  color: string;
}
