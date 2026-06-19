import { useEffect, useRef } from "react";
import { clear, suspend } from "suspend-react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Bridge } from "@/main/internal/bridge";

const activeStores = new Set<StreamStore<unknown>>();
const refCounts = new Map<string, number>();

export const registerStreamStore = <T>(store: StreamStore<T>) => {
  activeStores.add(store);
  return store;
};

export const unregisterStreamStore = <T>(store: StreamStore<T>) => {
  activeStores.delete(store);
};

export const destroyAllStreamStores = async () => {
  const stores = Array.from(activeStores);
  activeStores.clear();
  refCounts.clear();
  await Promise.allSettled(stores.map((store) => store.destroy()));
};

export const getActiveStreamStoreCount = () => {
  return activeStores.size;
};

const getKeyString = (key: readonly unknown[]) => {
  return key.map((k) => String(k)).join("|");
};

const retainStore = (key: readonly unknown[]) => {
  const keyStr = getKeyString(key);
  const count = refCounts.get(keyStr) ?? 0;
  refCounts.set(keyStr, count + 1);
  return count + 1;
};

const releaseStore = (key: readonly unknown[]) => {
  const keyStr = getKeyString(key);
  const count = refCounts.get(keyStr) ?? 0;
  if (count <= 1) {
    refCounts.delete(keyStr);
    return 0;
  }
  refCounts.set(keyStr, count - 1);
  return count - 1;
};

const _getRefCount = (key: readonly unknown[]) => {
  return refCounts.get(getKeyString(key)) ?? 0;
};

/**
 * Options for creating a stream store
 * @template T - The type of data in the stream
 */
export type StreamStoreOptions<T> = {
  /**
   * A function that returns a promise resolving to a readable stream proxy
   */
  streamLoader: () => Promise<Bridge.ReadableStreamProxy<T>>;
  /**
   * Optional callback function that is called when the stream is done
   */
  onDone?: () => void;
  /**
   * Optional callback function that is called when there is an error reading a chunk
   * @param error - The error that occurred while reading a chunk
   */
  onReadChunkError?: (error: unknown) => void;
  /**
   * Whether to register the store in the global registry for cleanup
   * @default true
   */
  autoRegister?: boolean;
};

export type StreamStore<T> = StoreApi<T> & {
  destroy: () => Promise<void>;
};

/**
 * Creates a state stream store from a stream loader
 *
 * @template T - The type of data in the stream
 * @param options - Configuration options for the stream store
 * @returns A promise that resolves to an object containing the store instance and stream
 *
 * @throws {Error} If the initial state from the stream is empty
 */
export const createStateStreamStore = async <T>(options: StreamStoreOptions<T>) => {
  const { autoRegister = true } = options;
  const stream = await options.streamLoader();
  const abortController = new AbortController();
  let destroyed = false;

  const initial = await stream.next();

  if (initial.done) {
    throw new Error("Initial state is empty");
  }

  const instance = createStore(() => {
    return initial.value;
  }) as StreamStore<T>;

  const setState = instance.setState.bind(instance);

  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;
    if (autoRegister) {
      unregisterStreamStore(instance);
    }
    abortController.abort();
    try {
      await stream.stop();
    } catch {
      // ignore stop errors
    }
    options.onDone?.();
  };

  instance.destroy = destroy;

  if (autoRegister) {
    registerStreamStore(instance);
  }

  Promise.resolve().then(async () => {
    while (!abortController.signal.aborted) {
      try {
        const chunk = await stream.next();

        if (chunk.done) {
          break;
        }

        setState(() => chunk.value, true);
      } catch (error) {
        if (abortController.signal.aborted) {
          break;
        }
        try {
          await stream.stop();
        } catch {
          // ignore stop errors
        }
        options.onReadChunkError?.(error);
        break;
      }
    }

    if (!destroyed) {
      destroyed = true;
      if (autoRegister) {
        unregisterStreamStore(instance);
      }
      options.onDone?.();
    }
  });

  return { instance, stream, destroy };
};

export type UseStreamStoreOptions<T> = {
  streamLoader: () => Promise<Bridge.ReadableStreamProxy<T>>;
  key: readonly unknown[];
  autoRegister?: boolean;
  shared?: boolean;
};

export const useStreamStore = <T>(options: UseStreamStoreOptions<T>) => {
  const { streamLoader, key, autoRegister, shared = false } = options;
  const store = suspend(async () => {
    return createStateStreamStore({
      streamLoader,
      autoRegister,
      onDone: () => {
        clear(key);
      },
    }).then(({ instance }) => instance);
  }, key) as StreamStore<T>;

  useEffect(() => {
    if (shared) {
      retainStore(key);
    }
    return () => {
      if (shared) {
        const remaining = releaseStore(key);
        if (remaining > 0) return;
      }
      store.destroy?.().catch(() => {});
      clear(key);
    };
  }, [store, ...key, shared, key]);

  return useStore(store);
};

export const useStreamStoreWithSelector = <T, S>(options: UseStreamStoreOptions<T>, selector: (state: T) => S) => {
  const { streamLoader, key, autoRegister, shared = false } = options;
  const store = suspend(async () => {
    return createStateStreamStore({
      streamLoader,
      autoRegister,
      onDone: () => {
        clear(key);
      },
    }).then(({ instance }) => instance);
  }, key) as StreamStore<T>;

  useEffect(() => {
    if (shared) {
      retainStore(key);
    }
    return () => {
      if (shared) {
        const remaining = releaseStore(key);
        if (remaining > 0) return;
      }
      store.destroy?.().catch(() => {});
      clear(key);
    };
  }, [store, ...key, shared, key]);

  return useStore(store, selector);
};

export const useStreamStoreRef = <T>(options: UseStreamStoreOptions<T>) => {
  const { streamLoader, key, autoRegister, shared = false } = options;
  const store = suspend(async () => {
    return createStateStreamStore({
      streamLoader,
      autoRegister,
      onDone: () => {
        clear(key);
      },
    }).then(({ instance }) => instance);
  }, key) as StreamStore<T>;

  const ref = useRef(store);
  ref.current = store;

  useEffect(() => {
    if (shared) {
      retainStore(key);
    }
    const currentStore = ref.current;
    return () => {
      if (shared) {
        const remaining = releaseStore(key);
        if (remaining > 0) return;
      }
      currentStore.destroy?.().catch(() => {});
      clear(key);
    };
  }, [shared, key]);

  return ref;
};
