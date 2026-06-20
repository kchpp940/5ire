import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { and, cosineDistance, eq, inArray, type SQL } from "drizzle-orm";
import { dialog } from "electron";
import { default as memoize } from "memoizee";
import {
  COMMON_BINARY_DOCUMENT_FILE_MIMETYPES,
  COMMON_TEXTUAL_FILE_MIMETYPES,
  MAX_DOCUMENT_SIZE,
  SUPPORTED_DOCUMENT_URL_SCHEMAS,
} from "@/main/constants";
import { Database } from "@/main/database";
import { Container } from "@/main/internal/container";
import { DocumentExtractor } from "@/main/services/document-extractor";
import { Embedder } from "@/main/services/embedder";
import { LegacyDataMigrator } from "@/main/services/legacy-data-migrator";
import { Logger } from "@/main/services/logger";

/**
 * DocumentManager class is used to manage document collections and documents
 * Provides functions to create, delete, update collections and import, delete documents
 */
export class DocumentManager {
  #database = Container.inject(Database);
  #logger = Container.inject(Logger).scope("DocumentsManager");
  #embedder = Container.inject(Embedder);
  #extractor = Container.inject(DocumentExtractor);
  #legacyDataMigrator = Container.inject(LegacyDataMigrator);

  /**
   * Constructor to initialize the DocumentManager instance
   *
   * This constructor sets up memoization for live query methods to improve performance
   * by caching the results of identical method calls.
   *
   * Configuration options:
   * - primitive: true enables primitive value comparison for cache keys
   * - promise: true handles Promise-returning functions properly
   * - normalizer: function to generate cache keys from method arguments
   */
  constructor() {
    this.liveCollections = memoize(this.liveCollections.bind(this), {
      primitive: true,
      promise: true,
    });
    this.liveDocuments = memoize(this.liveDocuments.bind(this), {
      primitive: true,
      promise: true,
      normalizer: (args) => args[0],
    });
  }

