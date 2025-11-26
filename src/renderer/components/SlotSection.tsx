import type { JSX } from 'react';
import type { Slot } from '../../common/ipc';

interface SlotSectionProps {
  title?: string;
  slots: Slot[];
  renderItem: (slot: Slot) => JSX.Element;
  fullWidth?: boolean;
  grid?: boolean;
}

function SlotSection({ title, slots, renderItem, fullWidth, grid }: SlotSectionProps): JSX.Element {
  return (
    <section className={`card${fullWidth ? ' layout__full' : ''}`}>
      {title ? <h2 className="section-title">{title}</h2> : null}
      <ul
        className={`firmware-list${grid ? ' slot-grid' : ''}`}
        style={{ marginBottom: 0, paddingBottom: 0, listStyle: 'none' }}
      >
        {slots.map((slot) => (
          <li key={slot} style={{ padding: 0, background: 'none', borderRadius: 0 }}>
            {renderItem(slot)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SlotSection;
