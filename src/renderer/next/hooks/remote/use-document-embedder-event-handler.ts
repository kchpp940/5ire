import { useEffect, useRef } from "react";
import type { Bridge } from "@/main/internal/bridge";
import type { Emitter } from "@/main/internal/emitter";
import type { DocumentEmbedder } from "@/main/services/document-embedder";

type EventHandler = (event: Emitter.WildcardEventChunk<DocumentEmbedder.Events>) => void;

export const useDocumentEmbedderEventHandler = (handler: EventHandler) => {
  const streamRef = useRef<Bridge.ReadableStreamProxy<Emitter.WildcardEventChunk<DocumentEmbedder.Events>> | null>(
    null,
  );
  const controller = useRef(new AbortController());
  const fn = useRef(handler);

  useEffect(() => {
    fn.current = handler;
  }, [handler]);

  useEffect(() => {
    const abortController = new AbortController();
    controller.current = abortController;

    let stream: Bridge.ReadableStreamProxy<Emitter.WildcardEventChunk<DocumentEmbedder.Events>> | null = null;
    let cancelled = false;

    window.bridge.documentEmbedder.createEventStream().then(async (s) => {
      if (cancelled) {
        s.stop().catch(() => {});
        return;
      }
      stream = s;
      streamRef.current = s;

      while (!abortController.signal.aborted) {
        try {
          const chunk = await stream.next();

          if (chunk.done) {
            break;
          }

          fn.current(chunk.value);
        } catch (_error) {
          if (abortController.signal.aborted) {
            break;
          }
          break;
        }
      }
    });

    return () => {
      cancelled = true;
      abortController.abort();
      if (stream) {
        stream.stop().catch(() => {});
        streamRef.current = null;
      }
    };
  }, []);
};