  /**
   * Create a new document collection
   * @param options Options for creating a collection, including name and description
   * @returns Promise<Collection> The created collection object
   */
  async createCollection(options: DocumentManager.CreateCollectionOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      return tx
        .insert(schema.collection)
        .values({
          name: options.name,
          description: options.description,
        })
        .returning()
        .execute()
        .then((result) => {
          return result[0];
        });
    });
  }

  /**
   * Delete the specified document collection
   * @param options Options containing the ID of the collection to delete
   * @returns Promise<void>
   * @throws Error when the collection does not exist
   */
  async deleteCollection(options: DocumentManager.DeleteCollectionOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      const exists = await tx
        .$count(schema.collection, eq(schema.collection.id, options.id))
        .then((count) => count > 0);

      if (!exists) {
        throw new Error("Collection does not exist.");
      }

      return tx.delete(schema.collection).where(eq(schema.collection.id, options.id)).execute();
    });
  }

  /**
   * Update the specified document collection
   * @param options Options containing the collection ID, new name and new description
   * @returns Promise<void>
   * @throws Error when the collection does not exist
   */
  async updateCollection(options: DocumentManager.UpdateCollectionOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      const exists = await tx
        .$count(schema.collection, eq(schema.collection.id, options.id))
        .then((count) => count > 0);

      if (!exists) {
        throw new Error("Collection does not exist.");
      }

      return tx
        .update(schema.collection)
        .set({
          name: options.name,
          description: options.description,
        })
        .where(eq(schema.collection.id, options.id))
        .execute();
    });
  }

  /**
   * Import documents into the specified collection
   * @param options Options containing the target collection ID and document URL list
   * @returns Promise<void>
   * @throws Error when the collection does not exist, URL is invalid, or document already exists
   */
  async importDocuments(options: DocumentManager.ImportDocumentsOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const urls = options.urls.map((url) => {
      try {
        return new URL(url);
      } catch (e) {
        throw new Error(`Invalid URL: ${url}`);
      }
    });

    if (urls.length === 0) {
      throw new Error("No URLs provided.");
    }

    if (urls.some((url) => !SUPPORTED_DOCUMENT_URL_SCHEMAS.includes(url.protocol.slice(0, -1)))) {
      throw new Error(
        `Unsupported document URL schema. Only ${SUPPORTED_DOCUMENT_URL_SCHEMAS.join(", ")} are supported.`,
      );
    }

    return client.transaction(async (tx) => {
      const exists = await tx
        .$count(schema.collection, eq(schema.collection.id, options.collection))
        .then((count) => count > 0);

      if (!exists) {
        throw new Error("Collection does not exist.");
      }

      const stringifiedUrlSet = new Set(urls.map((url) => url.toString()));
      const stringifiedUrls = Array.from(stringifiedUrlSet);

      for (const url of stringifiedUrls) {
        await tx
          .$count(
            schema.document,
            and(eq(schema.document.url, url), eq(schema.document.collectionId, options.collection)),
          )
          .then((count) => count > 0)
          .then((exists) => {
            if (exists) {
              throw new Error(`Document ${url} already exists.`);
            }
          });
      }

      return tx
        .insert(schema.document)
        .values(
          stringifiedUrls.map((url) => {
            let name = url;

            if (url.startsWith("file://")) {
              name = basename(fileURLToPath(url));
            }

            return {
              url,
              collectionId: options.collection,
              name,
              status: "pending" as const,
              mimetype: "unknown",
              error: null,
            };
          }),
        )
        .execute();
    });
  }

  /**
   * Select files from file system dialog
   * @returns Promise<string[] | undefined> Selected file URLs or undefined if canceled
   */
  async selectFilesFromFileSystem() {
    const extensions = [
      ...Object.keys(COMMON_TEXTUAL_FILE_MIMETYPES),
      ...Object.keys(COMMON_BINARY_DOCUMENT_FILE_MIMETYPES),
    ];

    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Documents",
          extensions,
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return;
    }

    return result.filePaths.map((path) =>
      pathToFileURL(path, { windows: process.platform === "win32" }).toString(),
    );
  }

  async importDocumentsFromFileSystem(options: DocumentManager.ImportDocumentsFromFileSystemOptions) {
    const urls = await this.selectFilesFromFileSystem();

    if (!urls || urls.length === 0) {
      return;
    }

    return this.importDocuments({
      collection: options.collection,
      urls,
    });
  }

  /**
   * Delete the specified document
   * @param options Options containing the ID of the document to delete
   * @returns Promise<void>
   * @throws Error when the document does not exist
   */
  async deleteDocument(options: DocumentManager.DeleteDocumentOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      const exists = await tx.$count(schema.document, eq(schema.document.id, options.id)).then((count) => count > 0);

      if (!exists) {
        throw new Error("Document does not exist.");
      }

      return tx.delete(schema.document).where(eq(schema.document.id, options.id)).execute();
    });
  }

  /**
   * Toggle the pin status of a collection
   * @param options Options containing the collection ID to toggle pin status
   * @returns Promise<void>
   * @throws Error when the collection does not exist
   */
  async toggleCollectionPin(options: DocumentManager.ToggleCollectionPinOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      // Check if collection exists
      const collection = await tx
        .select({
          id: schema.collection.id,
          pinedTime: schema.collection.pinedTime,
        })
        .from(schema.collection)
        .where(eq(schema.collection.id, options.id))
        .execute()
        .then((result) => {
          if (result.length === 0) {
            return null;
          }
          return result[0];
        });

      if (!collection) {
        throw new Error("Collection does not exist.");
      }

      // Toggle pin status - if pinedTime is set, clear it; otherwise set it to current time
      const newPinedTime = collection.pinedTime ? null : new Date();

      return tx
        .update(schema.collection)
        .set({
          pinedTime: newPinedTime,
        })
        .where(eq(schema.collection.id, options.id))
        .execute();
    });
  }

  /**
   * Listen to collection changes in real-time
   * Returns an object with subscribe method, refresh function and initial results
   * that continuously pushes updates of collections and their document counts
   * @returns Object containing:
   * - subscribe: Function to add a subscriber that receives updates
   * - refresh: Function to manually refresh the data
   * - initialResults: Initial set of collection data with document counts
   */
  async liveCollections() {
    const schema = this.#database.schema;
    const client = this.#database.client;
    const driver = this.#database.driver;

    const query = client
      .select({
        ...Database.utils.aliasedColumns({
          id: schema.collection.id,
          name: schema.collection.name,
          description: schema.collection.description,
          createTime: schema.collection.createTime,
          updateTime: schema.collection.updateTime,
          pinedTime: schema.collection.pinedTime,
          legacyId: schema.collection.legacyId,
        }),
        ...{
          documents: client
            .$count(schema.document, eq(schema.document.collectionId, schema.collection.id))
            .as("documents"),
        },
      })
      .from(schema.collection)
      .orderBy(schema.collection.pinedTime, schema.collection.createTime);

    const sql = query.toSQL();
    const subscribers = new Set<(results: typeof live.initialResults) => void>();

    const live = await driver.live.query<Awaited<ReturnType<(typeof query)["execute"]>>[number]>({
      query: sql.sql,
      params: sql.params,
      callback: (results) => {
        for (const subscriber of subscribers) {
          subscriber(results);
        }
      },
    });

    return {
      subscribe: (subscriber: (results: typeof live.initialResults) => void) => {
        subscribers.add(subscriber);
        return () => {
          subscribers.delete(subscriber);
        };
      },
      refresh: live.refresh,
      initialResults: live.initialResults,
    };
  }

  /**
   * Listen to document changes in real-time for a specific collection
   * Returns an object with subscribe method, refresh function and initial results
   * that continuously pushes updates of documents in the collection
   * @param collection Collection ID to listen to
   * @returns Object containing:
   * - subscribe: Function to add a subscriber that receives updates
   * - refresh: Function to manually refresh the data
   * - initialResults: Initial set of document data
   */
  async liveDocuments(collection: string) {
    const schema = this.#database.schema;
    const client = this.#database.client;
    const driver = this.#database.driver;

    const query = client
      .select({
        ...Database.utils.aliasedColumns({
          id: schema.document.id,
          name: schema.document.name,
          url: schema.document.url,
          status: schema.document.status,
          error: schema.document.error,
          createTime: schema.document.createTime,
          updateTime: schema.document.updateTime,
          size: schema.document.size,
        }),
        ...{
          chunks: client
            .$count(schema.documentChunk, eq(schema.documentChunk.documentId, schema.document.id))
            .as("chunks"),
        },
      })
      .from(schema.document)
      .where(eq(schema.document.collectionId, collection));

    const sql = query.toSQL();
    const subscribers = new Set<(results: typeof live.initialResults) => void>();

    const live = await driver.live.query<Awaited<ReturnType<(typeof query)["execute"]>>[number]>({
      query: sql.sql,
      params: sql.params,
      callback: (results) => {
        for (const subscriber of subscribers) {
          subscriber(results);
        }
      },
    });

    return {
      subscribe: (subscriber: (results: typeof live.initialResults) => void) => {
        subscribers.add(subscriber);
        return () => {
          subscribers.delete(subscriber);
        };
      },
      refresh: live.refresh,
      initialResults: live.initialResults,
    };
  }

  /**
   * Associate a collection with a target entity
   * @param options Options containing the collection ID, target entity ID and association type
   * @returns Promise<void>
   * @throws Error when the collection does not exist
   */
  async associateCollection(options: DocumentManager.AssociateCollectionOptions) {
    const schema = this.#database.schema;
    const client = this.#database.client;

    return client.transaction(async (tx) => {
      // Check if collection exists
      const exists = await tx
        .select({
          id: schema.collection.id,
        })
        .from(schema.collection)
        .where(eq(schema.collection.id, options.id))
        .execute()
        .then((result) => {
          return result.length > 0;
        });

      if (!exists) {
        throw new Error("Collection does not exist.");
      }

      if (options.type === "conversation") {
        return this.#legacyDataMigrator.updateTransitional((draft) => {
          const chatCollections = draft.chatCollections || new Map<string, string[]>();
          const collections = chatCollections.get(options.target) || [];

          collections.push(options.id);
          chatCollections.set(options.target, [...new Set(collections)]);

          draft.chatCollections = new Map(chatCollections);
        });
        // return tx
        //   .insert(schema.conversationCollection)
        //   .values({
        //     collectionId: options.id,
        //     conversationId: options.target,
        //   })
        //   .onConflictDoNothing()
        //   .execute();
      }
    });
  }

  /**
   * Disassociate a collection from a target entity
   * @param options Options containing the collection ID, target entity ID and association type
   * @returns Promise<void>
   */
  async disassociateCollection(options: DocumentManager.DisassociateCollectionOptions) {
    // const schema = this.#database.schema;
    // const client = this.#database.client;

    if (options.type === "conversation") {
      return this.#legacyDataMigrator.updateTransitional((draft) => {
        const chatCollections = draft.chatCollections || new Map<string, string[]>();
        const collections = chatCollections.get(options.target) || [];

        collections.push(options.id);
        chatCollections.set(
          options.target,
          collections.filter((collection) => collection !== options.id),
        );

        draft.chatCollections = new Map(chatCollections);
      });
      // return client
      //   .delete(schema.conversationCollection)
      //   .where(
      //     and(
      //       eq(schema.conversationCollection.collectionId, options.id),
      //       eq(schema.conversationCollection.conversationId, options.target),
      //     ),
      //   )
      //   .execute();
    }
  }

  /**
   * List collections associated with a target entity
   * @param options Options containing the target entity ID and association type
   * @returns Promise<Array> List of associated collections with their document counts
   */
  async listAssociatedCollections(options: DocumentManager.ListAssociatedCollectionsOptions) {
    const schema = this.#database.schema;
    const client = this.#database.client;

    const select = {
      id: schema.collection.id,
      name: schema.collection.name,
      description: schema.collection.description,
      createTime: schema.collection.createTime,
      updateTime: schema.collection.updateTime,
      pinedTime: schema.collection.pinedTime,
      documents: client.$count(schema.document, eq(schema.document.collectionId, schema.collection.id)).as("documents"),
      legacyId: schema.collection.legacyId,
    };

    if (options.type === "conversation") {
      const ids = this.#legacyDataMigrator.state.transitional.chatCollections?.get(options.target) || [];

      return client.select(select).from(schema.collection).where(inArray(schema.collection.id, ids)).execute();
    }

    return [];
  }

  /**
   * Update the target entity of associated collections
   * @param options Options containing the old target entity ID, new target entity ID and association type
   * @returns Promise<void>
   */
  async updateAssociatedCollectionsTarget(options: DocumentManager.UpdateAssociatedCollectionsTargetOptions) {
    if (options.type === "conversation") {
      return this.#legacyDataMigrator.updateTransitional((draft) => {
        const chatCollections = draft.chatCollections || new Map<string, string[]>();
        const collections = chatCollections.get(options.oldTarget) || [];

        chatCollections.set(options.newTarget, collections);
        chatCollections.delete(options.oldTarget);

        draft.chatCollections = new Map(chatCollections);
      });
    }
  }

  /**
   * Pre-check files before importing
   * Validates file types, sizes, checks for duplicates, and estimates chunk counts
   * @param options Options containing collection ID and file URLs
   * @returns Promise<DocumentManager.PreCheckResult> Pre-check results
   */
  async preCheckImport(options: DocumentManager.PreCheckImportOptions) {
    const logger = this.#logger.scope("PreCheckImport");
    const client = this.#database.client;
    const schema = this.#database.schema;

    logger.info(`Pre-checking ${options.urls.length} files for collection "${options.collection}"`);

    const results: DocumentManager.FilePreCheckResult[] = [];
    let totalEstimatedChunks = 0;
    let validCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;

    const embedderReady = this.#embedder.state.status.type === "ready";

    for (const url of options.urls) {
      const result: DocumentManager.FilePreCheckResult = {
        url,
        name: url,
        status: "valid",
        size: 0,
        mimetype: "unknown",
        estimatedChunks: 0,
        error: null,
      };

      try {
        const parsedUrl = new URL(url);

        if (!SUPPORTED_DOCUMENT_URL_SCHEMAS.includes(parsedUrl.protocol.slice(0, -1))) {
          result.status = "error";
          result.error = `Unsupported URL schema: ${parsedUrl.protocol}`;
          errorCount++;
          results.push(result);
          continue;
        }

        if (url.startsWith("file://")) {
          const path = fileURLToPath(url);
          result.name = basename(path);

          const stats = await stat(path).catch(() => null);
          if (!stats) {
            result.status = "error";
            result.error = "File not found";
            errorCount++;
            results.push(result);
            continue;
          }

          if (!stats.isFile()) {
            result.status = "error";
            result.error = "Not a file";
            errorCount++;
            results.push(result);
            continue;
          }

          result.size = stats.size;

          if (stats.size > MAX_DOCUMENT_SIZE) {
            result.status = "error";
            result.error = `File too large (max ${MAX_DOCUMENT_SIZE / (1024 * 1024)} MB)`;
            errorCount++;
            results.push(result);
            continue;
          }

          const ext = path.split(".").pop()?.toLowerCase();
          if (ext) {
            if (ext in COMMON_TEXTUAL_FILE_MIMETYPES) {
              result.mimetype = COMMON_TEXTUAL_FILE_MIMETYPES[ext as keyof typeof COMMON_TEXTUAL_FILE_MIMETYPES];
            } else if (ext in COMMON_BINARY_DOCUMENT_FILE_MIMETYPES) {
              result.mimetype =
                COMMON_BINARY_DOCUMENT_FILE_MIMETYPES[ext as keyof typeof COMMON_BINARY_DOCUMENT_FILE_MIMETYPES];
            } else {
              result.status = "error";
              result.error = "Unsupported file type";
              errorCount++;
              results.push(result);
              continue;
            }
          }

          const estimatedChunks = Math.max(1, Math.ceil(stats.size / 1500));
          result.estimatedChunks = estimatedChunks;
          totalEstimatedChunks += estimatedChunks;
        }

        const exists = await client
          .$count(
            schema.document,
            and(eq(schema.document.url, url), eq(schema.document.collectionId, options.collection)),
          )
          .then((count) => count > 0);

        if (exists) {
          result.status = "duplicate";
          duplicateCount++;
        } else {
          validCount++;
        }
      } catch (e) {
        result.status = "error";
        result.error = e instanceof Error ? e.message : "Unknown error";
        errorCount++;
      }

      results.push(result);
    }

    return {
      files: results,
      totalFiles: results.length,
      validCount,
      duplicateCount,
      errorCount,
      totalEstimatedChunks,
      embedderReady,
    } satisfies DocumentManager.PreCheckResult;
  }

  /**
   * Retry a failed document by resetting its status to pending
   * @param options Options containing the document ID
   * @returns Promise<void>
   */
  async retryDocument(options: DocumentManager.RetryDocumentOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;
    const logger = this.#logger.scope("RetryDocument");

    logger.info(`Retrying document "${options.id}"`);

    return client.transaction(async (tx) => {
      const exists = await tx
        .$count(schema.document, eq(schema.document.id, options.id))
        .then((count) => count > 0);

      if (!exists) {
        throw new Error("Document does not exist.");
      }

      await tx
        .update(schema.document)
        .set({
          status: "pending",
          error: null,
        })
        .where(eq(schema.document.id, options.id))
        .execute();
    });
  }

  /**
   * Move a document to a different collection
   * @param options Options containing document ID and target collection ID
   * @returns Promise<void>
   */
  async moveDocumentToCollection(options: DocumentManager.MoveDocumentToCollectionOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;
    const logger = this.#logger.scope("MoveDocumentToCollection");

    logger.info(`Moving document "${options.documentId}" to collection "${options.collectionId}"`);

    return client.transaction(async (tx) => {
      const document = await tx
        .select({
          id: schema.document.id,
          url: schema.document.url,
        })
        .from(schema.document)
        .where(eq(schema.document.id, options.documentId))
        .then((result) => result[0]);

      if (!document) {
        throw new Error("Document does not exist.");
      }

      const targetCollection = await tx
        .$count(schema.collection, eq(schema.collection.id, options.collectionId))
        .then((count) => count > 0);

      if (!targetCollection) {
        throw new Error("Target collection does not exist.");
      }

      const duplicate = await tx
        .$count(
          schema.document,
          and(
            eq(schema.document.url, document.url),
            eq(schema.document.collectionId, options.collectionId),
          ),
        )
        .then((count) => count > 0);

      if (duplicate) {
        throw new Error("Document already exists in target collection.");
      }

      await tx
        .update(schema.document)
        .set({
          collectionId: options.collectionId,
          status: "pending",
          error: null,
        })
        .where(eq(schema.document.id, options.documentId))
        .execute();
    });
  }

  /**
   * Import documents with pre-checked results
   * Only imports valid (non-duplicate, non-error) files
   * @param options Options containing collection ID and pre-check results
   * @returns Promise<void>
   */
  async importDocumentsWithPreCheck(options: DocumentManager.ImportDocumentsWithPreCheckOptions) {
    const validUrls = options.files.filter((f) => f.status === "valid").map((f) => f.url);

    if (validUrls.length === 0) {
      throw new Error("No valid files to import.");
    }

    return this.importDocuments({
      collection: options.collection,
      urls: validUrls,
    });
  }

  /**
   * Query document chunks based on given options
   *
   * This method uses embedding vector technology to search for document chunks based on semantic similarity.
   * It supports filtering the search scope by document IDs or collection IDs, and can limit the number of returned results.
   *
   * @param options Query options
   * @returns An array containing matching document chunks, each element includes chunk ID, text content, URL, document name, and distance information
   */
  async queryChunks(options: DocumentManager.QueryChunksOptions) {
    const logger = this.#logger.scope("QueryChunks");

    const schema = this.#database.schema;
    const client = this.#database.client;

    const vector = await this.#embedder.embed([options.text]).then(([vector]) => vector);

    const documents = [...new Set(options.documents || [])];
    const collections = [...new Set(options.collections || [])];

    let limit = options.limit || 10;

    if (limit < 1 || limit > 100) {
      limit = 10;
    }

    logger.info(
      `Querying chunks with text: "${options.text}", documents: ${documents.length}, collections: ${collections.length}, limit: ${limit}`,
    );

    if (collections.length) {
      await client
        .select({ id: schema.document.id })
        .from(schema.document)
        .where(and(inArray(schema.document.collectionId, collections), eq(schema.document.status, "completed")))
        .then((result) => {
          documents.push(...result.map((document) => document.id));
        });
    }

    if (!documents.length) {
      return [];
    }

    logger.info(`Querying against ${documents.length} documents after flattening`);

    const results = await client
      .select({
        id: schema.documentChunk.id,
        text: schema.documentChunk.text,
        url: schema.document.url,
        name: schema.document.name,
        distance: cosineDistance(schema.documentChunk.embedding, vector) as SQL<number>,
      })
      .from(schema.documentChunk)
      .innerJoin(schema.document, eq(schema.documentChunk.documentId, schema.document.id))
      .where(inArray(schema.documentChunk.documentId, documents))
      .orderBy(cosineDistance(schema.documentChunk.embedding, vector))
      .limit(limit);

    logger.info(`Retrieved ${results.length} chunks from database`);

    return results;
  }
}

