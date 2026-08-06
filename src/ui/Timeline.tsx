import type { GiantNumber } from '../types';
import { SCALE_MAX } from '../worldConfig';

interface Props {
  items: GiantNumber[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function Timeline({ items, selectedId, onSelect }: Props) {
  const sorted = [...items].sort((a, b) => a.scale_level - b.scale_level);
  return (
    <div className="timeline">
      <div className="tl-dots">
        {sorted.map((item) => {
          const left = 2 + (item.scale_level / SCALE_MAX) * 80;
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              className={`tl-dot-btn ${active ? 'active' : ''}`}
              style={{ left: `${left}%` }}
              onClick={() => onSelect(item.id)}
            >
              <span className="tl-dot-mark" style={{ background: item.color, color: item.color }} />
              <span className="tl-dot-name">{item.name}</span>
            </button>
          );
        })}
        <span className="tl-infinity-mark" style={{ left: '95%' }}>∞</span>
      </div>
    </div>
  );
}
