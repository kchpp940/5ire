import type { IChatResponseMessage } from "intellichat/types";
import BaseReader from "./BaseReader";

export default class AnthropicReader extends BaseReader {
  protected processChunk(chunk: string): IChatResponseMessage | null {
    try {
      return this.parseReply(chunk);
    } catch (error) {
      return null;
    }
  }

  protected parseReply(chunk: string): IChatResponseMessage {
    const data = JSON.parse(chunk);
    if (data.type === "content_block_start") {
      if (data.content_block.type === "tool_use") {
        return {
          toolCalls: [
            {
              id: data.content_block.id,
              name: data.content_block.name,
              args: "",
              index: data.index ?? 0,
            },
          ],
          isEnd: false,
        };
      }
      if (data.content_block.type === "thinking") {
        return {
          content: "",
          reasoning: data.content_block.thinking || "",
          isEnd: false,
        };
      }
      return {
        content: data.content_block.text || "",
        isEnd: false,
      };
    }
    if (data.type === "content_block_delta") {
      if (data.delta.type === "input_json_delta") {
        return {
          content: "",
          toolCalls: [
            {
              args: data.delta.partial_json || "",
              index: data.index ?? 0,
            },
          ],
        };
      }
      if (data.delta.type === "thinking_delta") {
        return {
          content: "",
          reasoning: data.delta.thinking || "",
          isEnd: false,
        };
      }
      return {
        content: data.delta.text || "",
        isEnd: false,
      };
    }
    if (data.type === "message_start") {
      return {
        content: "",
        isEnd: false,
        inputTokens: data.message?.usage?.input_tokens,
        outputTokens: data.message?.usage?.output_tokens,
      };
    }
    if (data.type === "message_delta") {
      return {
        content: "",
        isEnd: false,
        outputTokens: data.usage?.output_tokens,
      };
    }
    if (data.type === "message_stop") {
      return {
        content: "",
        isEnd: true,
      };
    }
    if (data.type === "error") {
      return {
        content: "",
        isEnd: true,
        error: {
          type: data.error?.type || "unknown",
          message: data.error?.message || "Unknown error",
        },
      };
    }
    return {
      content: "",
      isEnd: false,
    };
  }
}
