import { useStreamStore, useStreamStoreRef, useStreamStoreWithSelector } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.mcpConnectionsManager.createStateStream;

export const useServerConnections = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: false,
  });
};

export const useServerConnectionsWithSelector = <T>(selector: (raw: ReturnType<typeof useServerConnections>) => T) => {
  return useStreamStoreWithSelector(
    {
      streamLoader,
      key: [key],
      shared: false,
    },
    selector,
  );
};

export const useServerConnectionsRef = () => {
  return useStreamStoreRef({
    streamLoader,
    key: [key],
    shared: false,
  });
};
