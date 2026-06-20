import { desc, eq } from "drizzle-orm";
import { Database } from "@/main/database";
import type {
  PromptInsert,
  PromptVersionInsert,
  PromptDraftInsert,
} from "@/main/database/types";
import { Container } from "@/main/internal/container";
import { Logger } from "@/main/services/logger";
import type {
  IPromptVariableSchema,
  IPromptVersion,
  IPromptDraft,
  IPromptDef,
} from "@/intellichat/types";

function parseVariables(text: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const variables: string[] = [];
  let m = regex.exec(text);
  while (m) {
    const variable = m[1].trim();
    if (variable !== "" && !variables.includes(variable)) {
      variables.push(variable);
    }
    m = regex.exec(text);
  }
  return variables;
}

function fillVariables(
  text: string,
  variables: { [key: string]: string },
): string {
  let result = text;
  Object.keys(variables).forEach((key) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, variables[key]);
  });
  return result;
}

function buildVariableSchemas(
  variableNames: string[],
  existingSchemas?: IPromptVariableSchema[],
): IPromptVariableSchema[] {
  const schemaMap = new Map<string, IPromptVariableSchema>();
  if (existingSchemas) {
    existingSchemas.forEach((s) => schemaMap.set(s.name, s));
  }
  return variableNames.map((name) => {
    const existing = schemaMap.get(name);
    return (
      existing || {
        name,
        description: "",
        defaultValue: "",
        required: false,
      }
    );
  });
}

function timestampToUnix(ts: Date | null): number | undefined {
  return ts ? Math.floor(ts.getTime() / 1000) : undefined;
}

function toPromptDef(prompt: any): IPromptDef {
  return {
    id: prompt.id,
    name: prompt.name,
    systemMessage: prompt.roleDefinitionTemplate || "",
    userMessage: prompt.instructionTemplate || "",
    systemVariables: prompt.roleDefinitionVariables || [],
    userVariables: prompt.instructionTemplateVariables || [],
    systemVariableSchemas: prompt.roleDefinitionVariableSchemas || [],
    userVariableSchemas: prompt.instructionTemplateVariableSchemas || [],
    maxTokens: prompt.maxTokens ?? undefined,
    temperature: prompt.temperature ?? undefined,
    models: prompt.models || [],
    status: prompt.status || "published",
    currentVersion: prompt.currentVersion || 1,
    mergeStrategy: prompt.mergeStrategy || "merge",
    createdAt: timestampToUnix(prompt.createTime) || 0,
    updatedAt: timestampToUnix(prompt.updateTime) || 0,
    pinedAt: timestampToUnix(prompt.pinedTime) ?? null,
    provider: prompt.provider ?? null,
  };
}

function toPromptVersion(version: any): IPromptVersion {
  return {
    id: version.id,
    promptId: version.promptId,
    version: version.version,
    name: version.name,
    systemMessage: version.roleDefinitionTemplate || "",
    userMessage: version.instructionTemplate || "",
    systemVariableSchemas: version.roleDefinitionVariableSchemas || [],
    userVariableSchemas: version.instructionTemplateVariableSchemas || [],
    maxTokens: version.maxTokens ?? undefined,
    temperature: version.temperature ?? undefined,
    models: version.models || [],
    changelog: version.changelog || "",
    publishedAt: timestampToUnix(version.publishedAt) || 0,
  };
}

function toPromptDraft(draft: any): IPromptDraft {
  return {
    promptId: draft.promptId,
    name: draft.name,
    systemMessage: draft.roleDefinitionTemplate || "",
    userMessage: draft.instructionTemplate || "",
    systemVariableSchemas: draft.roleDefinitionVariableSchemas || [],
    userVariableSchemas: draft.instructionTemplateVariableSchemas || [],
    maxTokens: draft.maxTokens ?? undefined,
    temperature: draft.temperature ?? undefined,
    models: draft.models || [],
    savedAt: timestampToUnix(draft.savedAt) || 0,
  };
}

export class PromptManager {
  #database = Container.inject(Database);
  #logger = Container.inject(Logger).scope("PromptManager");

