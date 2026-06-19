import { useStreamStore, useStreamStoreWithSelector } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.mcpConnectionsManager.resource.createStateStream;

export const useServerResources = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: false,
  });
};

export const useServerResourcesWithSelector = <T>(selector: (raw: ReturnType<typeof useServerResources>) => T) => {
  return useStreamStoreWithSelector(
    {
      streamLoader,
      key: [key],
      shared: false,
    },
    selector,
  );
};
