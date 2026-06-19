import { useStreamStore } from "@/renderer/next/hooks/remote/utils";

const key = crypto.randomUUID();

export const useLiveDocuments = (collectionId: string) => {
  return useStreamStore({
    streamLoader: () => window.bridge.documentManager.liveDocuments(collectionId),
    key: [key, collectionId],
    shared: false,
  });
};
