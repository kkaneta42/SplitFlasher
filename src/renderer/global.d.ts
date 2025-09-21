import type { SplitFlasherApi } from '../preload';

declare global {
  interface Window {
    splitFlasher?: SplitFlasherApi;
  }
}

export {};
