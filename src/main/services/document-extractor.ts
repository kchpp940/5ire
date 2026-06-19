import { fileURLToPath } from "node:url";
import { fromBuffer } from "file-type";
import { readFile, stat } from "fs-extra";
import { PDFParse } from "pdf-parse";
import { CanvasFactory } from "pdf-parse/worker";
import {
  COMMON_BINARY_DOCUMENT_FILE_MIMETYPES,
  COMMON_TEXTUAL_FILE_MIMETYPES,
  MAX_DOCUMENT_SIZE,
} from "@/main/constants";
import { smartChunk } from "@/main/util";

export class DocumentExtractor {
  async #read(url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();

    const path = fileURLToPath(url);
    const stats = await stat(path).catch(() => {
      throw new Error(`Failed to load resource: ${url}`);
    });

    signal?.throwIfAborted();

    if (!stats.isFile()) {
      throw new Error(`Not a file: ${url}`);
    }

    if (stats.size > MAX_DOCUMENT_SIZE) {
      throw new Error(`File is too large: ${url}`);
    }

    const buffer = await readFile(path);

    signal?.throwIfAborted();

    let mimetype = await fromBuffer(buffer).then((info) => info?.mime as string | undefined);

    if (!mimetype) {
      const ext = path.split(".").pop()?.toLowerCase();

      if (ext) {
        if (ext in COMMON_TEXTUAL_FILE_MIMETYPES) {
          // @ts-expect-error
          mimetype = COMMON_TEXTUAL_FILE_MIMETYPES[ext];
        }

        if (ext in COMMON_BINARY_DOCUMENT_FILE_MIMETYPES) {
          // @ts-expect-error
          mimetype = COMMON_BINARY_DOCUMENT_FILE_MIMETYPES[ext];
        }
      }
    }

    if (!mimetype) {
      throw new Error(`Failed to detect file type: ${url}`);
    }

    if (
      ![
        ...Object.values(COMMON_TEXTUAL_FILE_MIMETYPES),
        ...Object.values(COMMON_BINARY_DOCUMENT_FILE_MIMETYPES),
      ].includes(mimetype)
    ) {
      throw new Error(`Unsupported file type: ${mimetype}`);
    }

    signal?.throwIfAborted();

    return {
      mimetype: mimetype,
      buffer,
    };
  }

  async #parse(buffer: Buffer, mimetype: string, signal?: AbortSignal) {
    signal?.throwIfAborted();

    if (mimetype === "application/pdf") {
      return import("pdf-parse").then(async (mod) => {
        signal?.throwIfAborted();
        console.log(PDFParse.setWorker());
        return new mod.PDFParse({ data: buffer, CanvasFactory }).getText().then(({ text }) => {
          signal?.throwIfAborted();
          return text;
        });
      });
    }

    if (Object.values(COMMON_BINARY_DOCUMENT_FILE_MIMETYPES).includes(mimetype)) {
      return import("officeparser").then(async (mod) => {
        signal?.throwIfAborted();
        return new Promise<string>((resolve, reject) => {
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          signal?.addEventListener("abort", onAbort, { once: true });

          mod.parseOffice(buffer, (text: string, error: unknown) => {
            signal?.removeEventListener("abort", onAbort);
            if (signal?.aborted) {
              return reject(new DOMException("Aborted", "AbortError"));
            }
            if (error) {
              return reject(error);
            }
            resolve(text);
          });
        });
      });
    }

    return buffer.toString("utf8");
  }

  async #split(text: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return smartChunk(text);
  }

  async extract(url: string, signal?: AbortSignal) {
    if (url.startsWith("file://")) {
      return this.#read(url, signal).then(async ({ buffer, mimetype }) => {
        return this.#parse(buffer, mimetype, signal)
          .then((text) => this.#split(text, signal))
          .then((texts) => {
            signal?.throwIfAborted();
            return {
              texts,
              mimetype,
              size: buffer.length,
            } satisfies DocumentExtractor.Result;
          });
      });
    }
    else {
      throw new Error(`Unsupported document URL: ${url}`);
    }
  }
}

export namespace DocumentExtractor {
  export type Result = {
    texts: string[];
    mimetype: string;
    size: number;
  };
}
