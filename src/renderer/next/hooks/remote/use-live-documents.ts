import { useMemo } from "react";
import { useStreamStore } from "@/renderer/next/hooks/remote/utils";

const moduleKey = crypto.randomUUID();

export const useLiveDocuments = (collectionId: string) => {
  const cacheKey = useMemo(() => [moduleKey, collectionId], [collectionId]);
  return useStreamStore({
    streamLoader: () => window.bridge.documentManager.liveDocuments(collectionId),
    key: cacheKey,
    shared: false,
  });
};
