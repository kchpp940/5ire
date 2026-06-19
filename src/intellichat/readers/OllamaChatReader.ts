import type { IChatResponseMessage } from "intellichat/types";
import type IChatReader from "./IChatReader";
import OpenAIReader from "./OpenAIReader";

export default class OllamaReader extends OpenAIReader implements IChatReader {
  protected parseReply(chunk: string): IChatResponseMessage {
    const data = JSON.parse(chunk);
    if (data.done) {
      return {
        content: data.message?.content || "",
        isEnd: true,
        inputTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
        toolCalls: [],
      };
    }
    const toolCalls = data.message?.tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      return {
        content: data.message?.content || "",
        isEnd: false,
        toolCalls: toolCalls.map((tc: any, i: number) => ({
          index: i,
          id: tc.id || `ollama_tool_${i}`,
          name: tc.function?.name || "",
          args: tc.function?.arguments ?? "",
        })),
      };
    }
    return {
      content: data.message?.content || "",
      isEnd: false,
      toolCalls: [],
    };
  }
}
