import { contextBridge, ipcRenderer } from 'electron';
import {
  CopyProgressPayload,
  CopyResultPayload,
  FirmwareReadyPayload,
  FirmwareIngestRequest,
  IPCChannels,
  LogEntry,
  StatusMessagePayload
} from './common/ipc';

type Unsubscribe = () => void;

type Listener<Payload> = (callback: (payload: Payload) => void) => Unsubscribe;

const subscribe = <Payload>(channel: string): Listener<Payload> => (callback) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: Payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  ingestFirmware: (payload: FirmwareIngestRequest) => ipcRenderer.invoke(IPCChannels.IngestFirmware, payload),
  reset: () => ipcRenderer.invoke(IPCChannels.Reset),
  getLogs: () => ipcRenderer.invoke(IPCChannels.GetLogs),
  onFirmwareReady: subscribe<FirmwareReadyPayload>(IPCChannels.FirmwareReady),
  onStatus: subscribe<StatusMessagePayload>(IPCChannels.Status),
  onProgress: subscribe<CopyProgressPayload>(IPCChannels.Progress),
  onResult: subscribe<CopyResultPayload>(IPCChannels.Result),
  onError: subscribe<StatusMessagePayload>(IPCChannels.Error),
  onLog: subscribe<LogEntry>(IPCChannels.LogEntry)
};

contextBridge.exposeInMainWorld('splitFlasher', api);

export type SplitFlasherApi = typeof api;
