import Debug from 'debug';
import {
  IPromptDef,
  IPromptDraft,
  IPromptVersion,
  IPromptVariableSchema,
} from 'intellichat/types';
import { sortPrompts } from 'utils/util';
import { create } from 'zustand';

const debug = Debug('5ire:stores:usePromptStore');

function toMainFields(prompt: Partial<IPromptDef>) {
  return {
    name: prompt.name,
    roleDefinitionTemplate: prompt.systemMessage,
    instructionTemplate: prompt.userMessage,
    mergeStrategy: prompt.mergeStrategy,
    roleDefinitionVariableSchemas: prompt.systemVariableSchemas,
    instructionTemplateVariableSchemas: prompt.userVariableSchemas,
    maxTokens: prompt.maxTokens,
    temperature: prompt.temperature,
    models: prompt.models,
  };
}

function toMainDraftFields(draft: IPromptDraft) {
  return {
    promptId: draft.promptId,
    name: draft.name,
    roleDefinitionTemplate: draft.systemMessage,
    instructionTemplate: draft.userMessage,
    roleDefinitionVariableSchemas: draft.systemVariableSchemas,
    instructionTemplateVariableSchemas: draft.userVariableSchemas,
    maxTokens: draft.maxTokens,
    temperature: draft.temperature,
    models: draft.models,
  };
}

function toMainVersionFields(options: {
  promptId: string;
} & Partial<IPromptDef> & { changelog?: string }) {
  return {
    promptId: options.promptId,
    name: options.name || '',
    roleDefinitionTemplate: options.systemMessage,
    instructionTemplate: options.userMessage,
    roleDefinitionVariableSchemas: options.systemVariableSchemas,
    instructionTemplateVariableSchemas: options.userVariableSchemas,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    models: options.models,
    changelog: options.changelog,
  };
}

export interface IPromptStore {
  prompt: IPromptDef | null;
  prompts: IPromptDef[];
  versions: IPromptVersion[];
  draft: IPromptDraft | null;
  createPrompt: (prompt: Partial<IPromptDef>) => Promise<IPromptDef>;
  updatePrompt: (
    prompt: { id: string } & Partial<IPromptDef>,
  ) => Promise<boolean>;
  deletePrompt: (id: string) => Promise<boolean>;
  setPrompt: (prompt: IPromptDef | null) => void;
  getPrompt: (id: string) => Promise<IPromptDef>;
  fetchPrompts: ({
    limit,
    offset,
    keyword,
  }: {
    limit?: number;
    offset?: number;
    keyword?: string;
  }) => Promise<IPromptDef[]>;
  saveDraft: (draft: IPromptDraft) => Promise<boolean>;
  getDraft: (promptId: string) => Promise<IPromptDraft | null>;
  deleteDraft: (promptId: string) => Promise<boolean>;
  publishVersion: (
    options: { promptId: string } & Partial<IPromptDef> & { changelog?: string },
  ) => Promise<IPromptVersion>;
  listVersions: (promptId: string) => Promise<IPromptVersion[]>;
  getVersion: (versionId: string) => Promise<IPromptVersion>;
  parsePromptVariables: (
    systemMessage: string,
    userMessage: string,
  ) => Promise<{ systemVariables: string[]; userVariables: string[] }>;
  renderPromptPreview: (
    systemMessage: string,
    userMessage: string,
    systemVars: { [key: string]: string },
    userVars: { [key: string]: string },
  ) => Promise<{ systemMessage: string; userMessage: string }>;
  buildVariableSchemas: (
    systemMessage: string,
    userMessage: string,
    existingSystemSchemas?: IPromptVariableSchema[],
    existingUserSchemas?: IPromptVariableSchema[],
  ) => Promise<{
    systemVariableSchemas: IPromptVariableSchema[];
    userVariableSchemas: IPromptVariableSchema[];
  }>;
}