export namespace DocumentManager {
  /**
   * Create collection options
   * Defines parameters required for creating a new collection
   */
  export type CreateCollectionOptions = {
    /**
     * Collection name
     */
    name: string;
    /**
     * Collection description
     */
    description: string;
  };

  /**
   * Toggle collection pin options
   * Defines parameters required for toggling collection pin status
   */
  export type ToggleCollectionPinOptions = {
    /**
     * Collection ID
     */
    id: string;
  };

  /**
   * Update collection options
   * Defines parameters required for updating a collection
   */
  export type UpdateCollectionOptions = {
    /**
     * Collection ID
     */
    id: string;
    /**
     * New collection name
     */
    name: string;
    /**
     * New collection description
     */
    description: string;
  };

  /**
   * Delete collection options
   * Defines parameters required for deleting a collection
   */
  export type DeleteCollectionOptions = {
    /**
     * ID of the collection to delete
     */
    id: string;
  };

  /**
   * Import documents options
   * Defines parameters required for importing documents
   */
  export type ImportDocumentsOptions = {
    /**
     * Target collection ID
     */
    collection: string;
    /**
     * Document URL list
     */
    urls: string[];
  };

  /**
   * Import documents from file system options
   */
  export type ImportDocumentsFromFileSystemOptions = {
    /**
     * Target collection ID
     */
    collection: string;
  };

