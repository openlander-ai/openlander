import type { LLMClient, ChatMessage, LLMResponse, ToolCall } from './index.js';
import type { ToolDefinition } from '../agent/tools.js';
import { LLMProviderError } from '../errors.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

type AnthropicRole = 'user' | 'assistant';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicTextBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
}

interface AnthropicErrorResponse {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

interface AnthropicSuccessResponse {
  content: AnthropicContentBlock[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAnthropicErrorResponse(
  value: AnthropicSuccessResponse | AnthropicErrorResponse,
): value is AnthropicErrorResponse {
  return 'type' in value;
}

export class AnthropicProvider implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private tools: ToolDefinition[] = [];

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.apiKey = apiKey;
    this.model = model;
  }

  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const { anthropicMessages, system } = this.convertMessages(messages);
    const anthropicTools = this.convertTools();

    const body: AnthropicRequest = {
      model: this.model,
      max_tokens: 4096,
      messages: anthropicMessages,
    };

    if (system) {
      body.system = system;
    }

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools;
    }

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('anthropic', `Request failed: ${message}`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new LLMProviderError('anthropic', `HTTP ${String(response.status)}: ${text}`);
    }

    let data: AnthropicSuccessResponse | AnthropicErrorResponse;
    try {
      data = (await response.json()) as AnthropicSuccessResponse | AnthropicErrorResponse;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LLMProviderError('anthropic', `Invalid JSON response: ${message}`);
    }

    if (isAnthropicErrorResponse(data)) {
      throw new LLMProviderError('anthropic', `${data.error.type}: ${data.error.message}`);
    }

    if (!Array.isArray(data.content)) {
      throw new LLMProviderError('anthropic', 'Missing content blocks in response');
    }

    return this.parseResponse(data.content);
  }

  private convertMessages(messages: ChatMessage[]): {
    anthropicMessages: AnthropicMessage[];
    system: string | null;
  } {
    let system: string | null = null;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        system = (system ?? '') + message.content;
        continue;
      }

      anthropicMessages.push({
        role: message.role,
        content: [{ type: 'text', text: message.content }],
      });
    }

    return { anthropicMessages, system };
  }

  private convertTools(): AnthropicTool[] {
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
        name: tool.name,
        description: tool.description,
        input_schema: {
          type: 'object',
          properties,
          required,
        },
      };
    });
  }

  private parseResponse(contentBlocks: AnthropicContentBlock[]): LLMResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        content += block.text;
        continue;
      }

      if (!isRecord(block.input)) {
        throw new LLMProviderError('anthropic', `Invalid tool input for tool ${block.name}`);
      }

      toolCalls.push({
        name: block.name,
        arguments: block.input,
      });
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
