export interface ITool {
  id: string;
  name: string;
  args?: any;
  rawFunctionCall?: Record<string, any>;
}

export interface IReadResult {
  content: string;
  reasoning?: string;
  tools: ITool[];
  inputTokens?: number;
  outputTokens?: number;
}
export default interface IChatReader {
  read({
    onError,
    onProgress,
    onToolCalls,
  }: {
    onError: (error: any) => void;
    onProgress: (chunk: string, reasoning?: string) => void;
    onToolCalls: (toolName: string | null) => void;
  }): Promise<IReadResult>;
}
