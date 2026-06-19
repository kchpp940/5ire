import { useEffect, useRef } from "react";
import type { Emitter } from "@/main/internal/emitter";
import type { DocumentEmbedder } from "@/main/services/document-embedder";

export type DocumentEmbedderEvent = Emitter.WildcardEventChunk<DocumentEmbedder.Events>;

export type DocumentEmbedderEventHandler = (event: DocumentEmbedderEvent) => void;

export const useDocumentEmbedderEventHandler = (handler: DocumentEmbedderEventHandler) => {
  const controller = useRef(new AbortController());
  const fn = useRef(handler);

  useEffect(() => {
    fn.current = handler;
  }, [handler]);

  useEffect(() => {
    let stream: Awaited<ReturnType<typeof window.bridge.documentEmbedder.createEventStream>> | undefined;
    let stopped = false;

    window.bridge.documentEmbedder.createEventStream().then(async (s) => {
      stream = s;
      while (!stopped) {
        const chunk = await stream.next();

        if (chunk.done) {
          break;
        }

        fn.current(chunk.value);
      }
    });

    return () => {
      stopped = true;
      controller.current.abort();
      stream?.stop().catch(() => {});
    };
  }, []);
};
