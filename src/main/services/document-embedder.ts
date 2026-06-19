import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { asError } from "catch-unknown";
import { asc, eq, inArray, not } from "drizzle-orm";
import { createReadStream, createWriteStream } from "fs-extra";
import { Database } from "@/main/database";
import { Container } from "@/main/internal/container";
import { Emitter } from "@/main/internal/emitter";
import { Mutex } from "@/main/internal/mutex";
import { Stateful } from "@/main/internal/stateful";
import { DocumentExtractor } from "@/main/services/document-extractor";
import { Embedder } from "@/main/services/embedder";
import { Logger } from "@/main/services/logger";

export class DocumentEmbedder extends Stateful<DocumentEmbedder.State> {
  #database = Container.inject(Database);
  #embedder = Container.inject(Embedder);
  #extractor = Container.inject(DocumentExtractor);
  #logger = Container.inject(Logger).scope("DocumentEmbedder");
  #emitter = Emitter.create<DocumentEmbedder.Events>();

  #workers = 1;
  #empty = false;
  #mutex = Mutex.create();

  get emitter() {
    return this.#emitter;
  }

  constructor() {
    super(() => {
      return {
        processingDocuments: {},
      };
    });
  }

  async #lock() {
    const client = this.#database.client;
    const schema = this.#database.schema;
    const logger = this.#logger.scope("Lock");

    await this.#mutex.acquire();

