import type { IChatResponseMessage } from "intellichat/types";
import BaseReader from "./BaseReader";
import type IChatReader from "./IChatReader";

export default class OpenAIReader extends BaseReader implements IChatReader {
  protected parseReply(chunk: string): IChatResponseMessage {
    const data = JSON.parse(chunk);
    if (data.error) {
      throw new Error(data.error.message || data.error);
    }
    if (data.usage) {
      return {
        content: "",
        isEnd: false,
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        toolCalls: [],
      };
    }
    if (!data.choices || data.choices.length === 0) {
      return {
        content: "",
        reasoning: "",
        isEnd: false,
        toolCalls: [],
      };
    }
    const choice = data.choices[0];
    return {
      content: choice.delta.content || "",
      reasoning: choice.delta.reasoning_content || "",
      isEnd: choice.finish_reason === "stop" || choice.finish_reason === "tool_calls",
      toolCalls: choice.delta.tool_calls,
    };
  }

  protected parseTools(respMsg: IChatResponseMessage): {
    index: number;
    id: string;
    name: string;
  }[] {
    if (!respMsg.toolCalls || !Array.isArray(respMsg.toolCalls)) return [];
    return respMsg.toolCalls
      .filter((tc: any) => tc.id || tc.function?.name)
      .map((tc: any) => ({
        index: tc.index ?? 0,
        id: tc.id || "",
        name: tc.function?.name || "",
      }));
  }

  protected parseToolArgs(respMsg: IChatResponseMessage): {
    index: number;
    args: string;
  }[] {
    if (!respMsg.toolCalls || !Array.isArray(respMsg.toolCalls)) return [];
    return respMsg.toolCalls
      .map((tc: any) => ({
        index: tc.index ?? 0,
        args: tc.function?.arguments || "",
      }))
      .filter((item) => item.args !== "");
  }
}
