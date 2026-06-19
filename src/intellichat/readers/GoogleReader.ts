import type { IChatResponseMessage } from "intellichat/types";
import { extractFirstLevelBrackets } from "utils/util";
import BaseReader from "./BaseReader";
import type { IReadResult, ITool } from "./IChatReader";

export default class GoogleReader extends BaseReader {
  protected parseReply(chunk: string): IChatResponseMessage {
    const _chunk = chunk.trim();
    try {
      const data = JSON.parse(_chunk);
      if (data.candidates) {
        const firstCandidate = data.candidates[0];
        const parts = firstCandidate?.content?.parts || [];
        let text = "";
        let reasoning = "";
        for (const part of parts) {
          if (part?.text) {
            if (part.thought) {
              reasoning += part.text;
            } else {
              text += part.text;
            }
          }
        }
        const functionCallPart = parts.find((part: Record<string, any>) => !!part?.functionCall)?.functionCall;

        return {
          content: text,
          reasoning,
          isEnd: !!firstCandidate.finishReason,
          inputTokens: data.usageMetadata?.promptTokenCount,
          outputTokens: data.usageMetadata?.candidatesTokenCount,
          toolCalls: functionCallPart ? [functionCallPart] : [],
        };
      }
      return {
        content: "",
        isEnd: false,
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
      };
    } catch (err) {
      console.error("Error parsing JSON:", err);
      return {
        content: "",
        isEnd: false,
      };
    }
  }

  protected parseTools(respMsg: IChatResponseMessage): {
    index: number;
    id: string;
    name: string;
    rawFunctionCall?: Record<string, any>;
  }[] {
    if (!respMsg.toolCalls || !Array.isArray(respMsg.toolCalls) || respMsg.toolCalls.length === 0) return [];
    return respMsg.toolCalls
      .filter((tc: any) => tc.name)
      .map((tc: any, i: number) => {
        const thoughtSignature = tc.thoughtSignature || tc.thought_signature;
        return {
          index: i,
          id: "",
          name: tc.name,
          rawFunctionCall: thoughtSignature ? tc : undefined,
        };
      });
  }

  protected parseToolArgs(respMsg: IChatResponseMessage): {
    index: number;
    args: string;
  }[] {
    if (!respMsg.toolCalls || !Array.isArray(respMsg.toolCalls) || respMsg.toolCalls.length === 0) return [];
    return respMsg.toolCalls
      .filter((tc: any) => tc.args !== undefined && tc.args !== null)
      .map((tc: any, i: number) => ({
        index: i,
        args: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
      }));
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
    let content = "";
    let reasoning = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let done = false;
    const toolAccumulators = new Map<
      number,
      { id: string; name: string; argsStr: string; rawFunctionCall?: Record<string, any> }
    >();
    let buffer = "";

    try {
      while (!done) {
        const data = await this.streamReader.read();
        done = data.done || false;
        const value = decoder.decode(data.value);
        buffer += value;

        try {
          const items = extractFirstLevelBrackets(buffer);
          if (items.length > 0) {
            for (const item of items) {
              const response = this.parseReply(item);
              if (response.content) {
                content += response.content;
              }
              if (response.reasoning) {
                reasoning += response.reasoning;
              }
              if (response.inputTokens !== undefined && response.inputTokens !== null && response.inputTokens > 0) {
                inputTokens = response.inputTokens;
              }
              if (response.outputTokens !== undefined && response.outputTokens !== null && response.outputTokens > 0) {
                outputTokens = response.outputTokens;
              }
              const toolInfos = this.parseTools(response);
              for (const info of toolInfos) {
                const existing = toolAccumulators.get(info.index);
                if (existing) {
                  if (info.name) existing.name = info.name;
                  if (info.rawFunctionCall) existing.rawFunctionCall = info.rawFunctionCall;
                } else {
                  toolAccumulators.set(info.index, {
                    id: info.id || "",
                    name: info.name || "",
                    argsStr: "",
                    rawFunctionCall: info.rawFunctionCall,
                  });
                }
                onToolCalls(info.name);
              }
              const toolArgs = this.parseToolArgs(response);
              for (const arg of toolArgs) {
                const existing = toolAccumulators.get(arg.index);
                if (existing) {
                  existing.argsStr += arg.args;
                }
              }
              onProgress(response.content || "", response.reasoning || "");
            }
            const lastItemEnd = buffer.lastIndexOf("}") + 1;
            if (lastItemEnd > 0) {
              buffer = buffer.substring(lastItemEnd);
            }
          }
        } catch (parseErr) {
          // incomplete JSON, continue
        }
      }

      if (buffer.trim()) {
        try {
          const items = extractFirstLevelBrackets(buffer);
          for (const item of items) {
            const response = this.parseReply(item);
            if (response.content) {
              content += response.content;
            }
            if (response.reasoning) {
              reasoning += response.reasoning;
            }
            if (response.inputTokens !== undefined && response.inputTokens !== null && response.inputTokens > 0) {
              inputTokens = response.inputTokens;
            }
            if (response.outputTokens !== undefined && response.outputTokens !== null && response.outputTokens > 0) {
              outputTokens = response.outputTokens;
            }
            const toolInfos = this.parseTools(response);
            for (const info of toolInfos) {
              const existing = toolAccumulators.get(info.index);
              if (existing) {
                if (info.name) existing.name = info.name;
                if (info.rawFunctionCall) existing.rawFunctionCall = info.rawFunctionCall;
              } else {
                toolAccumulators.set(info.index, {
                  id: info.id || "",
                  name: info.name || "",
                  argsStr: "",
                  rawFunctionCall: info.rawFunctionCall,
                });
              }
              onToolCalls(info.name);
            }
            const toolArgs = this.parseToolArgs(response);
            for (const arg of toolArgs) {
              const existing = toolAccumulators.get(arg.index);
              if (existing) {
                existing.argsStr += arg.args;
              }
            }
            onProgress(response.content || "", response.reasoning || "");
          }
        } catch (finalParseErr) {
          // ignore
        }
      }
    } catch (err) {
      console.error("Read error:", err);
      onError(err);
    }

    const tools = this.finalizeToolsFromMap(toolAccumulators);
    return {
      content,
      reasoning: reasoning || undefined,
      tools,
      inputTokens: inputTokens || undefined,
      outputTokens: outputTokens || undefined,
    };
  }

  private finalizeToolsFromMap(
    toolMap: Map<number, { id: string; name: string; argsStr: string; rawFunctionCall?: Record<string, any> }>,
  ): ITool[] {
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