    return client
      .transaction(async (tx) => {
        return tx
          .select({
            id: schema.document.id,
            url: schema.document.url,
          })
          .from(schema.document)
          .where(eq(schema.document.status, "pending"))
          .orderBy(asc(schema.document.id))
          .limit(1)
          .then(async ([it]) => {
            if (!it) {
              return;
            }

            await Promise.all([
              tx
                .update(schema.document)
                .set({
                  status: "processing",
                })
                .where(eq(schema.document.id, it.id))
                .execute(),
              tx.delete(schema.documentChunk).where(eq(schema.documentChunk.documentId, it.id)).execute(),
            ]);

            return it;
          });
      })
      .catch((error) => {
        logger.error("Failed to lock document:", error);
      })
      .finally(() => {
        this.#mutex.release();
      });
  }

  async #cleanupTempFile(file?: string) {
    if (!file) {
      return;
    }

    const logger = this.#logger.scope("CleanupTempFile");

    await rm(file, { force: true }).catch((error) => {
      logger.error(`Failed to remove temp file ${file}:`, error);
    });
  }

  async #cancelProcessingInternal(id: string, reason: "deleted" | "cancelled" | "model-unavailable") {
    const logger = this.#logger.scope("CancelProcessing");
    const client = this.#database.client;
    const schema = this.#database.schema;

    let controller: AbortController | undefined;
    let tempFile: string | undefined;
    let url: string | undefined;

    this.update((draft) => {
      const it = draft.processingDocuments[id];
      if (it) {
        controller = it.controller;
        tempFile = it.tempFile;
        delete draft.processingDocuments[id];
      }
    });

    if (controller) {
      controller.abort();
    }

    await this.#cleanupTempFile(tempFile);

    if (reason === "deleted") {
      this.#emitter.emit("document-embed-deleted", { id });
      return;
    }

    await client
      .select({ url: schema.document.url })
      .from(schema.document)
      .where(eq(schema.document.id, id))
      .limit(1)
      .then(([doc]) => {
        url = doc?.url;
      })
      .catch(() => {});

    await client
      .update(schema.document)
      .set({
        status: reason === "model-unavailable" ? "pending" : "failed",
        error: reason === "model-unavailable" ? null : reason === "cancelled" ? "Processing cancelled" : null,
      })
      .where(eq(schema.document.id, id))
      .execute()
      .catch((error) => {
        logger.error(`Failed to update document ${id} status after cancel (${reason}):`, error);
      });

    if (reason === "cancelled") {
      this.#emitter.emit("document-embed-cancelled", { id, url: url || "" });
    } else if (reason === "model-unavailable") {
      this.#emitter.emit("document-embed-interrupted", { id, url: url || "" });
    }
  }

  async cancelDocumentProcessing(id: string) {
    return this.#cancelProcessingInternal(id, "cancelled");
  }

  async abortDocumentProcessingForDeletion(id: string) {
    return this.#cancelProcessingInternal(id, "deleted");
  }

  async #process(id: string, url: string) {
    const logger = this.#logger.scope("Process");
    const controller = new AbortController();

    const client = this.#database.client;
    const schema = this.#database.schema;

    let tempFile: string | undefined;

    this.update((draft) => {
      draft.processingDocuments[id] = {
        controller: controller,
        status: "extracting",
        progress: 0,
        tempFile: undefined,
      };
    });

    logger.info(`Processing document "${url}"`);

    const cleanup = async () => {
      await this.#cleanupTempFile(tempFile);
      this.update((draft) => {
        delete draft.processingDocuments[id];
      });
    };

    try {
      const { texts, mimetype, size } = await this.#extractor.extract(url, controller.signal);

      controller.signal.throwIfAborted();
      logger.info(`Extracted ${texts.length} text blocks in document "${url}"`);

      this.update((draft) => {
        if (draft.processingDocuments[id]) {
          draft.processingDocuments[id].status = "embedding";
          draft.processingDocuments[id].progress = 0;
        }
      });

      tempFile = join(tmpdir(), crypto.randomUUID());
      const stream = createWriteStream(tempFile);

      this.update((draft) => {
        if (draft.processingDocuments[id]) {
          draft.processingDocuments[id].tempFile = tempFile;
        }
      });

      let processed = 0;

      for (const text of texts) {
        controller.signal.throwIfAborted();

        await this.#embedder.embed([text]).then(([vector]) => {
          stream.write(`${JSON.stringify({ text, vector })}\n`);
        });

        processed += 1;

        this.update((draft) => {
          if (draft.processingDocuments[id]) {
            draft.processingDocuments[id].progress = processed / texts.length;
          }
        });

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      stream.end();

      await new Promise<void>((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      controller.signal.throwIfAborted();

      const result = {
        readline: createInterface({ input: createReadStream(tempFile), crlfDelay: Infinity }),
        length: texts.length,
        mimetype,
        size,
        file: tempFile,
      };

      controller.signal.throwIfAborted();

      this.update((draft) => {
        if (draft.processingDocuments[id]) {
          draft.processingDocuments[id].status = "saving";
          draft.processingDocuments[id].progress = 0;
        }
      });

      let inserted = 0;

      const batch: { text: string; vector: number[] }[] = [];
      const insert = async () => {
        const values = batch.map(({ text, vector }, index) => {
          return {
            documentId: id,
            text,
            embedding: vector,
            index: inserted + index,
          } as const;
        });

        if (values.length === 0) {
          return;
        }

        return client
          .insert(schema.documentChunk)
          .values(values)
          .execute()
          .then(() => {
            inserted += values.length;
            batch.length = 0;
            this.update((draft) => {
              if (draft.processingDocuments[id]) {
                draft.processingDocuments[id].progress = inserted / result.length;
              }
            });
          });
      };

      try {
        for await (const line of result.readline) {
          controller.signal.throwIfAborted();
          batch.push(JSON.parse(line));

          if (batch.length >= 10) {
            await insert();
          }

          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        await insert();
      } finally {
        result.readline.close();
      }

      await client
        .update(schema.document)
        .set({
          status: "completed",
          mimetype: result.mimetype,
          size: result.size,
        })
        .where(eq(schema.document.id, id))
        .execute();
    } catch (error) {
      if (controller.signal.aborted) {
        logger.info(`Document processing aborted: ${url}`);
        return;
      }

      logger.error("Failed to process document:", error);

      this.#emitter.emit("document-embed-failed", {
        id,
        url,
        message: asError(error).message,
      });

      await client
        .update(schema.document)
        .set({
          status: "failed",
          error: asError(error).message,
        })
        .where(eq(schema.document.id, id))
        .execute()
        .catch((e) => {
          logger.error("Failed to update document status after processing failure:", e);
        });
    } finally {
      await cleanup();
    }
  }

  #pull() {
    if (this.#embedder.state.status.type !== "ready") {
      return;
    }

    if (this.#empty) {
      return;
    }

    if (!this.#workers) {
      return;
    }

    while (this.#workers) {
      this.#workers--;

      this.#lock()
        .then((it) => {
          if (it) {
            return this.#process(it.id, it.url);
          }

          this.#empty = true;
        })
        .finally(() => {
          this.#workers++;
          this.#pull();
        });
    }
  }

  async init() {
    await this.#database.ready;

    const client = this.#database.client;
    const schema = this.#database.schema;
    const driver = this.#database.driver;

    await client
      .update(schema.document)
      .set({
        status: "pending",
      })
      .where(eq(schema.document.status, "processing"))
      .execute();

    const query = client
      .select({
        id: schema.document.id,
        status: schema.document.status,
      })
      .from(schema.document)
      .where(not(eq(schema.document.status, "completed")));
    const sql = query.toSQL();
    const abort = new AbortController();

    const live = await driver.live.changes<Awaited<ReturnType<(typeof query)["execute"]>>[number]>({
      query: sql.sql,
      params: sql.params,
      key: "id",
      signal: abort.signal,
    });

    live.subscribe((changes) => {
      for (const change of changes) {
        if (change.__op__ === "INSERT") {
          this.#empty = false;
          this.#pull();
        } else if (change.__op__ === "DELETE") {
          this.#cancelProcessingInternal(change.id, "deleted").catch((error) => {
            this.#logger.scope("LiveChanges").error(`Failed to cancel processing for deleted document ${change.id}:`, error);
          });
        }
      }
    });

    this.#embedder.subscribe((prev, next) => {
      if (prev.status.type === "ready" && next.status.type !== "ready") {
        const ids = Object.keys(this.state.processingDocuments);
        for (const id of ids) {
          this.#cancelProcessingInternal(id, "model-unavailable").catch((error) => {
            this.#logger.scope("EmbedderStatus").error(`Failed to cancel processing for document ${id} on model unavailable:`, error);
          });
        }
      }
      if (prev.status.type !== "ready" && next.status.type === "ready") {
        this.#empty = false;
        this.#pull();
      }
    });

    if (this.#embedder.state.status.type === "ready") {
      this.#pull();
    }
  }
}

export namespace DocumentEmbedder {
  export type Events = {
    "document-embed-failed": {
      id: string;
      url: string;
      message: string;
    };
    "document-embed-cancelled": {
      id: string;
      url: string;
    };
    "document-embed-deleted": {
      id: string;
    };
    "document-embed-interrupted": {
      id: string;
      url: string;
    };
  };

  export type State = {
    processingDocuments: Record<
      string,
      {
        controller: AbortController;
        status: "embedding" | "extracting" | "saving";
        progress: number;
        tempFile?: string;
      }
    >;
  };
}
