import type { IChatResponseMessage } from "intellichat/types";
import type IChatReader from "./IChatReader";
import type { IReadResult, ITool } from "./IChatReader";

interface ToolAccumulator {
  id: string;
  name: string;
  argsStr: string;
  rawFunctionCall?: Record<string, any>;
}

export default abstract class BaseReader implements IChatReader {
  protected streamReader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.streamReader = reader;
  }

  protected parseTools(respMsg: IChatResponseMessage): {
    index: number;
    id: string;
    name: string;
    rawFunctionCall?: Record<string, any>;
  }[] {
    if (!respMsg.toolCalls) return [];
    const toolCalls = Array.isArray(respMsg.toolCalls) ? respMsg.toolCalls : [respMsg.toolCalls];
    return toolCalls
      .filter((tc: any) => tc.id || tc.function?.name || tc.name)
      .map((tc: any, i: number) => ({
        index: tc.index ?? i,
        id: tc.id || "",
        name: tc.function?.name || tc.name || "",
        rawFunctionCall: tc.rawFunctionCall,
      }));
  }

  protected parseToolArgs(respMsg: IChatResponseMessage): {
    index: number;
    args: string;
  }[] {
    if (!respMsg.toolCalls) return [];
    const toolCalls = Array.isArray(respMsg.toolCalls) ? respMsg.toolCalls : [respMsg.toolCalls];
    return toolCalls
      .map((tc: any, i: number) => {
        const rawArgs = tc.function?.arguments ?? tc.args ?? "";
        const args = typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs);
        return { index: tc.index ?? i, args };
      })
      .filter((item) => item.args !== "");
  }

  protected parseReply(chunk: string): IChatResponseMessage {
    try {
      return JSON.parse(chunk);
    } catch (e) {
      return {
        content: chunk,
        toolCalls: [],
        inputTokens: 0,
        outputTokens: chunk.length / 4,
      };
    }
  }

  protected processChunk(chunk: string): IChatResponseMessage | null {
    if (!chunk || chunk.trim() === "") {
      return null;
    }
    return this.parseReply(chunk);
  }

  private incompleteChunks: string[] = [];

  protected shouldCombineChunks(chunk: string): boolean {
    try {
      JSON.parse(chunk);
      return false;
    } catch (e) {
      return true;
    }
  }

  protected getCombinedChunk(chunk: string): {
    combinedChunk: string;
    isComplete: boolean;
  } {
    this.incompleteChunks.push(chunk);
    if (this.incompleteChunks.length > 5) {
      this.incompleteChunks = this.incompleteChunks.slice(-5);
    }
    const combined = this.incompleteChunks.join("");
    try {
      JSON.parse(combined);
      this.incompleteChunks = [];
      return { combinedChunk: combined, isComplete: true };
    } catch (e) {
      return { combinedChunk: combined, isComplete: false };
    }
  }

  public async read({
    onError,
    onProgress,
    onToolCalls,
  }: {
    onError: (error: any) => void;
    onProgress: (chunk: string, reasoning?: string) => void;
    onToolCalls: (toolName: string | null) => void;
  }): Promise<IReadResult> {
    const decoder = new TextDecoder("utf-8");
    const state = {
      content: "",
      reasoning: "",
      inputTokens: 0,
      outputTokens: 0,
      toolMap: new Map<number, ToolAccumulator>(),
    };

    try {
      await this.processStreamData(decoder, state, {
        onProgress,
        onToolCalls,
      });

      const tools = this.finalizeTools(state.toolMap);
      return {
        content: state.content,
        reasoning: state.reasoning || undefined,
        tools,
        inputTokens: state.inputTokens || undefined,
        outputTokens: state.outputTokens || undefined,
      };
    } catch (error) {
      console.error("Stream reading error:", error);
      onError(error);
      const tools = this.finalizeTools(state.toolMap);
      return {
        content: state.content,
        reasoning: state.reasoning || undefined,
        tools,
        inputTokens: state.inputTokens || undefined,
        outputTokens: state.outputTokens || undefined,
      };
    }
  }

  private async processStreamData(
    decoder: TextDecoder,
    state: {
      content: string;
      reasoning: string;
      inputTokens: number;
      outputTokens: number;
      toolMap: Map<number, ToolAccumulator>;
    },
    callbacks: {
      onProgress: (chunk: string, reasoning?: string) => void;
      onToolCalls: (toolName: string | null) => void;
    },
  ): Promise<void> {
    let isStreamDone = false;

    while (!isStreamDone) {
      const { value, done } = await this.streamReader.read();
      if (done) break;

      const decodedValue = decoder.decode(value);
      const lines = this.splitIntoLines(decodedValue);

      for (const line of lines) {
        const chunks = this.extractDataChunks(line);

        for (const chunk of chunks) {
          if (chunk === "[DONE]") {
            isStreamDone = true;
            break;
          }

          const shouldCombine = this.shouldCombineChunks(chunk);
          const { combinedChunk, isComplete } = shouldCombine
            ? this.getCombinedChunk(chunk)
            : { combinedChunk: chunk, isComplete: true };

          if (isComplete) {
            const completeMessage = this.processChunk(combinedChunk);
            if (completeMessage) {
              this.processResponse(completeMessage, state, callbacks);
            }
          }
        }
      }
    }
  }

  private splitIntoLines(value: string): string[] {
    return value
      .split("\n")
      .filter((line) => !line.includes("event:"))
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }

  private extractDataChunks(line: string): string[] {
    return line
      .split("data:")
      .filter((chunk) => chunk !== "")
      .map((chunk) => chunk.trim());
  }

  private processResponse(
    response: IChatResponseMessage,
    state: {
      content: string;
      reasoning: string;
      inputTokens: number;
      outputTokens: number;
      toolMap: Map<number, ToolAccumulator>;
    },
    callbacks: {
      onProgress: (chunk: string, reasoning?: string) => void;
      onToolCalls: (toolName: string | null) => void;
    },
  ): void {
    const hasContent = response.content != null && response.content !== "";
    const hasReasoning = response.reasoning != null && response.reasoning !== "";

    if (hasContent || hasReasoning) {
      const contentPart = hasContent ? response.content! : "";
      const reasoningPart = hasReasoning ? response.reasoning! : "";
      state.content += contentPart;
      state.reasoning += reasoningPart;
      callbacks.onProgress(contentPart, reasoningPart);
    }

    const toolInfos = this.parseTools(response);
    if (toolInfos.length > 0) {
      for (const info of toolInfos) {
        const existing = state.toolMap.get(info.index);
        if (existing) {
          if (info.id) existing.id = info.id;
          if (info.name) existing.name = info.name;
          if (info.rawFunctionCall) existing.rawFunctionCall = info.rawFunctionCall;
        } else {
          state.toolMap.set(info.index, {
            id: info.id || "",
            name: info.name || "",
            argsStr: "",
            rawFunctionCall: info.rawFunctionCall,
          });
        }
        callbacks.onToolCalls(info.name);
      }
    }

    const toolArgs = this.parseToolArgs(response);
    for (const arg of toolArgs) {
      const existing = state.toolMap.get(arg.index);
      if (existing) {
        existing.argsStr += arg.args;
      }
    }

    this.updateTokenCounts(response, state);
  }

  private updateTokenCounts(
    response: IChatResponseMessage,
    state: { inputTokens: number; outputTokens: number },
  ): void {
    if (response.inputTokens !== undefined && response.inputTokens !== null && response.inputTokens > 0) {
      state.inputTokens = response.inputTokens;
    }
    if (response.outputTokens !== undefined && response.outputTokens !== null && response.outputTokens > 0) {
      state.outputTokens = response.outputTokens;
    }
  }

  private finalizeTools(toolMap: Map<number, ToolAccumulator>): ITool[] {
    if (toolMap.size === 0) return [];
    const tools: ITool[] = [];
    const indices = Array.from(toolMap.keys()).sort((a, b) => a - b);
    for (const idx of indices) {
      const acc = toolMap.get(idx)!;
      let parsedArgs: any = {};
      if (acc.argsStr) {
        try {
          parsedArgs = JSON.parse(acc.argsStr);
        } catch (e) {
          parsedArgs = acc.argsStr;
        }
      }
      const tool: ITool = {
        id: acc.id,
        name: acc.name,
        args: parsedArgs,
      };
      if (acc.rawFunctionCall) {
        tool.rawFunctionCall = acc.rawFunctionCall;
      }
      tools.push(tool);
    }
    return tools;
  }
}
