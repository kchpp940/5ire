import { useStreamStore, useStreamStoreWithSelector } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();
const streamLoader = window.bridge.mcpConnectionsManager.prompt.createStateStream;

export const useServerPrompts = () => {
  return useStreamStore({
    streamLoader,
    key: [key],
    shared: false,
  });
};

export const useServerPromptsWithSelector = <T>(selector: (raw: ReturnType<typeof useServerPrompts>) => T) => {
  return useStreamStoreWithSelector(
    {
      streamLoader,
      key: [key],
      shared: false,
    },
    selector,
  );
};
