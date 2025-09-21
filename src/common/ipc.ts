export type Slot = 'right' | 'left';

export type SlotStatus = 'idle' | 'ready' | 'waiting' | 'copying' | 'success' | 'error';

export interface FirmwareFileInfo {
  slot: Slot;
  path: string;
  size: number;
  fileName: string;
}

export interface FirmwareReadyPayload {
  files: Record<Slot, FirmwareFileInfo>;
  tempDir: string;
}

export type FirmwareIngestRequest =
  | { kind: 'path'; path: string }
  | { kind: 'buffer'; name: string; data: Uint8Array };

export type StatusLevel = 'info' | 'warning' | 'error' | 'success';

export interface StatusMessagePayload {
  level: StatusLevel;
  message: string;
  slot?: Slot;
  nextStatus?: SlotStatus;
}

export interface CopyProgressPayload {
  slot: Slot;
  bytesWritten: number;
  totalBytes: number;
  volumePath: string;
}

export interface CopyResultPayload {
  slot: Slot;
  success: boolean;
  volumePath: string;
  message?: string;
  finishedAt: number;
}

export interface HistoryEntry extends CopyResultPayload {}

export const IPCChannels = {
  IngestFirmware: 'firmware:ingest',
  Reset: 'firmware:reset',
  FirmwareReady: 'firmware:ready',
  Status: 'flasher:status',
  Progress: 'copy:progress',
  Result: 'copy:result',
  Error: 'flasher:error'
} as const;

export type IpcChannel = (typeof IPCChannels)[keyof typeof IPCChannels];
