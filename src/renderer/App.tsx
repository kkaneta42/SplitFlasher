import type { DragEvent, JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CopyProgressPayload,
  CopyResultPayload,
  FirmwareIngestRequest,
  FirmwareReadyPayload,
  LogEntry,
  Slot,
  StatusMessagePayload
} from '../common/ipc';
import SlotCard from './components/SlotCard';
import { SLOT_LABEL, PRELOAD_ERROR_MESSAGE } from './constants';
import type { SlotViewState } from './state';
import { createInitialSlotState } from './state';
import { GLOBAL_STYLES } from './styles';

function App(): JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const [slots, setSlots] = useState<Record<Slot, SlotViewState>>(createInitialSlotState);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

  const resetView = useCallback(() => {
    setSlots(createInitialSlotState());
    setError(null);
  }, []);

  const pushLog = useCallback((entry: LogEntry) => {
    setLogs((prev) => {
      const next = [...prev, entry];
      if (next.length > 200) {
        next.shift();
      }
      return next;
    });
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
      });

      const unsubStatus = api.onStatus((payload: StatusMessagePayload) => {
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
      });

      const unsubLog = api.onLog((entry: LogEntry) => {
        pushLog(entry);
      });

      api
        .getLogs()
        .then(({ entries, filePath }) => {
          setLogs(entries);
          setLogFilePath(filePath);
        })
        .catch(() => {
          setLogs([]);
        });

      unsubscribers = [unsubReady, unsubStatus, unsubProgress, unsubResult, unsubError, unsubLog];
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
      }, 1000);

      failTimer = window.setTimeout(() => {
        if (!initialized) {
          pushLog({ level: 'error', message: PRELOAD_ERROR_MESSAGE, timestamp: Date.now() });
        }
      }, 5000);
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

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) {
        setError('ファイルが見つかりませんでした。');
        return;
      }

      const file = files[0];
      const filePath = file.path;

      if (!file && !filePath) {
        setError('ファイルをドロップできませんでした。');
        return;
      }

      const extensionTarget = (filePath ?? file.name ?? '').toLowerCase();
      if (!extensionTarget.endsWith('.zip')) {
        setError('zipファイルを指定してください。');
        return;
      }

      const api = window.splitFlasher;
      if (!api) {
        pushLog({ level: 'error', message: PRELOAD_ERROR_MESSAGE, timestamp: Date.now() });
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

      pushLog({ level: 'info', message: 'ファームウェアを解析中です…', timestamp: Date.now() });

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

  const formatLogTime = useCallback((value: number) => {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, []);

  const visibleError = error && error !== PRELOAD_ERROR_MESSAGE;

  useEffect(() => {
    const el = logPanelRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      <main className="layout">
        <div className="slot-grid layout__full">
          {(['left', 'right'] as Slot[]).map((slot) => (
            <div key={slot} className="card">
              <SlotCard slot={slot} slotState={slots[slot]} />
            </div>
          ))}
        </div>

        {visibleError && <div className="alert alert--error layout__full">{error}</div>}

        <section
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          className={`dropzone layout__full${isDragging ? ' is-dragging' : ''}`}
        >
          <div className="dropzone__inner">
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
          </div>
        </section>

        <section className="card card--log layout__full">
          <div className="log-panel" ref={logPanelRef}>
            {logs.length === 0 ? (
              <p className="info-text" style={{ margin: 0 }}>まだログはありません。</p>
            ) : (
              logs.map((entry, index) => (
                <div
                  key={`${entry.timestamp}-${index}`}
                  className={`log-row log-row--${entry.level}`}
                >
                  <span className="log-time">{formatLogTime(entry.timestamp)}</span>
                  <span className="log-level">{entry.level.toUpperCase()}</span>
                  <span className="log-message">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </>
  );
}

export default App;