const usePromptStore = create<IPromptStore>((set, get) => ({
  prompt: null,
  prompts: [],
  versions: [],
  draft: null,

  parsePromptVariables: async (
    systemMessage: string,
    userMessage: string,
  ) => {
    const result = await window.bridge.promptManager.parsePromptVariables({
      roleDefinitionTemplate: systemMessage,
      instructionTemplate: userMessage,
    });
    return {
      systemVariables: result.roleDefinition,
      userVariables: result.instructionTemplate,
    };
  },

  renderPromptPreview: async (
    systemMessage: string,
    userMessage: string,
    systemVars: { [key: string]: string },
    userVars: { [key: string]: string },
  ) => {
    const result = await window.bridge.promptManager.renderPromptPreview({
      roleDefinitionTemplate: systemMessage,
      instructionTemplate: userMessage,
      roleDefinitionVariables: systemVars,
      instructionTemplateVariables: userVars,
    });
    return {
      systemMessage: result.roleDefinition,
      userMessage: result.instructionTemplate,
    };
  },

  buildVariableSchemas: async (
    systemMessage: string,
    userMessage: string,
    existingSystemSchemas?: IPromptVariableSchema[],
    existingUserSchemas?: IPromptVariableSchema[],
  ) => {
    const result =
      await window.bridge.promptManager.buildVariableSchemasFromTemplates({
        roleDefinitionTemplate: systemMessage,
        instructionTemplate: userMessage,
        existingRoleDefinitionSchemas: existingSystemSchemas,
        existingInstructionTemplateSchemas: existingUserSchemas,
      });
    return {
      systemVariableSchemas: result.roleDefinition,
      userVariableSchemas: result.instructionTemplate,
    };
  },

  createPrompt: async (prompt: Partial<IPromptDef>) => {
    const mainFields = toMainFields(prompt);
    const $prompt = await window.bridge.promptManager.createPrompt(mainFields);
    set((state) => ({
      prompts: sortPrompts([...state.prompts, $prompt]),
    }));
    debug('Create Prompt ', $prompt);
    return $prompt;
  },

  updatePrompt: async (prompt: { id: string } & Partial<IPromptDef>) => {
    const mainFields = toMainFields(prompt);
    const updated = await window.bridge.promptManager.updatePrompt({
      id: prompt.id,
      ...mainFields,
    });
    if (updated) {
      const updatedPrompts = sortPrompts(
        get().prompts.map((p: IPromptDef) => {
          if (p.id === prompt.id) {
            return updated;
          }
          return p;
        }),
      );
      set({ prompts: updatedPrompts });
      debug('Update Prompt ', updated);
      return true;
    }
    return false;
  },

  deletePrompt: async (id: string) => {
    const result = await window.bridge.promptManager.deletePrompt({ id });
    if (result) {
      const { prompts } = get();
      const index = prompts.findIndex((item) => item.id === id);
      if (index > -1) {
        debug(`Remove prompt(${id}) from index: ${index})`);
        prompts.splice(index, 1);
        set({ prompts: [...prompts] });
      }
      return true;
    }
    return false;
  },

  getPrompt: async (id: string) => {
    const prompt = await window.bridge.promptManager.getPrompt({ id });
    return prompt;
  },

  setPrompt: (prompt: IPromptDef | null) => {
    set({ prompt });
  },

  fetchPrompts: async ({
    limit = 99999,
    offset = 0,
    keyword = '',
  }: {
    limit?: number;
    offset?: number;
    keyword?: string;
  }) => {
    const allPrompts = await window.bridge.promptManager.listPrompts();
    let filtered = allPrompts;
    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      filtered = allPrompts.filter((p) =>
        p.name.toLowerCase().includes(kw),
      );
    }
    const prompts = filtered.slice(offset, offset + limit);
    set({ prompts: sortPrompts(prompts) });
    return prompts;
  },

  saveDraft: async (draft: IPromptDraft) => {
    const mainFields = toMainDraftFields(draft);
    const saved = await window.bridge.promptManager.saveDraft(mainFields);
    set({ draft: saved });
    return true;
  },

  getDraft: async (promptId: string) => {
    const draft = await window.bridge.promptManager.getDraft({ promptId });
    set({ draft });
    return draft;
  },

  deleteDraft: async (promptId: string) => {
    const result = await window.bridge.promptManager.deleteDraft({ promptId });
    if (result) {
      set({ draft: null });
    }
    return result;
  },

  publishVersion: async (
    options: { promptId: string } & Partial<IPromptDef> & {
      changelog?: string;
    },
  ) => {
    const mainFields = toMainVersionFields(options);
    const result = await window.bridge.promptManager.publishVersion(mainFields);

    const { prompts } = get();
    const updatedPrompts = sortPrompts(
      prompts.map((p: IPromptDef) => {
        if (p.id === options.promptId) {
          return result.prompt;
        }
        return p;
      }),
    );
    set({ prompts: updatedPrompts, draft: null });

    return result.version;
  },

  listVersions: async (promptId: string) => {
    const versions = await window.bridge.promptManager.listVersions({
      promptId,
    });
    set({ versions });
    return versions;
  },

  getVersion: async (versionId: string) => {
    const version = await window.bridge.promptManager.getVersion({
      id: versionId,
    });
    return version;
  },
}));

export default usePromptStore;
