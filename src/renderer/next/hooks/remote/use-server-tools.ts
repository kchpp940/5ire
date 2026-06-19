import { useStreamStore, useStreamStoreWithSelector } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.mcpConnectionsManager.tool.createStateStream;

export const useServerTools = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: false,
  });
};

export const useServerToolsWithSelector = <T>(selector: (raw: ReturnType<typeof useServerTools>) => T) => {
  return useStreamStoreWithSelector(
    {
      streamLoader,
      key: [key],
      shared: false,
    },
    selector,
  );
};
