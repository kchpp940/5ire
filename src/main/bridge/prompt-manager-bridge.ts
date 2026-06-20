import { Bridge } from "@/main/internal/bridge";
import { Container } from "@/main/internal/container";
import { PromptManager } from "@/main/services/prompt-manager";

export class PromptManagerBridge extends Bridge.define("prompt-manager", () => {
  const service = Container.inject(PromptManager);

  return {
    createPrompt: service.createPrompt.bind(service),
    updatePrompt: service.updatePrompt.bind(service),
    deletePrompt: service.deletePrompt.bind(service),
    getPrompt: service.getPrompt.bind(service),
    listPrompts: service.listPrompts.bind(service),
    saveDraft: service.saveDraft.bind(service),
    getDraft: service.getDraft.bind(service),
    deleteDraft: service.deleteDraft.bind(service),
    publishVersion: service.publishVersion.bind(service),
    listVersions: service.listVersions.bind(service),
    getVersion: service.getVersion.bind(service),
    parsePromptVariables: service.parsePromptVariables.bind(service),
    renderPromptPreview: service.renderPromptPreview.bind(service),
    buildVariableSchemasFromTemplates: service.buildVariableSchemasFromTemplates.bind(service),
  };
}) {}
