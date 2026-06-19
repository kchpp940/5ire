import { clear, preload } from "suspend-react";
import { useStreamStore } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const cacheKey = [key];
const streamLoader = window.bridge.settingsStore.createStateStream;

preload(async () => {
  const { createStateStreamStore } = await import("@/renderer/next/hooks/remote/utils");
  return createStateStreamStore({
    streamLoader,
    onDone: () => {
      clear(cacheKey);
    },
  }).then(({ instance }) => instance);
}, cacheKey);

export const useSettings = () => {
  return useStreamStore({
    streamLoader,
    key: cacheKey,
    shared: true,
  });
};
