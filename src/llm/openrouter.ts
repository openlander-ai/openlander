import type { LLMClient, ChatMessage, LLMResponse, ToolCall } from './index.js';
import type { ToolDefinition } from '../agent/tools.js';
import { LLMProviderError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('openrouter');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenAICompatibleTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

interface OpenAICompatibleRequest {
  model: string;
  messages: Array<{ role: ChatMessage['role']; content: string }>;
  tools?: OpenAICompatibleTool[];
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      role: string;
      content?: string | null;
      tool_calls?: Array<{
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class OpenRouterProvider implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private tools: ToolDefinition[] = [];

  constructor(apiKey: string, model = 'google/gemini-2.0-flash-exp:free') {
    this.apiKey = apiKey;
    this.model = model;
  }

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const body: OpenAICompatibleRequest = {
      model: this.model,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
    };

    const openAITools = this.convertTools();
    if (openAITools.length > 0) {
      body.tools = openAITools;
    }

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://openlander.dev',
          'X-Title': 'OpenLander',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new LLMProviderError('openrouter', `HTTP ${String(response.status)}: ${text}`);
      }

      const data = (await response.json()) as OpenAICompatibleResponse;

      if (data.error) {
        const errorMessage = data.error.message ?? 'Unknown OpenRouter error';
        throw new LLMProviderError('openrouter', errorMessage);
      }

      const message = data.choices?.[0]?.message;
      if (!message) {
        throw new LLMProviderError('openrouter', 'No message in response');
      }

      return this.parseResponse(message);
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }
      throw new LLMProviderError(
        'openrouter',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private convertTools(): OpenAICompatibleTool[] {
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

  private parseResponse(message: {
    role: string;
    content?: string | null;
    tool_calls?: Array<{
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }): LLMResponse {
    const toolCalls: ToolCall[] = [];

    for (const toolCall of message.tool_calls ?? []) {
      let parsedArguments: unknown;
      try {
        parsedArguments = JSON.parse(toolCall.function.arguments);
      } catch (err) {
        log.debug({ err, tool: toolCall.function.name }, 'Failed to parse tool arguments JSON');
        throw new LLMProviderError(
          'openrouter',
          `Invalid JSON arguments for tool ${toolCall.function.name}`,
        );
      }

      if (!isRecord(parsedArguments)) {
        throw new LLMProviderError(
          'openrouter',
          `Tool arguments must be an object for tool ${toolCall.function.name}`,
        );
      }

      toolCalls.push({
        name: toolCall.function.name,
        arguments: parsedArguments,
      });
    }

    return {
      content: message.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
