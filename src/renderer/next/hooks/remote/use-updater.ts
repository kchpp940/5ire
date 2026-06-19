import { useStreamStore } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.updater.createStateStream;

export const useUpdater = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: true,
  });
};
