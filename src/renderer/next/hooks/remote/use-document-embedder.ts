import { clear, preload, suspend } from "suspend-react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { Bridge } from "@/main/internal/bridge";
import type { DocumentEmbedder } from "@/main/services/document-embedder";
import type { DocumentEmbedderEvent } from "@/renderer/next/hooks/remote/use-document-embedder-event-handler";

const key = crypto.randomUUID();

type ProcessingDocument = {
  status: "embedding" | "extracting" | "saving";
  progress: number;
};

type DocumentEmbedderState = {
  processingDocuments: Record<string, ProcessingDocument>;
};

const createStoreWithEvents = async () => {
  const stateStream = await window.bridge.documentEmbedder.createStateStream();
  const initial = await stateStream.next();

  if (initial.done) {
    throw new Error("Initial state is empty");
  }

  const instance = createStore<DocumentEmbedderState>(() => {
    return initial.value as DocumentEmbedderState;
  });

  const setState = instance.setState.bind(instance);

  const processEvent = (event: DocumentEmbedderEvent) => {
    if (event.event === "document-embed-deleted" || event.event === "document-embed-cancelled") {
      const id = event.payload.id;
      setState((state) => {
        const next = { ...state };
        next.processingDocuments = { ...next.processingDocuments };
        delete next.processingDocuments[id];
        return next;
      }, true);
    } else if (event.event === "document-embed-interrupted") {
      const id = event.payload.id;
      setState((state) => {
        const next = { ...state };
        next.processingDocuments = { ...next.processingDocuments };
        delete next.processingDocuments[id];
        return next;
      }, true);
    }
  };

  Promise.resolve().then(async () => {
    let stopped = false;

    const eventStream = await window.bridge.documentEmbedder.createEventStream();

    Promise.resolve().then(async () => {
      while (!stopped) {
        try {
          const chunk = await stateStream.next();
          if (chunk.done) {
            break;
          }
          setState(() => chunk.value as DocumentEmbedderState, true);
        } catch (error) {
          await stateStream.stop().catch(() => {});
          break;
        }
      }
    });

    Promise.resolve().then(async () => {
      while (!stopped) {
        try {
          const chunk = await eventStream.next();
          if (chunk.done) {
            break;
          }
          processEvent(chunk.value as DocumentEmbedderEvent);
        } catch (error) {
          await eventStream.stop().catch(() => {});
          break;
        }
      }
    });

    return () => {
      stopped = true;
      stateStream.stop().catch(() => {});
      eventStream.stop().catch(() => {});
    };
  });

  return instance;
};

const createStore = async () => {
  return createStoreWithEvents().then((instance) => {
    return instance;
  });
};

preload(createStore, [key]);

export const useDocumentEmbedder = () => {
  return useStore(suspend(createStore, [key]));
};
