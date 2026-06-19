import { useStreamStore, useStreamStoreRef, useStreamStoreWithSelector } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.mcpServersManager.liveServers;

export const useServers = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: false,
  });
};

export const useServersWithSelector = <T>(selector: (raw: ReturnType<typeof useServers>) => T) => {
  return useStreamStoreWithSelector(
    {
      streamLoader,
      key: [key],
      shared: false,
    },
    selector,
  );
};

export const useServersRef = () => {
  return useStreamStoreRef({
    streamLoader,
    key: [key],
    shared: false,
  });
};