  async createPrompt(options: PromptManager.CreatePromptOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const roleVarNames = parseVariables(options.roleDefinitionTemplate || "");
    const instructionVarNames = parseVariables(options.instructionTemplate || "");
    const roleVarSchemas = buildVariableSchemas(
      roleVarNames,
      options.roleDefinitionVariableSchemas,
    );
    const instructionVarSchemas = buildVariableSchemas(
      instructionVarNames,
      options.instructionTemplateVariableSchemas,
    );

    return client.transaction(async (tx) => {
      const promptValues: PromptInsert = {
        name: options.name,
        roleDefinitionTemplate: options.roleDefinitionTemplate,
        instructionTemplate: options.instructionTemplate,
        mergeStrategy: options.mergeStrategy || "merge",
        roleDefinitionVariables: roleVarNames,
        instructionTemplateVariables: instructionVarNames,
        roleDefinitionVariableSchemas: roleVarSchemas,
        instructionTemplateVariableSchemas: instructionVarSchemas,
        maxTokens: options.maxTokens ?? null,
        temperature: options.temperature ?? null,
        models: options.models || [],
        status: "published",
        currentVersion: 1,
      };

      const [inserted] = await tx
        .insert(schema.prompt)
        .values(promptValues)
        .returning()
        .execute();

      const versionValues: PromptVersionInsert = {
        promptId: inserted.id,
        version: 1,
        name: inserted.name,
        roleDefinitionTemplate: inserted.roleDefinitionTemplate,
        instructionTemplate: inserted.instructionTemplate,
        roleDefinitionVariableSchemas: roleVarSchemas,
        instructionTemplateVariableSchemas: instructionVarSchemas,
        maxTokens: inserted.maxTokens ?? null,
        temperature: inserted.temperature ?? null,
        models: inserted.models || [],
        changelog: "Initial version",
        publishedAt: new Date(),
      };

      await tx
        .insert(schema.promptVersion)
        .values(versionValues)
        .execute();

      return toPromptDef(inserted);
    });
  }

