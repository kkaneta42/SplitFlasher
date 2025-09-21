interface SlotSectionProps {
  title: string;
  slots: Slot[];
  renderItem: (slot: Slot) => JSX.Element;
  fullWidth?: boolean;
}

function SlotSection({ title, slots, renderItem, fullWidth }: SlotSectionProps): JSX.Element {
  return (
    <section className={`card${fullWidth ? ' layout__full' : ''}`}>
      <h2 className="section-title">{title}</h2>
      <ul className="firmware-list" style={{ marginBottom: 0, paddingBottom: 0, listStyle: 'none' }}>
        {slots.map((slot) => (
          <li key={slot} style={{ padding: 0, background: 'none', borderRadius: 0 }}>
            {renderItem(slot)}
          </li>
        ))}
      </ul>
    </section>
  );
}
import type { DragEvent, JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CopyProgressPayload,
  CopyResultPayload,
  FirmwareFileInfo,
  FirmwareIngestRequest,
  FirmwareReadyPayload,
  Slot,
  SlotStatus,
  StatusLevel,
  StatusMessagePayload
} from '../common/ipc';

interface SlotViewState {
  slot: Slot;
  status: SlotStatus;
  bytesWritten: number;
  totalBytes: number;
  message?: string;
  volumePath?: string;
}

interface StatusState {
  level: StatusLevel;
  message: string;
}

