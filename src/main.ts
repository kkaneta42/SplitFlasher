import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import AdmZip from 'adm-zip';
import {
  CopyResultPayload,
  FirmwareFileInfo,
  FirmwareReadyPayload,
  FirmwareIngestRequest,
  HistoryEntry,
  IPCChannels,
  LogEntry,
  LogLevel,
  Slot,
  SlotStatus,
  StatusLevel
} from './common/ipc';

const execFileAsync = promisify(execFile);

const VOLUMES_ROOT = '/Volumes';
// macOS で UF2 ブートローダーがマウントするラベルを許可リストで判定。
// 例: 標準は "NO NAME"、BLE Micro Pro は "BLEMICROPRO"。
const TARGET_VOLUME_NAMES = new Set(['NO NAME', 'BLEMICROPRO']);
const SLOT_LABEL_MAP: Record<Slot, string> = {
  right: '右側',
  left: '左側'
};

const REMOUNT_IGNORE_DURATION_MS = 10000;
const COPY_MAX_ATTEMPTS = 3;
const COPY_RETRY_DELAY_MS = 400;

const LOG_BUFFER_MAX = 200;

const RETRYABLE_COPY_ERROR_CODES = new Set(['EACCES', 'EBUSY', 'EPERM', 'EIO']);

const getSlotLabel = (slot: Slot): string => SLOT_LABEL_MAP[slot];

interface FirmwareState {
  tempDir: string;
  files: Record<Slot, FirmwareFileInfo>;
}

let mainWindow: BrowserWindow | null = null;
let firmwareState: FirmwareState | null = null;
let activeCopy: { slot: Slot; volumePath: string } | null = null;
let slotQueue: Slot[] = [];
let history: HistoryEntry[] = [];
let logFilePath: string | null = null;
const pendingVolumePaths: string[] = [];
const knownVolumes = new Set<string>();
let volumeWatcher: FSWatcher | null = null;
const volumeDeviceIds = new Map<string, string | null>();
const logBuffer: LogEntry[] = [];
type IgnoredEntry = { slot: Slot; expiresAt: number; timeout: NodeJS.Timeout };
const ignoredDeviceIds = new Map<string, IgnoredEntry>();
const ignoredVolumePaths = new Map<string, IgnoredEntry>();

const clearIgnoredMap = (map: Map<string, IgnoredEntry>): void => {
  for (const info of map.values()) {
    clearTimeout(info.timeout);
  }
  map.clear();
};

