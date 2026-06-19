import { clear } from "suspend-react";
import { useStreamStore } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const cacheKey = [key];
const streamLoader = window.bridge.updater.createStateStream;

export const useUpdater = () => {
  return useStreamStore({
    streamLoader,
    key: cacheKey,
    shared: true,
    onDone: () => {
      clear(cacheKey);
    },
  });
};
