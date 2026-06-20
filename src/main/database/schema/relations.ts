import { relations } from "drizzle-orm";
import {
  collection,
  conversation,
  document,
  documentChunk,
  project,
  prompt,
  promptDraft,
  promptVersion,
  server,
  turn,
} from "@/main/database/schema/tables";

/**
 * Defines the relationships between the `collection` table and other tables.
 */
export const collectionRelations = relations(collection, (helpers) => {
  return {
    /**
     * A knowledge collection can contain multiple documents.
     */
    documents: helpers.many(document),
    /**
     * Associates with the project it belongs to.
     */
    project: helpers.one(project, {
      references: [project.id],
      fields: [collection.projectId],
    }),
  };
});

/**
 * Defines the relationships between the `document` table and other tables.
 */
export const documentRelations = relations(document, (helpers) => {
  return {
    /**
     * Associates with the knowledge collection it belongs to.
     */
    collection: helpers.one(collection, {
      references: [collection.id],
      fields: [document.collectionId],
    }),
    /**
     * A document can contain multiple document chunks.
     */
    chunks: helpers.many(documentChunk),
  };
});

/**
 * Defines the relationships between the `documentChunk` table and other tables.
 */
export const documentChunkRelations = relations(documentChunk, (helpers) => {
  return {
    /**
     * Associates with the document it belongs to.
     */
    document: helpers.one(document, {
      references: [document.id],
      fields: [documentChunk.documentId],
    }),
  };
});

/**
 * Defines the relationships between the `conversation` table and other tables.
 */
export const conversationRelations = relations(conversation, (helpers) => {
  return {
    /**
     * Associates with the project it belongs to.
     */
    project: helpers.one(project, {
      references: [project.id],
      fields: [conversation.projectId],
    }),
    /**
     * A conversation can contain multiple turns.
     */
    turns: helpers.many(turn),
  };
});

/**
 * Defines the relationships between the `turn` table and other tables.
 */
export const turnRelations = relations(turn, (helpers) => {
  return {
    /**
     * Associates with the conversation it belongs to.
     */
    conversation: helpers.one(conversation, {
      references: [conversation.id],
      fields: [turn.conversationId],
    }),
  };
});

/**
 * Defines the relationships between the `project` table and other tables.
 */
export const projectRelations = relations(project, (helpers) => {
  return {
    /**
     * A project can contain multiple conversations.
     */
    conversations: helpers.many(conversation),
    /**
     * A project can contain multiple knowledge collections.
     */
    collections: helpers.many(collection),
    /**
     * A project can contain multiple MCP servers.
     */
    servers: helpers.many(server),
  };
});

/**
 * Defines the relationships between the `server` table and other tables.
 */
export const serverRelations = relations(server, (helpers) => {
  return {
    /**
     * Associates with the project it belongs to.
     */
    project: helpers.one(project, {
      references: [project.id],
      fields: [server.projectId],
    }),
  };
});

/**
 * Defines the relationships between the `prompt` table and other tables.
 */
export const promptRelations = relations(prompt, (helpers) => {
  return {
    /**
     * A prompt can have multiple versions.
     */
    versions: helpers.many(promptVersion),
    /**
     * A prompt can have one draft.
     */
    draft: helpers.one(promptDraft, {
      fields: [prompt.id],
      references: [promptDraft.promptId],
    }),
  };
});

/**
 * Defines the relationships between the `prompt_version` table and other tables.
 */
export const promptVersionRelations = relations(promptVersion, (helpers) => {
  return {
    /**
     * A version belongs to a prompt.
     */
    prompt: helpers.one(prompt, {
      fields: [promptVersion.promptId],
      references: [prompt.id],
    }),
  };
});

/**
 * Defines the relationships between the `prompt_draft` table and other tables.
 */
export const promptDraftRelations = relations(promptDraft, (helpers) => {
  return {
    /**
     * A draft belongs to a prompt.
     */
    prompt: helpers.one(prompt, {
      fields: [promptDraft.promptId],
      references: [prompt.id],
    }),
  };
});
