import type { Slot, SlotStatus, StatusLevel } from '../common/ipc';

export interface SlotViewState {
  slot: Slot;
  status: SlotStatus;
  bytesWritten: number;
  totalBytes: number;
  message?: string;
  volumePath?: string;
}

export interface StatusState {
  level: StatusLevel;
  message: string;
}

export const createInitialSlotState = (): Record<Slot, SlotViewState> => ({
  right: {
    slot: 'right',
    status: 'idle',
    bytesWritten: 0,
    totalBytes: 0
  },
  left: {
    slot: 'left',
    status: 'idle',
    bytesWritten: 0,
    totalBytes: 0
  }
});