  async updatePrompt(options: PromptManager.UpdatePromptOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      const exists = await tx
        .$count(schema.prompt, eq(schema.prompt.id, options.id))
        .then((count) => count > 0);

      if (!exists) {
        throw new Error("Prompt does not exist.");
      }

      const updateValues: any = {
        name: options.name,
        roleDefinitionTemplate: options.roleDefinitionTemplate,
        instructionTemplate: options.instructionTemplate,
        mergeStrategy: options.mergeStrategy || "merge",
      };

      if (options.roleDefinitionTemplate !== undefined) {
        const roleVarNames = parseVariables(options.roleDefinitionTemplate || "");
        updateValues.roleDefinitionVariables = roleVarNames;
        if (options.roleDefinitionVariableSchemas) {
          updateValues.roleDefinitionVariableSchemas = buildVariableSchemas(
            roleVarNames,
            options.roleDefinitionVariableSchemas,
          );
        }
      }

      if (options.instructionTemplate !== undefined) {
        const instructionVarNames = parseVariables(options.instructionTemplate || "");
        updateValues.instructionTemplateVariables = instructionVarNames;
        if (options.instructionTemplateVariableSchemas) {
          updateValues.instructionTemplateVariableSchemas = buildVariableSchemas(
            instructionVarNames,
            options.instructionTemplateVariableSchemas,
          );
        }
      }

      if (options.maxTokens !== undefined) {
        updateValues.maxTokens = options.maxTokens ?? null;
      }
      if (options.temperature !== undefined) {
        updateValues.temperature = options.temperature ?? null;
      }
      if (options.models !== undefined) {
        updateValues.models = options.models || [];
      }
      if (options.pinedTime !== undefined) {
        updateValues.pinedTime = options.pinedTime ?? null;
      }

      const [updated] = await tx
        .update(schema.prompt)
        .set(updateValues)
        .where(eq(schema.prompt.id, options.id))
        .returning()
        .execute();

      return toPromptDef(updated);
    });
  }

  async deletePrompt(options: PromptManager.DeletePromptOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      const exists = await tx
        .$count(schema.prompt, eq(schema.prompt.id, options.id))
        .then((count) => count > 0);

      if (!exists) {
        throw new Error("Prompt does not exist.");
      }

      await tx
        .delete(schema.promptDraft)
        .where(eq(schema.promptDraft.promptId, options.id))
        .execute();

      await tx
        .delete(schema.promptVersion)
        .where(eq(schema.promptVersion.promptId, options.id))
        .execute();

      await tx
        .delete(schema.prompt)
        .where(eq(schema.prompt.id, options.id))
        .execute();

      return true;
    });
  }

  async listPrompts() {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const result = await client
      .select()
      .from(schema.prompt)
      .orderBy(desc(schema.prompt.createTime))
      .execute();

    return result.map(toPromptDef);
  }

  async getPrompt(options: PromptManager.GetPromptOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const [result] = await client
      .select()
      .from(schema.prompt)
      .where(eq(schema.prompt.id, options.id))
      .execute();

    if (!result) {
      throw new Error("Prompt not found");
    }

    return toPromptDef(result);
  }

  async saveDraft(options: PromptManager.SaveDraftOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const roleVarSchemas = options.roleDefinitionVariableSchemas || [];
    const instructionVarSchemas = options.instructionTemplateVariableSchemas || [];

    return client.transaction(async (tx) => {
      const exists = await tx
        .select()
        .from(schema.promptDraft)
        .where(eq(schema.promptDraft.promptId, options.promptId))
        .execute();

      const draftValues: any = {
        promptId: options.promptId,
        name: options.name,
        roleDefinitionTemplate: options.roleDefinitionTemplate,
        instructionTemplate: options.instructionTemplate,
        roleDefinitionVariableSchemas: roleVarSchemas,
        instructionTemplateVariableSchemas: instructionVarSchemas,
        maxTokens: options.maxTokens ?? null,
        temperature: options.temperature ?? null,
        models: options.models || [],
        savedAt: new Date(),
      };

      if (exists.length > 0) {
        await tx
          .update(schema.promptDraft)
          .set(draftValues)
          .where(eq(schema.promptDraft.promptId, options.promptId))
          .execute();
      } else {
        await tx
          .insert(schema.promptDraft)
          .values(draftValues as PromptDraftInsert)
          .execute();
      }

      return toPromptDraft({ ...draftValues, promptId: options.promptId });
    });
  }

  async getDraft(options: PromptManager.GetDraftOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const [result] = await client
      .select()
      .from(schema.promptDraft)
      .where(eq(schema.promptDraft.promptId, options.promptId))
      .execute();

    if (!result) {
      return null;
    }

    return toPromptDraft(result);
  }

  async deleteDraft(options: PromptManager.DeleteDraftOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    return client.transaction(async (tx) => {
      await tx
        .delete(schema.promptDraft)
        .where(eq(schema.promptDraft.promptId, options.promptId))
        .execute();

      return true;
    });
  }

  async publishVersion(options: PromptManager.PublishVersionOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const roleVarNames = parseVariables(options.roleDefinitionTemplate || "");
    const instructionVarNames = parseVariables(options.instructionTemplate || "");
    const roleVarSchemas = buildVariableSchemas(
      roleVarNames,
      options.roleDefinitionVariableSchemas,
    );
    const instructionVarSchemas = buildVariableSchemas(
      instructionVarNames,
      options.instructionTemplateVariableSchemas,
    );

    return client.transaction(async (tx) => {
      const [current] = await tx
        .select({ currentVersion: schema.prompt.currentVersion })
        .from(schema.prompt)
        .where(eq(schema.prompt.id, options.promptId))
        .execute();

      if (!current) {
        throw new Error("Prompt not found");
      }

      const nextVersion = (current.currentVersion || 0) + 1;

      const versionValues: PromptVersionInsert = {
        promptId: options.promptId,
        version: nextVersion,
        name: options.name,
        roleDefinitionTemplate: options.roleDefinitionTemplate,
        instructionTemplate: options.instructionTemplate,
        roleDefinitionVariableSchemas: roleVarSchemas,
        instructionTemplateVariableSchemas: instructionVarSchemas,
        maxTokens: options.maxTokens ?? null,
        temperature: options.temperature ?? null,
        models: options.models || [],
        changelog: options.changelog || "",
        publishedAt: new Date(),
      };

      await tx
        .insert(schema.promptVersion)
        .values(versionValues)
        .execute();

      await tx
        .update(schema.prompt)
        .set({
          name: options.name,
          roleDefinitionTemplate: options.roleDefinitionTemplate,
          instructionTemplate: options.instructionTemplate,
          roleDefinitionVariables: roleVarNames,
          instructionTemplateVariables: instructionVarNames,
          roleDefinitionVariableSchemas: roleVarSchemas,
          instructionTemplateVariableSchemas: instructionVarSchemas,
          maxTokens: options.maxTokens ?? null,
          temperature: options.temperature ?? null,
          models: options.models || [],
          status: "published",
          currentVersion: nextVersion,
        })
        .where(eq(schema.prompt.id, options.promptId))
        .execute();

      await tx
        .delete(schema.promptDraft)
        .where(eq(schema.promptDraft.promptId, options.promptId))
        .execute();

      const [updated] = await tx
        .select()
        .from(schema.prompt)
        .where(eq(schema.prompt.id, options.promptId))
        .execute();

      return {
        version: toPromptVersion({
          ...versionValues,
          id: "temp",
          promptId: options.promptId,
        }),
        prompt: toPromptDef(updated),
      };
    });
  }

  async listVersions(options: PromptManager.ListVersionsOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const result = await client
      .select()
      .from(schema.promptVersion)
      .where(eq(schema.promptVersion.promptId, options.promptId))
      .orderBy(desc(schema.promptVersion.version))
      .execute();

    return result.map(toPromptVersion);
  }

  async getVersion(options: PromptManager.GetVersionOptions) {
    const client = this.#database.client;
    const schema = this.#database.schema;

    const [result] = await client
      .select()
      .from(schema.promptVersion)
      .where(eq(schema.promptVersion.id, options.id))
      .execute();

    if (!result) {
      throw new Error("Version not found");
    }

    return toPromptVersion(result);
  }

  async parsePromptVariables(options: PromptManager.ParseVariablesOptions): Promise<{
    roleDefinition: string[];
    instructionTemplate: string[];
  }> {
    return {
      roleDefinition: parseVariables(options.roleDefinitionTemplate || ""),
      instructionTemplate: parseVariables(options.instructionTemplate || ""),
    };
  }

  async renderPromptPreview(options: PromptManager.RenderPreviewOptions): Promise<{
    roleDefinition: string;
    instructionTemplate: string;
  }> {
    return {
      roleDefinition: fillVariables(
        options.roleDefinitionTemplate || "",
        options.roleDefinitionVariables || {},
      ),
      instructionTemplate: fillVariables(
        options.instructionTemplate || "",
        options.instructionTemplateVariables || {},
      ),
    };
  }

  async buildVariableSchemasFromTemplates(
    options: PromptManager.BuildVariableSchemasOptions,
  ): Promise<{
    roleDefinition: IPromptVariableSchema[];
    instructionTemplate: IPromptVariableSchema[];
  }> {
    const roleVarNames = parseVariables(options.roleDefinitionTemplate || "");
    const instructionVarNames = parseVariables(options.instructionTemplate || "");
    return {
      roleDefinition: buildVariableSchemas(
        roleVarNames,
        options.existingRoleDefinitionSchemas,
      ),
      instructionTemplate: buildVariableSchemas(
        instructionVarNames,
        options.existingInstructionTemplateSchemas,
      ),
    };
  }
}

