import { clear, suspend } from "suspend-react";
import { useStore } from "zustand";
import { createStateStreamStore } from "@/renderer/next/hooks/remote/utils";
import type { DocumentManager } from "@/main/services/document-manager";

const key = crypto.randomUUID();

export type ImportJobDocument = {
  id: string;
  name: string;
  url: string;
  size: number;
  mimetype: string;
  status: DocumentManager.ImportJobDocumentStatus;
  stage: DocumentManager.ImportJobDocumentStage;
  progress: number;
  error: string | null;
};

export type ImportJob = {
  id: string;
  collectionId: string;
  collectionName: string;
  createTime: string;
  updateTime: string;
  status: DocumentManager.ImportJobStatus;
  documents: Record<string, ImportJobDocument>;
  pendingCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  progress: number;
};

export const useLiveImportJobs = () => {
  const store = suspend(async () => {
    const keys = [key];
    return createStateStreamStore<ImportJob[]>({
      streamLoader: () => window.bridge.documentManager.liveImportJobs() as unknown as Promise<any>,
      onDone: () => {
        clear(keys);
      },
    }).then(({ instance }) => {
      return instance;
    });
  }, [key]);

  return useStore(store) as ImportJob[];
};
