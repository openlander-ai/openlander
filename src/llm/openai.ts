import type { LLMClient, ChatMessage, LLMResponse, ToolCall } from './index.js';
import type { ToolDefinition } from '../agent/tools.js';
import { LLMProviderError } from '../errors.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIFunctionTool {
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

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAIFunctionTool[];
}

interface OpenAIResponse {
  choices?: Array<{
    message: OpenAIMessage;
    finish_reason: string | null;
  }>;
  error?: {
    message: string;
    type: string;
    code?: string;
  };
}

export class OpenAIProvider implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private tools: ToolDefinition[] = [];

  constructor(apiKey: string, model = 'gpt-4o') {
    this.apiKey = apiKey;
    this.model = model;
  }

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const body: OpenAIRequest = {
      model: this.model,
      messages: this.convertMessages(messages),
    };

    const openAITools = this.convertTools();
    if (openAITools.length > 0) {
      body.tools = openAITools;
    }

    let response: Response;
    try {
      response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('openai', `Request failed: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LLMProviderError('openai', `HTTP ${String(response.status)}: ${text}`);
    }

    let data: OpenAIResponse;
    try {
      data = (await response.json()) as OpenAIResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('openai', `Invalid JSON response: ${message}`);
    }

    if (data.error) {
      throw new LLMProviderError('openai', `${data.error.type}: ${data.error.message}`);
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new LLMProviderError('openai', 'No choices in response');
    }

    return this.parseResponse(choice.message);
  }

  private convertMessages(messages: ChatMessage[]): OpenAIMessage[] {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  private convertTools(): OpenAIFunctionTool[] {
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

  private parseResponse(message: OpenAIMessage): LLMResponse {
    const toolCalls = this.parseToolCalls(message.tool_calls);

    return {
      content: message.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private parseToolCalls(toolCalls: OpenAIToolCall[] | undefined): ToolCall[] {
    if (!toolCalls || toolCalls.length === 0) {
      return [];
    }

    return toolCalls.map((toolCall) => {
      let parsedArguments: unknown;

      try {
        parsedArguments = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LLMProviderError(
          'openai',
          `Invalid tool arguments for ${toolCall.function.name}: ${message}`,
        );
      }

      if (
        !parsedArguments ||
        typeof parsedArguments !== 'object' ||
        Array.isArray(parsedArguments)
      ) {
        throw new LLMProviderError(
          'openai',
          `Tool arguments for ${toolCall.function.name} must be a JSON object`,
        );
      }

      return {
        name: toolCall.function.name,
        arguments: parsedArguments as Record<string, unknown>,
      };
    });
  }
}