const createInitialSlotState = (): Record<Slot, SlotViewState> => ({
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

const SLOT_LABEL: Record<Slot, string> = {
  right: '右側 (Right)',
  left: '左側 (Left)'
};

const STATUS_COLOR: Record<SlotStatus, string> = {
  idle: '#636b7b',
  ready: '#4ab1ff',
  waiting: '#f0ad4e',
  copying: '#40c463',
  success: '#57d785',
  error: '#ff6b6b'
};

const STATUS_TEXT: Record<SlotStatus, string> = {
  idle: '待機中',
  ready: 'zip展開済み',
  waiting: 'デバイス待ち',
  copying: 'コピー中',
  success: '完了',
  error: 'エラー'
};

const PRELOAD_ERROR_MESSAGE = 'preloadスクリプトが読み込めませんでした。アプリを再起動してください。';

const GLOBAL_STYLES = String.raw`
:root {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #f5f5f5;
  background-color: #1b1d22;
}

body,
html {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: linear-gradient(180deg, #1f232b 0%, #14161a 100%);
}

body {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

#root {
  width: 100%;
  max-width: 760px;
  padding: 32px 24px 48px;
  box-sizing: border-box;
}

a {
  color: inherit;
}

button {
  font-family: inherit;
}

.layout {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  grid-auto-flow: row dense;
}

.layout__full {
  grid-column: 1 / -1;
}

.dropzone {
  border: 2px dashed #3a3f4b;
  border-radius: 16px;
  padding: 28px 20px 24px;
  background-color: #21242b;
  transition: all 0.2s ease;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 18px;
  max-width: 420px;
  justify-self: start;
}

.dropzone.is-dragging {
  border-color: #4ab1ff;
  background-color: rgba(74, 177, 255, 0.1);
}

.card {
  background-color: #1f2733;
  border-radius: 12px;
  padding: 20px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.firmware-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.firmware-item {
  background: #252d3a;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.alert {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  text-align: left;
}

.alert--info {
  background: rgba(74, 177, 255, 0.12);
  border: 1px solid rgba(74, 177, 255, 0.4);
  color: #d1e9ff;
}

.alert--error {
  background: rgba(255, 107, 107, 0.12);
  border: 1px solid rgba(255, 107, 107, 0.4);
  color: #ffd1d1;
}

.alert--success {
  background: rgba(87, 215, 133, 0.12);
  border: 1px solid rgba(87, 215, 133, 0.4);
  color: #d9ffe7;
}

.alert--warning {
  background: rgba(240, 173, 78, 0.12);
  border: 1px solid rgba(240, 173, 78, 0.4);
  color: #ffe7c4;
}

.slot-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: 1fr;
}

@media (min-width: 640px) {
  .slot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.slot-card {
  background-color: #202733;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.slot-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}

.slot-card__progress-bar {
  width: 100%;
  height: 12px;
  border-radius: 999px;
  background-color: #2a3140;
  overflow: hidden;
}

.slot-card__progress {
  height: 100%;
  transition: width 0.2s ease;
}

/* Reused style classes for minimal, consistent UI */
.title {
  margin: 0 0 8px 0;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.5px;
  color: #f5f5f5;
}
.subtitle {
  margin: 0;
  font-size: 1.03rem;
  color: #b8c1d1;
  font-weight: 500;
}
.description {
  margin: 10px 0 0 0;
  color: #8a92a3;
  font-size: 13px;
  font-weight: 400;
}
.button {
  margin-top: 18px;
  padding: 10px 18px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  background-color: #3a3f4b;
  color: #f5f5f5;
  font-size: 1rem;
  font-weight: 500;
  transition: background 0.15s;
}
.button:hover {
  background-color: #4ab1ff;
  color: #fff;
}
.section-title {
  margin: 0 0 8px 0;
  font-size: 1.12rem;
  font-weight: 600;
  color: #e0e7f5;
  letter-spacing: -0.3px;
}
.info-text {
  color: #c0c7d4;
  font-size: 12px;
  margin: 0;
}
.progress-text {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #a1adbf;
}
.volume-text {
  margin: 0;
  color: #798397;
  font-size: 12px;
}
`;

const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

const formatPercent = (written: number, total: number): string => {
  if (!total) return '0%';
  return `${Math.min(100, (written / total) * 100).toFixed(1)}%`;
};

function App(): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const [slots, setSlots] = useState<Record<Slot, SlotViewState>>(createInitialSlotState);
  const [status, setStatus] = useState<StatusState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 履歴表示は不要なため state を保持しない
  const [firmwareInfo, setFirmwareInfo] = useState<Record<Slot, FirmwareFileInfo> | null>(null);

  const resetView = useCallback(() => {
    setSlots(createInitialSlotState());
    setStatus(null);
    setError(null);
    setFirmwareInfo(null);
  }, []);

  useEffect(() => {
    type Api = NonNullable<typeof window.splitFlasher>;
    let unsubscribers: Array<() => void> = [];
    let retryTimer: number | null = null;
    let failTimer: number | null = null;
    let initialized = false;

    const cleanupSubscriptions = (): void => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
    };

    const register = (api: Api): void => {
      cleanupSubscriptions();

      const unsubReady = api.onFirmwareReady((payload: FirmwareReadyPayload) => {
        setFirmwareInfo(payload.files);
        setSlots((prev) => ({
          right: {
            ...prev.right,
            status: 'ready',
            totalBytes: payload.files.right.size,
            message: '右側のファイル準備完了'
          },
          left: {
            ...prev.left,
            status: 'ready',
            totalBytes: payload.files.left.size,
            message: '左側のファイル準備完了'
          }
        }));
        setStatus({ level: 'info', message: 'ファームウェアを展開しました。右側デバイスを接続してください。' });
      });

      const unsubStatus = api.onStatus((payload: StatusMessagePayload) => {
        setStatus({ level: payload.level, message: payload.message });
        if (payload.slot) {
          const slot = payload.slot;
          setSlots((prev) => ({
            ...prev,
            [slot]: {
              ...prev[slot],
              message: payload.message,
              status: payload.nextStatus ?? prev[slot].status
            }
          }));
        }
      });

      const unsubProgress = api.onProgress((payload: CopyProgressPayload) => {
        setSlots((prev) => ({
          ...prev,
          [payload.slot]: {
            ...prev[payload.slot],
            status: 'copying',
            bytesWritten: payload.bytesWritten,
            totalBytes: payload.totalBytes,
            volumePath: payload.volumePath,
            message: `${SLOT_LABEL[payload.slot]} をコピー中`
          }
        }));
      });

      const unsubResult = api.onResult((payload: CopyResultPayload) => {
        setSlots((prev) => ({
          ...prev,
          [payload.slot]: {
            ...prev[payload.slot],
            status: payload.success ? 'success' : 'error',
            bytesWritten: payload.success ? prev[payload.slot].totalBytes : prev[payload.slot].bytesWritten,
            volumePath: payload.volumePath,
            message: payload.message
          }
        }));
      });

      const unsubError = api.onError((payload: StatusMessagePayload) => {
        setError(payload.message);
        setStatus({ level: 'error', message: payload.message });
      });

      unsubscribers = [unsubReady, unsubStatus, unsubProgress, unsubResult, unsubError];
      initialized = true;
      setError((current) => (current === PRELOAD_ERROR_MESSAGE ? null : current));
    };

    const tryInitialize = (): boolean => {
      const api = window.splitFlasher;
      if (!api) {
        return false;
      }
      register(api);
      return true;
    };

    if (!tryInitialize()) {
      retryTimer = window.setInterval(() => {
        if (tryInitialize()) {
          if (retryTimer !== null) {
            window.clearInterval(retryTimer);
            retryTimer = null;
          }
          if (failTimer !== null) {
            window.clearTimeout(failTimer);
            failTimer = null;
          }
        }
      }, 150);

      failTimer = window.setTimeout(() => {
        if (!initialized) {
          setError(PRELOAD_ERROR_MESSAGE);
          if (retryTimer !== null) {
            window.clearInterval(retryTimer);
            retryTimer = null;
          }
        }
      }, 2000);
    }

    return () => {
      cleanupSubscriptions();
      if (retryTimer !== null) {
        window.clearInterval(retryTimer);
      }
      if (failTimer !== null) {
        window.clearTimeout(failTimer);
      }
    };
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      setError(null);

      const file = event.dataTransfer.files?.[0];
      if (!file) {
        return;
      }

      const fileWithPath = file as File & { path?: string };
      let filePath = fileWithPath.path;
      if (!filePath) {
        const uriList = event.dataTransfer.getData('text/uri-list');
        if (uriList) {
          const firstUri = uriList
            .split(/\r?\n/)
            .map((value) => value.trim())
            .find((value) => value.length > 0 && !value.startsWith('#'));
          if (firstUri?.startsWith('file://')) {
            try {
              filePath = decodeURI(firstUri.replace('file://', ''));
            } catch (decodeError) {
              console.warn('[drop] URI decode failed:', decodeError);
            }
          }
        }
      }

      const extensionTarget = (filePath ?? file.name ?? '').toLowerCase();
      if (!extensionTarget.endsWith('.zip')) {
        setError('zipファイルを指定してください。');
        return;
      }

      const api = window.splitFlasher;
      if (!api) {
        setError(PRELOAD_ERROR_MESSAGE);
        return;
      }

      resetView();

      let ingestPayload: FirmwareIngestRequest;
      if (filePath) {
        ingestPayload = { kind: 'path', path: filePath };
      } else {
        try {
          const buffer = await file.arrayBuffer();
          ingestPayload = { kind: 'buffer', name: file.name ?? 'firmware.zip', data: new Uint8Array(buffer) };
        } catch (bufferError) {
          console.error('[drop] arrayBuffer failed:', bufferError);
          setError('ファイルの読み込みに失敗しました。');
          return;
        }
      }

      setStatus({ level: 'info', message: 'ファームウェアを解析中です…' });

      try {
        await api.ingestFirmware(ingestPayload);
      } catch (err: unknown) {
        console.error(err);
        setError('ファームウェアの取り込みに失敗しました。');
      }
    },
    [resetView]
  );

  const handleResetClick = useCallback(() => {
    window.splitFlasher
      ?.reset()
      .finally(() => {
        resetView();
      });
  }, [resetView]);

  const statusAlertClass = useMemo(() => {
    if (!status) {
      return null;
    }
    switch (status.level) {
      case 'success':
        return 'alert alert--success';
      case 'warning':
        return 'alert alert--warning';
      case 'error':
        return 'alert alert--error';
      default:
        return 'alert alert--info';
    }
  }, [status]);

  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      <main className="layout">
        <section
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          className={`dropzone${isDragging ? ' is-dragging' : ''}`}
        >
          <h1 className="title">SplitFlasher</h1>
          <p className="subtitle">ここに <code>firmware.zip</code> をドロップしてください。</p>
          <p className="description">
            zipを解析すると右／左用のUF2を自動で検出します。
          </p>
          <button
            type="button"
            onClick={handleResetClick}
            className="button"
          >
            リセット
          </button>
        </section>

        {firmwareInfo && (
          <SlotSection
            title="展開済みファイル"
            slots={['right', 'left']}
            renderItem={(slot) => (
              <div className="firmware-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{SLOT_LABEL[slot]}</span>
                  <span style={{ color: '#98a1b4' }}>{formatBytes(firmwareInfo[slot].size)}</span>
                </div>
                <span className="info-text">ファイル名: {firmwareInfo[slot].fileName}</span>
              </div>
            )}
          />
        )}

        {status && statusAlertClass && <div className={`${statusAlertClass} layout__full`}>{status.message}</div>}
        {error && <div className="alert alert--error layout__full">{error}</div>}

        <SlotSection
          title="コピー状況"
          slots={['right', 'left']}
          fullWidth
          renderItem={(slot) => {
            const slotState = slots[slot];
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
                {slotState.message && (
                  <p className="info-text" style={{ color: '#b8c1d1', fontSize: 13 }}>{slotState.message}</p>
                )}
                {slotState.volumePath && (
                  <p className="volume-text">接続先: {slotState.volumePath}</p>
                )}
              </div>
            );
          }}
        />
      </main>
    </>
  );
}

export default App;