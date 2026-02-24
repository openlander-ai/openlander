import type { LLMClient, ChatMessage, LLMResponse, ToolCall } from './index.js';
import type { ToolDefinition } from '../agent/tools.js';
import { LLMProviderError } from '../errors.js';

/**
 * Google Gemini LLM provider via raw REST API.
 *
 * Uses gemini-2.0-flash by default (free tier available).
 * Supports function calling for agent tool use.
 *
 * No SDK dependency — direct HTTP calls only.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// --- Gemini API types ---

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model' | 'function';
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

interface GeminiRequest {
  contents: GeminiContent[];
  tools?: Array<{ function_declarations: GeminiFunctionDeclaration[] }>;
  system_instruction?: { parts: Array<{ text: string }> };
}

interface GeminiResponse {
  candidates?: Array<{
    content: {
      parts: GeminiPart[];
      role: string;
    };
    finishReason: string;
  }>;
  error?: {
    code: number;
    message: string;
    status: string;
  };
}

// --- Provider ---

export class GeminiProvider implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private tools: ToolDefinition[] = [];

  constructor(apiKey: string, model = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /** Register tools that the LLM can call. */
  setTools(tools: ToolDefinition[]): void {
    this.tools = tools;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    const { contents, systemInstruction } = this.convertMessages(messages);
    const toolDeclarations = this.convertTools();

    const body: GeminiRequest = { contents };

    if (systemInstruction) {
      body.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    if (toolDeclarations.length > 0) {
      body.tools = [{ function_declarations: toolDeclarations }];
    }

    const url = `${GEMINI_API_BASE}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new LLMProviderError('gemini', `HTTP ${String(response.status)}: ${text}`);
    }

    const data = (await response.json()) as GeminiResponse;

    if (data.error) {
      throw new LLMProviderError('gemini', `${data.error.status}: ${data.error.message}`);
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw new LLMProviderError('gemini', 'No candidates in response');
    }

    return this.parseResponse(candidate.content.parts);
  }

  // --- Conversion helpers ---

  private convertMessages(messages: ChatMessage[]): {
    contents: GeminiContent[];
    systemInstruction: string | null;
  } {
    let systemInstruction: string | null = null;
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini uses system_instruction instead of system role in contents
        systemInstruction = (systemInstruction ?? '') + msg.content;
        continue;
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    return { contents, systemInstruction };
  }

  private convertTools(): GeminiFunctionDeclaration[] {
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
        parameters: {
          type: 'object' as const,
          properties,
          required,
        },
      };
    });
  }

  private parseResponse(parts: GeminiPart[]): LLMResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          arguments: part.functionCall.args,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