  /**
   * Delete document options
   * Defines parameters required for deleting a document
   */
  export type DeleteDocumentOptions = {
    /**
     * ID of the document to delete
     */
    id: string;
  };

  /**
   * Associate collection options
   * Defines parameters required for associating a collection with a target entity
   */
  export type AssociateCollectionOptions = {
    /**
     * Collection ID
     */
    id: string;
    /**
     * Target entity ID
     */
    target: string;
    /**
     * Association type
     */
    type: "conversation";
  };

  /**
   * Disassociate collection options
   * Defines parameters required for disassociating a collection from a target entity
   */
  export type DisassociateCollectionOptions = {
    /**
     * Collection ID
     */
    id: string;
    /**
     * Target entity ID
     */
    target: string;
    /**
     * Association type
     */
    type: "conversation";
  };

  export type ListAssociatedCollectionsOptions = {
    /**
     * Target entity ID
     */
    target: string;
    /**
     * Association type
     */
    type: "conversation";
  };

  export type UpdateAssociatedCollectionsTargetOptions = {
    /**
     * Association type
     */
    type: "conversation";
    /**
     * New target entity ID
     */
    newTarget: string;
    /**
     * Old target entity ID
     */
    oldTarget: string;
  };

  export type QueryChunksOptions = {
    /**
     * Specifies the maximum number of results to return, default is 10, minimum is 1, maximum is 100
     */
    limit?: number;
    /**
     * Specifies which documents to query from
     */
    documents?: string[];
    /**
     * Specifies which collections to query from
     */
    collections?: string[];
    /**
     * The text to search for
     */
    text: string;
  };

