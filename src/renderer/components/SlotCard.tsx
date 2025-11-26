import type { JSX } from 'react';
import type { Slot } from '../../common/ipc';
import type { SlotViewState } from '../state';
import { STATUS_COLOR, STATUS_TEXT, SLOT_LABEL } from '../constants';
import { formatBytes, formatPercent } from '../utils/format';

interface SlotCardProps {
  slot: Slot;
  slotState: SlotViewState;
}

function SlotCard({ slot, slotState }: SlotCardProps): JSX.Element {
  const percent = slotState.totalBytes ? slotState.bytesWritten / slotState.totalBytes : 0;

  return (
    <div className="slot-card">
      <div className="slot-card__header">
        <span>{SLOT_LABEL[slot]}</span>
        <span style={{ color: STATUS_COLOR[slotState.status] }}>{STATUS_TEXT[slotState.status]}</span>
      </div>
      <div className="slot-card__progress-bar">
        <div
          className="slot-card__progress"
          style={{ width: `${Math.min(100, percent * 100)}%`, background: STATUS_COLOR[slotState.status] }}
        />
      </div>
      <div className="progress-text">
        <span>{formatPercent(slotState.bytesWritten, slotState.totalBytes)}</span>
        <span>
          {formatBytes(slotState.bytesWritten)} / {formatBytes(slotState.totalBytes)}
        </span>
      </div>
      {slotState.status === 'copying' || slotState.status === 'error' ? (
        slotState.message && <p className="info-text" style={{ color: '#b8c1d1', fontSize: 13 }}>{slotState.message}</p>
      ) : null}
      {slotState.volumePath && <p className="volume-text">接続先: {slotState.volumePath}</p>}
    </div>
  );
}

export default SlotCard;
