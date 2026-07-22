import '@testing-library/jest-dom'
import { vi } from 'vitest'
import "fake-indexeddb/auto"

// Mock Chrome Extension API Global Namespace
const mockStorage: Record<string, any> = {};

globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn((keys: string | string[], callback?: (res: any) => void) => {
        const result: Record<string, any> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, any>, callback?: () => void) => {
        Object.assign(mockStorage, items);
        if (callback) callback();
        return Promise.resolve();
      }),
      clear: vi.fn((callback?: () => void) => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        if (callback) callback();
        return Promise.resolve();
      }),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    lastError: undefined,
  },
  tabs: {
    query: vi.fn(),
    sendMessage: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
  sidePanel: {
    open: vi.fn(),
  },
} as any;
