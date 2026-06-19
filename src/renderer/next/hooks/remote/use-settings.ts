import { preload } from "suspend-react";
import { useStreamStore } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.settingsStore.createStateStream;

preload(async () => {
  const { createStateStreamStore } = await import("@/renderer/next/hooks/remote/utils");
  return createStateStreamStore({
    streamLoader,
    onDone: () => {},
  }).then(({ instance }) => instance);
}, [key]);

export const useSettings = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: true,
  });
};
