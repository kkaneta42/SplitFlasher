import type { Slot, SlotStatus } from '../common/ipc';

export const SLOT_LABEL: Record<Slot, string> = {
  right: 'Right',
  left: 'Left'
};

export const STATUS_COLOR: Record<SlotStatus, string> = {
  idle: '#636b7b',
  ready: '#4ab1ff',
  waiting: '#f0ad4e',
  copying: '#40c463',
  success: '#57d785',
  error: '#ff6b6b'
};

export const STATUS_TEXT: Record<SlotStatus, string> = {
  idle: '待機中',
  ready: 'zip展開済み',
  waiting: 'デバイス待ち',
  copying: 'コピー中',
  success: '完了',
  error: 'エラー'
};

export const PRELOAD_ERROR_MESSAGE = 'preloadスクリプトが読み込めませんでした。アプリを再起動してください。';
