import type { GiantNumber } from '../../types';

/** Short label for particle glyphs — the source number's identity. */
export function glyphLabel(data: GiantNumber): string {
  const v = data.value;
  if (v.length <= 8) return v;
  const abbrev: Record<string, string> = {
    googolplex: '10^G',
    skewes: 'e^e^e^79',
    graham: 'G₆₄',
    tree3: 'TREE(3)',
    rayo: 'Rayo',
  };
  return abbrev[data.id] ?? data.name;
}
