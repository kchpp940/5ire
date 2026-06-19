import { createStore, type StoreApi } from "zustand/vanilla";
import type { Bridge } from "@/main/internal/bridge";

const activeStores = new Set<StreamStore<unknown>>();

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
  await Promise.allSettled(stores.map((store) => store.destroy()));
};

export const getActiveStreamStoreCount = () => {
  return activeStores.size;
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