const clearIgnoredEntries = (): void => {
  clearIgnoredMap(ignoredDeviceIds);
  clearIgnoredMap(ignoredVolumePaths);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isNodeError = (value: unknown): value is NodeJS.ErrnoException => {
  return value instanceof Error && 'code' in value;
};

const isRetryableCopyError = (error: unknown): boolean => {
  if (!isNodeError(error)) {
    return false;
  }
  return !!error.code && RETRYABLE_COPY_ERROR_CODES.has(error.code);
};

const appendLog = async (entry: LogEntry): Promise<void> => {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift();
  }

  if (logFilePath) {
    const line = `[${new Date(entry.timestamp).toISOString()}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
    await fsPromises.appendFile(logFilePath, line).catch((error) => {
      console.warn('[log] ファイル書き込みに失敗:', error);
    });
  }

  if (mainWindow) {
    mainWindow.webContents.send(IPCChannels.LogEntry, entry);
  }
};

const log = (level: LogLevel, message: string): void => {
  void appendLog({ level, message, timestamp: Date.now() });
};

const getCopyErrorMessage = (error: unknown, slot: Slot, volumePath: string): string => {
  if (isNodeError(error) && error.code) {
    switch (error.code) {
      case 'EACCES':
        return `${getSlotLabel(slot)} のボリュームに書き込めませんでした（権限エラー）。FinderでUF2を手動コピーできるか確認し、macOSの「プライバシーとセキュリティ」設定でアプリにリムーバブルボリュームへのアクセスを許可してください。対象: ${volumePath}`;
      case 'EBUSY':
        return `${getSlotLabel(slot)} のボリュームが使用中のため書き込めませんでした。数秒待ってからデバイスを差し直してください。対象: ${volumePath}`;
      case 'EIO':
        return `${getSlotLabel(slot)} への書き込み中にI/Oエラーが発生しました。USBケーブルの接続を確認し、再度お試しください。対象: ${volumePath}`;
      case 'EPERM':
        return `${getSlotLabel(slot)} のボリュームに対する操作が拒否されました。macOSのセキュリティ設定とデバイスの再接続を確認してください。対象: ${volumePath}`;
      default:
        break;
    }
  }
  return error instanceof Error ? error.message : 'コピー中に不明なエラーが発生しました。';
};

const setIgnoredEntry = (map: Map<string, IgnoredEntry>, key: string, slot: Slot): void => {
  const existing = map.get(key);
  if (existing) {
    clearTimeout(existing.timeout);
  }
  const expiresAt = Date.now() + REMOUNT_IGNORE_DURATION_MS;
  const timeout = setTimeout(() => {
    map.delete(key);
  }, REMOUNT_IGNORE_DURATION_MS);
  map.set(key, { slot, expiresAt, timeout });
};

const getIgnoredEntry = (map: Map<string, IgnoredEntry>, key: string): IgnoredEntry | undefined => {
  const info = map.get(key);
  if (!info) {
    return undefined;
  }
  if (Date.now() > info.expiresAt) {
    clearTimeout(info.timeout);
    map.delete(key);
    return undefined;
  }
  return info;
};

const markAsRecentlyFlashed = (volumePath: string, slot: Slot, deviceId: string | null): void => {
  if (deviceId) {
    setIgnoredEntry(ignoredDeviceIds, deviceId, slot);
  } else {
    setIgnoredEntry(ignoredVolumePaths, volumePath, slot);
  }
};

const scanExistingVolumes = async (): Promise<void> => {
  try {
    const entries = await fsPromises.readdir(VOLUMES_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const volumePath = path.join(VOLUMES_ROOT, entry.name);
      if (isTargetVolume(volumePath)) {
        void processVolumeAdded(volumePath);
      }
    }
  } catch (error) {
    console.warn('[watcher] 既存ボリュームのスキャンに失敗:', error);
  }
};

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 760,
    minWidth: 720,
    height: 720,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(__dirname, 'renderer', 'index.html');
    await mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const isTargetVolume = (volumePath: string): boolean => {
  return TARGET_VOLUME_NAMES.has(path.basename(volumePath)) && path.dirname(volumePath) === VOLUMES_ROOT;
};

const getVolumeLabel = (volumePath: string): string => path.basename(volumePath);

const sendStatus = (level: StatusLevel, message: string, slot?: Slot, nextStatus?: SlotStatus): void => {
  mainWindow?.webContents.send(IPCChannels.Status, { level, message, slot, nextStatus });
  log(level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info', message);
};

const sendError = (message: string, slot?: Slot): void => {
  mainWindow?.webContents.send(IPCChannels.Error, {
    level: 'error',
    message,
    slot
  });
  log('error', message);
};

const sendFirmwareReady = (payload: FirmwareReadyPayload): void => {
  mainWindow?.webContents.send(IPCChannels.FirmwareReady, payload);
};

const sendProgress = (slot: Slot, bytesWritten: number, totalBytes: number, volumePath: string): void => {
  mainWindow?.webContents.send(IPCChannels.Progress, {
    slot,
    bytesWritten,
    totalBytes,
    volumePath
  });
};

const sendResult = (result: CopyResultPayload): void => {
  history = [result, ...history];
  mainWindow?.webContents.send(IPCChannels.Result, result);
  log(result.success ? 'info' : 'error', result.message ?? `${getSlotLabel(result.slot)} の結果を記録しました。`);
};

const getDeviceIdentifier = async (volumePath: string): Promise<string | null> => {
  try {
    const { stdout } = await execFileAsync('diskutil', ['info', volumePath]);
    const match = stdout.match(/Device Identifier:\s+(\S+)/);
    if (match) {
      return match[1];
    }
  } catch (error) {
    console.warn('[diskutil] 取得に失敗:', error);
  }
  return null;
};

const processVolumeAdded = async (volumePath: string): Promise<void> => {
  if (!isTargetVolume(volumePath)) {
    return;
  }

  log('info', `デバイス検出: ${volumePath}`);

  let deviceId = volumeDeviceIds.get(volumePath) ?? null;
  if (!deviceId) {
    deviceId = await getDeviceIdentifier(volumePath);
    volumeDeviceIds.set(volumePath, deviceId);
  }

  const ignoredDevice = deviceId ? getIgnoredEntry(ignoredDeviceIds, deviceId) : undefined;
  const ignoredPath = deviceId ? undefined : getIgnoredEntry(ignoredVolumePaths, volumePath);
  const ignoredInfo = ignoredDevice ?? ignoredPath;

  if (ignoredInfo) {
    knownVolumes.add(volumePath);
    const nextSlot = slotQueue[0];
    if (nextSlot) {
      sendStatus(
        'info',
        `${getSlotLabel(ignoredInfo.slot)} デバイスが自動で再マウントされました。${getSlotLabel(nextSlot)} を接続してください。`,
        nextSlot,
        'waiting'
      );
    }
    return;
  }

  if (knownVolumes.has(volumePath)) {
    return;
  }

  knownVolumes.add(volumePath);

  if (!firmwareState || slotQueue.length === 0) {
    if (!pendingVolumePaths.includes(volumePath)) {
      pendingVolumePaths.push(volumePath);
    }
    sendStatus('warning', 'ファームウェアが準備されていません。zipをドロップしてください。');
    return;
  }

  enqueueVolume(volumePath);
};

const handleVolumeAdded = (volumePath: string): void => {
  void processVolumeAdded(volumePath);
};

const ensureVolumeWatcher = async (): Promise<void> => {
  if (volumeWatcher) return;

  volumeWatcher = chokidar.watch(VOLUMES_ROOT, {
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  });

  volumeWatcher.on('addDir', handleVolumeAdded);
  volumeWatcher.on('unlinkDir', handleVolumeRemoved);
  volumeWatcher.on('error', (error: unknown) => {
    console.error('[watcher] エラー:', error);
    sendError('ボリューム監視でエラーが発生しました。詳細はコンソールを確認してください。');
  });

  await scanExistingVolumes();
  log('info', 'ボリューム監視を開始しました。');
};

const handleVolumeRemoved = (volumePath: string): void => {
  knownVolumes.delete(volumePath);
  const index = pendingVolumePaths.indexOf(volumePath);
  if (index >= 0) {
    pendingVolumePaths.splice(index, 1);
  }
  volumeDeviceIds.delete(volumePath);
};

const enqueueVolume = (volumePath: string): void => {
  if (activeCopy) {
    if (!pendingVolumePaths.includes(volumePath)) {
      pendingVolumePaths.push(volumePath);
      const nextSlot = slotQueue[0];
      if (nextSlot) {
        sendStatus('info', `${getSlotLabel(nextSlot)} デバイスを検出しました。コピー完了後に開始します。`, nextSlot, 'waiting');
      } else {
        sendStatus('info', 'コピー中です。完了次第次のデバイスを処理します。');
      }
    }
    return;
  }

  const nextSlot = slotQueue.shift();
  if (!nextSlot) {
    if (!pendingVolumePaths.includes(volumePath)) {
      pendingVolumePaths.push(volumePath);
    }
    return;
  }

  void copyFirmwareToVolume(nextSlot, volumePath).catch((error) => {
    console.error('[copy] エラー:', error);
    sendError(error instanceof Error ? error.message : 'コピー処理で不明なエラーが発生しました。', nextSlot);
  });
};

const getPendingVolume = (): string | undefined => {
  let iterations = pendingVolumePaths.length;
  while (iterations > 0) {
    iterations -= 1;
    const volumePath = pendingVolumePaths.shift();
    if (!volumePath) continue;
    if (!knownVolumes.has(volumePath)) {
      continue;
    }
    const deviceId = volumeDeviceIds.get(volumePath) ?? null;
    const ignoredDevice = deviceId ? getIgnoredEntry(ignoredDeviceIds, deviceId) : undefined;
    const ignoredPath = deviceId ? undefined : getIgnoredEntry(ignoredVolumePaths, volumePath);
    if (ignoredDevice || ignoredPath) {
      pendingVolumePaths.push(volumePath);
      continue;
    }
    return volumePath;
  }
  return undefined;
};

interface Uf2Candidate {
  absolutePath: string;
  name: string;
}

const collectUf2Files = async (root: string): Promise<Uf2Candidate[]> => {
  const stack: string[] = [root];
  const uf2Files: Uf2Candidate[] = [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fsPromises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.uf2') {
        uf2Files.push({ absolutePath: fullPath, name: entry.name });
      }
    }
  }
  return uf2Files;
};


const prepareFirmwareFromPath = async (zipPath: string): Promise<FirmwareState> => {
  if (firmwareState) {
    await cleanupFirmwareState();
  }

  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'splitflasher-'));
  const extractedDir = path.join(tempDir, 'extracted');
  await fsPromises.mkdir(extractedDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractedDir, true);

  const uf2Files = await collectUf2Files(extractedDir);

  if (uf2Files.length === 0) {
    throw new Error('zip内にUF2ファイルが見つかりませんでした。');
  }

  const SLOT_PATTERNS: Record<Slot, RegExp[]> = {
    right: [/(^|[^a-z])right([^a-z]|$)/i],
    left: [/(^|[^a-z])left([^a-z]|$)/i]
  };

  const available = [...uf2Files];
  const takeCandidate = (slot: Slot): Uf2Candidate | undefined => {
    const patterns = SLOT_PATTERNS[slot];
    const index = available.findIndex((file) => patterns.some((pattern) => pattern.test(file.name)));
    if (index === -1) {
      return undefined;
    }
    const [candidate] = available.splice(index, 1);
    return candidate;
  };

  const rightCandidate = takeCandidate('right');
  const leftCandidate = takeCandidate('left');

  if (!rightCandidate || !leftCandidate) {
    const detected = uf2Files.map((file) => file.name).join(', ');
    throw new Error(
      `zip内に右/左を特定できるUF2が見つかりませんでした。検出したファイル: ${detected || 'なし'}`
    );
  }

  const [rightStat, leftStat] = await Promise.all([
    fsPromises.stat(rightCandidate.absolutePath),
    fsPromises.stat(leftCandidate.absolutePath)
  ]);

  const files: Record<Slot, FirmwareFileInfo> = {
    right: {
      slot: 'right',
      path: rightCandidate.absolutePath,
      size: rightStat.size,
      fileName: rightCandidate.name
    },
    left: {
      slot: 'left',
      path: leftCandidate.absolutePath,
      size: leftStat.size,
      fileName: leftCandidate.name
    }
  };

  if (available.length > 0) {
    sendStatus(
      'warning',
      `UF2が追加で${available.length}件見つかりました（未使用）: ${available.map((f) => f.name).join(', ')}`
    );
  }

  firmwareState = { tempDir, files };
  return firmwareState;
};

const cleanupFirmwareState = async (): Promise<void> => {
  if (!firmwareState) {
    return;
  }
  try {
    await fsPromises.rm(firmwareState.tempDir, { recursive: true, force: true });
  } catch (error) {
    console.warn('[cleanup] 一時ディレクトリの削除に失敗:', error);
  }
  firmwareState = null;
  slotQueue = [];
  activeCopy = null;
  clearIgnoredEntries();
  history = [];
};

const copyFirmwareToVolume = async (slot: Slot, volumePath: string): Promise<void> => {
  if (!firmwareState) {
    sendError('ファームウェアが準備されていません。', slot);
    return;
  }

  const firmwareFile = firmwareState.files[slot];
  if (!firmwareFile) {
    sendError(`${slot} 用のファイルが見つかりません。`, slot);
    return;
  }

  activeCopy = { slot, volumePath };
  sendStatus('info', `${getVolumeLabel(volumePath)} (${getSlotLabel(slot)}) にコピーを開始します。`, slot, 'copying');

  const destination = path.join(volumePath, firmwareFile.fileName);
  const totalBytes = firmwareFile.size;
  let bytesWritten = 0;
  let deviceId = volumeDeviceIds.get(volumePath) ?? null;
  if (!deviceId) {
    deviceId = await getDeviceIdentifier(volumePath);
    volumeDeviceIds.set(volumePath, deviceId);
  }
  const performCopyAttempt = async (): Promise<void> => {
    await fsPromises.rm(destination, { force: true }).catch(() => {});
    await new Promise<void>((resolve, reject) => {
      const attemptReadStream = fs.createReadStream(firmwareFile.path);
      const attemptWriteStream = fs.createWriteStream(destination);

      const handleData = (chunk: Buffer | string): void => {
        bytesWritten += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        sendProgress(slot, bytesWritten, totalBytes, volumePath);
      };

      attemptReadStream.on('data', handleData);

      const finalize = (): void => {
        attemptReadStream.off('data', handleData);
      };

      pipeline(attemptReadStream, attemptWriteStream)
        .then(() => {
          finalize();
          resolve();
        })
        .catch((error: unknown) => {
          finalize();
          reject(error);
        });
    });
  };

  const copyWithRetry = async (): Promise<void> => {
    for (let attempt = 1; attempt <= COPY_MAX_ATTEMPTS; attempt += 1) {
      bytesWritten = 0;
      if (attempt > 1) {
        sendProgress(slot, bytesWritten, totalBytes, volumePath);
      }

      try {
        await performCopyAttempt();
        return;
      } catch (error) {
        console.warn(`[copy] attempt ${attempt} failed:`, error);
        if (attempt >= COPY_MAX_ATTEMPTS || !isRetryableCopyError(error)) {
          throw error;
        }
        await fsPromises.rm(destination, { force: true }).catch(() => {});
        await sleep(COPY_RETRY_DELAY_MS);
      }
    }
  };

  try {
    await copyWithRetry();
    bytesWritten = totalBytes;
    sendProgress(slot, bytesWritten, totalBytes, volumePath);
    markAsRecentlyFlashed(volumePath, slot, deviceId ?? null);
    const result: CopyResultPayload = {
      slot,
      success: true,
      volumePath,
      message: `${getSlotLabel(slot)} の書き込みが完了しました。`,
      finishedAt: Date.now()
    };
    sendResult(result);
    sendStatus('success', `${getSlotLabel(slot)} のコピーが完了しました。`, slot, 'success');
  } catch (error) {
    const errorMessage = getCopyErrorMessage(error, slot, volumePath);
    const result: CopyResultPayload = {
      slot,
      success: false,
      volumePath,
      message: errorMessage,
      finishedAt: Date.now()
    };
    sendResult(result);
    sendStatus('error', `${getSlotLabel(slot)} のコピーに失敗しました。`, slot, 'error');
    await cleanupFirmwareState();
    throw error;
  } finally {
    activeCopy = null;
  }

  const nextSlot = slotQueue[0];
  if (nextSlot) {
    sendStatus('info', `${getSlotLabel(nextSlot)} 用に次のデバイスを接続してください。`, nextSlot, 'waiting');
  } else {
    sendStatus('success', '両方のデバイスへのコピーが完了しました。');
    await cleanupFirmwareState();
  }

  const nextVolume = getPendingVolume();
  if (nextSlot && nextVolume) {
    slotQueue.shift();
    void copyFirmwareToVolume(nextSlot, nextVolume).catch((error) => {
      console.error('[copy] エラー:', error);
      sendError(error instanceof Error ? error.message : 'コピー処理で不明なエラーが発生しました。', nextSlot);
    });
  }
};

const handleIngestFirmware = async (
  _event: Electron.IpcMainInvokeEvent,
  request: FirmwareIngestRequest | string
): Promise<void> => {
  let tempZipPath: string | null = null;
  try {
    log('info', 'ファームウェアの取り込みを開始');
    let resolvedZipPath: string;

    if (typeof request === 'string' || (typeof request === 'object' && 'path' in request && request.kind === 'path')) {
      const pathRequest = typeof request === 'string' ? { path: request } : request;
      const candidatePath = pathRequest.path;
      if (!candidatePath || path.extname(candidatePath).toLowerCase() !== '.zip') {
        throw new Error('zipファイルを指定してください。');
      }
      await fsPromises.access(candidatePath, fs.constants.R_OK);
      resolvedZipPath = candidatePath;
    } else if (typeof request === 'object' && request?.kind === 'buffer') {
      const extension = path.extname(request.name || '').toLowerCase();
      if (extension !== '.zip') {
        throw new Error('zipファイルを指定してください。');
      }
      const buffer = Buffer.from(request.data);
      const tempName = request.name && request.name.trim().length > 0 ? request.name : 'firmware.zip';
      const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'splitflasher-upload-'));
      tempZipPath = path.join(tempDir, tempName);
      await fsPromises.writeFile(tempZipPath, buffer);
      resolvedZipPath = tempZipPath;
    } else {
      throw new Error('ファイルの受け渡しに失敗しました。');
    }

    const state = await prepareFirmwareFromPath(resolvedZipPath);
    slotQueue = ['right', 'left'];
    history = [];
    const pendingSnapshot = pendingVolumePaths.filter((volumePath) => knownVolumes.has(volumePath));
    pendingVolumePaths.length = 0;

    const payload: FirmwareReadyPayload = {
      files: state.files,
      tempDir: state.tempDir
    };
    sendFirmwareReady(payload);

    await ensureVolumeWatcher();
    sendStatus('info', '右側のデバイスを接続してください。', 'right', 'waiting');

    for (const volumePath of pendingSnapshot) {
      enqueueVolume(volumePath);
    }
  } catch (error) {
    console.error('[ingest] エラー:', error);
    sendError(error instanceof Error ? error.message : 'ファームウェアの読み込みに失敗しました。');
    throw error;
  } finally {
    if (tempZipPath) {
      const tempUploadDir = path.dirname(tempZipPath);
      try {
        await fsPromises.rm(tempUploadDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('[ingest] 一時アップロードディレクトリの削除に失敗:', cleanupError);
      }
    }
  }
};

const handleReset = async (): Promise<void> => {
  pendingVolumePaths.length = 0;
  slotQueue = [];
  activeCopy = null;
  await cleanupFirmwareState();
  sendStatus('info', '状態をリセットしました。再度zipをドロップしてください。');
  log('info', '状態をリセット');
};

const registerHandlers = (): void => {
  ipcMain.handle(IPCChannels.IngestFirmware, handleIngestFirmware);
  ipcMain.handle(IPCChannels.Reset, handleReset);
  ipcMain.handle(IPCChannels.GetLogs, () => ({ entries: logBuffer, filePath: logFilePath ?? '' }));
};

app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData');
  await fsPromises.mkdir(userDataDir, { recursive: true }).catch(() => {});
  logFilePath = path.join(userDataDir, 'splitflasher.log');
  log('info', `ログファイル: ${logFilePath}`);

  registerHandlers();
  await ensureVolumeWatcher();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await cleanupFirmwareState();
    await volumeWatcher?.close();
    app.quit();
  }
});

app.on('will-quit', async () => {
  await cleanupFirmwareState();
  await volumeWatcher?.close();
});
