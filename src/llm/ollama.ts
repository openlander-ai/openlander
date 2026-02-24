import type { LLMClient, ChatMessage, LLMResponse, ToolCall } from './index.js';
import type { ToolDefinition } from '../agent/tools.js';
import { LLMProviderError } from '../errors.js';

const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

interface OllamaToolSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

interface OllamaFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: OllamaToolSchema;
  };
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: unknown;
  };
}

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaFunctionTool[];
  stream: false;
}

interface OllamaResponse {
  message?: OllamaMessage;
  error?: string;
}

export class OllamaProvider implements LLMClient {
  private readonly model: string;
  private readonly baseUrl: string;
  private tools: ToolDefinition[] = [];

  constructor(model = 'llama3.2', baseUrl = OLLAMA_DEFAULT_BASE_URL) {
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const body: OllamaRequest = {
      model: this.model,
      messages: this.convertMessages(messages),
      stream: false,
    };

    const requestTools = this.convertTools();
    if (requestTools.length > 0) {
      body.tools = requestTools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LLMProviderError('ollama', `HTTP ${String(response.status)}: ${text}`);
      }

      const data = (await response.json()) as OllamaResponse;
      if (data.error) {
        throw new LLMProviderError('ollama', data.error);
      }

      if (!data.message) {
        throw new LLMProviderError('ollama', 'No message in response');
      }

      return this.parseResponse(data.message);
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      throw new LLMProviderError(
        'ollama',
        error instanceof Error ? error.message : 'Unknown Ollama provider error',
      );
    }
  }

  private convertMessages(messages: ChatMessage[]): OllamaMessage[] {
    return messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  private convertTools(): OllamaFunctionTool[] {
    return this.tools.map((tool) => {
      const properties: Record<string, { type: string; description: string }> = {};
      const required: string[] = [];

      for (const [paramName, param] of Object.entries(tool.parameters)) {
        properties[paramName] = {
          type: param.type,
          description: param.description,
        };

        if (param.required) {
          required.push(paramName);
        }
      }

      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties,
            required,
          },
        },
      };
    });
  }

  private parseResponse(message: OllamaMessage): LLMResponse {
    const toolCalls: ToolCall[] | undefined = message.tool_calls?.map((toolCall) => ({
      name: toolCall.function.name,
      arguments: this.parseToolArguments(toolCall.function.arguments),
    }));

    return {
      content: message.content,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private parseToolArguments(args: unknown): Record<string, unknown> {
    if (typeof args === 'string') {
      try {
        const parsed = JSON.parse(args) as unknown;
        if (this.isRecord(parsed)) {
          return parsed;
        }
        throw new LLMProviderError('ollama', 'Tool call arguments must parse to an object');
      } catch (error) {
        if (error instanceof LLMProviderError) {
          throw error;
        }
        throw new LLMProviderError(
          'ollama',
          error instanceof Error
            ? `Invalid tool call arguments JSON: ${error.message}`
            : 'Invalid tool call arguments JSON',
        );
      }
    }

    if (this.isRecord(args)) {
      return args;
    }

    throw new LLMProviderError(
      'ollama',
      'Tool call arguments must be an object or JSON object string',
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