  /**
   * Pre-check import options
   */
  export type PreCheckImportOptions = {
    /**
     * Target collection ID
     */
    collection: string;
    /**
     * Document URL list to pre-check
     */
    urls: string[];
  };

  /**
   * File pre-check status
   */
  export type FilePreCheckStatus = "valid" | "duplicate" | "error";

  /**
   * Single file pre-check result
   */
  export type FilePreCheckResult = {
    /**
     * File URL
     */
    url: string;
    /**
     * File name
     */
    name: string;
    /**
     * Pre-check status
     */
    status: FilePreCheckStatus;
    /**
     * File size in bytes
     */
    size: number;
    /**
     * MIME type
     */
    mimetype: string;
    /**
     * Estimated number of chunks
     */
    estimatedChunks: number;
    /**
     * Error message (only present when status is "error")
     */
    error: string | null;
  };

  /**
   * Pre-check result summary
   */
  export type PreCheckResult = {
    /**
     * List of all file pre-check results
     */
    files: FilePreCheckResult[];
    /**
     * Total number of files
     */
    totalFiles: number;
    /**
     * Number of valid files
     */
    validCount: number;
    /**
     * Number of duplicate files
     */
    duplicateCount: number;
    /**
     * Number of files with errors
     */
    errorCount: number;
    /**
     * Total estimated chunks
     */
    totalEstimatedChunks: number;
    /**
     * Whether the embedder is ready
     */
    embedderReady: boolean;
  };

  /**
   * Retry document options
   */
  export type RetryDocumentOptions = {
    /**
     * Document ID
     */
    id: string;
  };

  /**
   * Move document to collection options
   */
  export type MoveDocumentToCollectionOptions = {
    /**
     * Document ID
     */
    documentId: string;
    /**
     * Target collection ID
     */
    collectionId: string;
  };

  /**
   * Import documents with pre-check results options
   */
  export type ImportDocumentsWithPreCheckOptions = {
    /**
     * Target collection ID
     */
    collection: string;
    /**
     * Pre-checked file results
     */
    files: FilePreCheckResult[];
  };
}
