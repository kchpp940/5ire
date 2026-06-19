import { useEffect } from "react";
import { clear, suspend } from "suspend-react";
import { useStore } from "zustand";
import { createStateStreamStore, type StreamStore } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();

export const useLiveDocuments = (collectionId: string) => {
  const keys = [key, collectionId];
  const store = suspend(async () => {
    return createStateStreamStore({
      streamLoader: () => window.bridge.documentManager.liveDocuments(collectionId),
      onDone: () => {
        clear(keys);
      },
    }).then(({ instance }) => {
      return instance;
    });
  }, keys);

  useEffect(() => {
    const currentKeys = [key, collectionId];
    return () => {
      (store as StreamStore<unknown>).destroy?.().catch(() => {});
      clear(currentKeys);
    };
  }, [store, collectionId]);

  return useStore(store);
};
