import { AsyncLocalStorage } from 'node:async_hooks';
import { wrapLanguageModel } from 'ai';
import type { LanguageModel, LanguageModelMiddleware } from 'ai';
import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3CallOptions,
  LanguageModelV3,
} from '@ai-sdk/provider';
import type { EventBus } from '../events/index.js';
import { extractUsageFromResult, calculateCost } from './transparency.js';
import { classifyLlmError, sanitizeLlmErrorMessage } from './llm-error-types.js';
import type { LlmErrorType } from './llm-error-types.js';

export interface TrackingContext {
  projectId?: string;
  serviceId?: string;
  feature?: string;
  briefingId?: string;
  sessionId?: string;
  actionType?: string;
  source?: string;
  toolsCalled?: string[];
}

interface AiUsagePayload {
  modelName: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  durationMs: number;
  result: 'success' | 'failure';
  projectId?: string;
  serviceId?: string;
  feature?: string;
  briefingId?: string;
  sessionId?: string;
  actionType?: string;
  source?: string;
  toolsCalled?: string[];
  errorMessage?: string;
  errorType?: LlmErrorType;
}

const trackingStore = new AsyncLocalStorage<TrackingContext>();

export function withTracking<T>(ctx: TrackingContext, fn: () => Promise<T>): Promise<T> {
  return trackingStore.run(ctx, fn);
}

export function createTrackingMiddleware(
  eventBus: EventBus,
  provider: string,
  modelName: string,
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async (options: {
      doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV3StreamResult>;
      params: LanguageModelV3CallOptions;
      model: LanguageModelV3;
    }) => {
      const startedAt = Date.now();
      const ctx = trackingStore.getStore();

      try {
        const result = await options.doGenerate();
        const usage = extractUsageFromResult(result.usage);
        const costUsd = calculateCost(provider, modelName, usage.inputTokens, usage.outputTokens);

        const payload: AiUsagePayload = {
          modelName,
          provider,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          costUsd,
          durationMs: Date.now() - startedAt,
          result: 'success',
          projectId: ctx?.projectId,
          serviceId: ctx?.serviceId,
          feature: ctx?.feature,
          briefingId: ctx?.briefingId,
          sessionId: ctx?.sessionId,
          actionType: ctx?.actionType ?? 'system',
          source: ctx?.source ?? 'auto',
          toolsCalled: ctx?.toolsCalled,
        };

        void eventBus.emit('ai:usage' as never, payload as never);

        return result;
      } catch (error) {
        const errorType = classifyLlmError(error);
        const rawMessage = error instanceof Error ? error.message : String(error);
        const errorMessage = sanitizeLlmErrorMessage(rawMessage);

        const payload: AiUsagePayload = {
          modelName,
          provider,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: null,
          durationMs: Date.now() - startedAt,
          result: 'failure',
          projectId: ctx?.projectId,
          serviceId: ctx?.serviceId,
          feature: ctx?.feature,
          briefingId: ctx?.briefingId,
          sessionId: ctx?.sessionId,
          actionType: ctx?.actionType ?? 'system',
          source: ctx?.source ?? 'auto',
          toolsCalled: ctx?.toolsCalled,
          errorMessage,
          errorType,
        };

        void eventBus.emit('ai:usage' as never, payload as never);

        throw error;
      }
    },

    wrapStream: async (options: {
      doGenerate: () => PromiseLike<LanguageModelV3GenerateResult>;
      doStream: () => PromiseLike<LanguageModelV3StreamResult>;
      params: LanguageModelV3CallOptions;
      model: LanguageModelV3;
    }) => {
      const startedAt = Date.now();
      const ctx = trackingStore.getStore();
      let inputTokens = 0;
      let outputTokens = 0;
      let usageEmitted = false;

      const emitUsage = (result: 'success' | 'failure', error?: unknown) => {
        if (usageEmitted) return;
        usageEmitted = true;

        const totalTokens = inputTokens + outputTokens;
        const costUsd = calculateCost(provider, modelName, inputTokens, outputTokens);

        const payload: AiUsagePayload = {
          modelName,
          provider,
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd,
          durationMs: Date.now() - startedAt,
          result,
          projectId: ctx?.projectId,
          serviceId: ctx?.serviceId,
          feature: ctx?.feature,
          briefingId: ctx?.briefingId,
          sessionId: ctx?.sessionId,
          actionType: ctx?.actionType ?? 'system',
          source: ctx?.source ?? 'auto',
          toolsCalled: ctx?.toolsCalled,
        };

        if (error) {
          payload.errorType = classifyLlmError(error);
          const rawMessage =
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : JSON.stringify(error);
          payload.errorMessage = sanitizeLlmErrorMessage(rawMessage);
        }

        void eventBus.emit('ai:usage' as never, payload as never);
      };

      try {
        const streamResult = await options.doStream();

        const transformer = {
          transform(
            chunk: { type: string; usage?: Record<string, unknown> },
            controller: TransformStreamDefaultController,
          ) {
            if (chunk.type === 'finish') {
              const usage = extractUsageFromResult(chunk.usage);
              inputTokens = usage.inputTokens;
              outputTokens = usage.outputTokens;
            }
            controller.enqueue(chunk);
          },
          flush() {
            emitUsage('success');
          },
        };
        // WHATWG Streams spec supports cancel() but TS Transformer type omits it
        Object.assign(transformer, {
          cancel() {
            emitUsage('failure');
          },
        });
        const transformedStream = streamResult.stream.pipeThrough(new TransformStream(transformer));

        return { ...streamResult, stream: transformedStream };
      } catch (error) {
        emitUsage('failure', error);
        throw error;
      }
    },
  };
}

export function withTrackingMiddleware(
  model: LanguageModel,
  eventBus: EventBus,
  provider: string,
  modelName: string,
): LanguageModel {
  return wrapLanguageModel({
    model: model as LanguageModelV3,
    middleware: createTrackingMiddleware(eventBus, provider, modelName),
  });
}