export namespace PromptManager {
  export type CreatePromptOptions = {
    name: string;
    roleDefinitionTemplate?: string;
    instructionTemplate: string;
    mergeStrategy?: "merge" | "replace" | "scoped";
    roleDefinitionVariableSchemas?: IPromptVariableSchema[];
    instructionTemplateVariableSchemas?: IPromptVariableSchema[];
    maxTokens?: number;
    temperature?: number;
    models?: string[];
  };

  export type UpdatePromptOptions = CreatePromptOptions & {
    id: string;
    pinedTime?: Date | null;
  };

  export type DeletePromptOptions = {
    id: string;
  };

  export type GetPromptOptions = {
    id: string;
  };

  export type SaveDraftOptions = {
    promptId: string;
    name: string;
    roleDefinitionTemplate?: string;
    instructionTemplate: string;
    roleDefinitionVariableSchemas?: IPromptVariableSchema[];
    instructionTemplateVariableSchemas?: IPromptVariableSchema[];
    maxTokens?: number;
    temperature?: number;
    models?: string[];
  };

  export type GetDraftOptions = {
    promptId: string;
  };

  export type DeleteDraftOptions = {
    promptId: string;
  };

  export type PublishVersionOptions = {
    promptId: string;
    name: string;
    roleDefinitionTemplate?: string;
    instructionTemplate: string;
    roleDefinitionVariableSchemas?: IPromptVariableSchema[];
    instructionTemplateVariableSchemas?: IPromptVariableSchema[];
    maxTokens?: number;
    temperature?: number;
    models?: string[];
    changelog?: string;
  };

  export type ListVersionsOptions = {
    promptId: string;
  };

  export type GetVersionOptions = {
    id: string;
  };

  export type ParseVariablesOptions = {
    roleDefinitionTemplate?: string;
    instructionTemplate?: string;
  };

  export type RenderPreviewOptions = {
    roleDefinitionTemplate?: string;
    instructionTemplate?: string;
    roleDefinitionVariables?: { [key: string]: string };
    instructionTemplateVariables?: { [key: string]: string };
  };

  export type BuildVariableSchemasOptions = {
    roleDefinitionTemplate?: string;
    instructionTemplate?: string;
    existingRoleDefinitionSchemas?: IPromptVariableSchema[];
    existingInstructionTemplateSchemas?: IPromptVariableSchema[];
  };
}
