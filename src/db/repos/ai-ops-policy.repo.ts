import { and, eq, gte, sql, type SQL } from 'drizzle-orm';

import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  aiOpsDedupe,
  aiOpsInstancePolicy,
  aiOpsProjectPolicies,
  aiOpsServiceOverrides,
  aiUsageLog,
} from '../schema.drizzle.js';
import type {
  AiOpsDedupeRow,
  AiOpsInstancePolicyRow,
  AiOpsProjectMode,
  AiOpsProjectPolicyRow,
  AiOpsServiceOverrideMode,
  AiOpsServiceOverrideRow,
} from '../types.js';
import { RepoPersistenceError } from '../../errors.js';
import {
  AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES,
  AI_OPS_DEFAULT_INSTANCE_DAILY_BRIEFING_LIMIT,
  AI_OPS_DEFAULT_PROJECT_DAILY_BRIEFING_LIMIT,
  AI_OPS_DEFAULT_PROJECT_MODE,
  AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE,
  buildAiOpsDedupeKey,
  evaluateAiOpsBriefingBudget,
  resolveAiOpsMode,
  startOfUtcDay,
  type AiOpsBudgetDecision,
  type ResolvedAiOpsPolicy,
} from '../../monitor/ai-ops-policy.js';

interface SetInstancePolicyInput {
  dailyBriefingLimit?: number;
  fingerprintCooldownMinutes?: number;
}

interface SetProjectPolicyInput extends SetInstancePolicyInput {
  mode?: AiOpsProjectMode;
}

interface SetServiceOverrideInput {
  mode?: AiOpsServiceOverrideMode;
}

interface ClaimDedupeWindowInput {
  projectId: string;
  serviceId?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
  fingerprint: string;
  cooldownMinutes?: number;
  briefingId?: string | null;
  now?: Date;
}

export interface ClaimDedupeWindowResult {
  status: 'created' | 'refreshed' | 'suppressed';
  dedupe: AiOpsDedupeRow;
}

export interface BudgetStatus {
  projectUsed: number;
  projectLimit: number;
  instanceUsed: number;
  instanceLimit: number;
  decision: AiOpsBudgetDecision;
}

function defaultInstancePolicy(): AiOpsInstancePolicyRow {
  const now = new Date().toISOString();
  return {
    id: 1,
    daily_briefing_limit: AI_OPS_DEFAULT_INSTANCE_DAILY_BRIEFING_LIMIT,
    fingerprint_cooldown_minutes: AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES,
    created_at: now,
    updated_at: now,
  };
}

function defaultProjectPolicy(projectId: string): AiOpsProjectPolicyRow {
  const now = new Date().toISOString();
  return {
    project_id: projectId,
    mode: AI_OPS_DEFAULT_PROJECT_MODE,
    daily_briefing_limit: AI_OPS_DEFAULT_PROJECT_DAILY_BRIEFING_LIMIT,
    fingerprint_cooldown_minutes: AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES,
    created_at: now,
    updated_at: now,
  };
}

function defaultServiceOverride(serviceId: string): AiOpsServiceOverrideRow {
  const now = new Date().toISOString();
  return {
    service_id: serviceId,
    mode: AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE,
    created_at: now,
    updated_at: now,
  };
}

function definedPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export class AiOpsPolicyRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async getInstancePolicy(): Promise<AiOpsInstancePolicyRow> {
    const row =
      (
        await this.db
          .select()
          .from(aiOpsInstancePolicy)
          .where(eq(aiOpsInstancePolicy.id, 1))
          .limit(1)
      )[0] ?? null;

    return row ?? defaultInstancePolicy();
  }

  async setInstancePolicy(input: SetInstancePolicyInput): Promise<AiOpsInstancePolicyRow> {
    const values = {
      id: 1,
      daily_briefing_limit:
        input.dailyBriefingLimit ?? AI_OPS_DEFAULT_INSTANCE_DAILY_BRIEFING_LIMIT,
      fingerprint_cooldown_minutes:
        input.fingerprintCooldownMinutes ?? AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES,
    };
    const set = definedPatch({
      daily_briefing_limit: input.dailyBriefingLimit,
      fingerprint_cooldown_minutes: input.fingerprintCooldownMinutes,
      updated_at: sql`now()::text`,
    });

    const [row] = await this.db
      .insert(aiOpsInstancePolicy)
      .values(values)
      .onConflictDoUpdate({
        target: aiOpsInstancePolicy.id,
        set,
      })
      .returning();

    return row ?? this.getInstancePolicy();
  }

  async getProjectPolicy(projectId: string): Promise<AiOpsProjectPolicyRow> {
    const row =
      (
        await this.db
          .select()
          .from(aiOpsProjectPolicies)
          .where(eq(aiOpsProjectPolicies.project_id, projectId))
          .limit(1)
      )[0] ?? null;

    return row ?? defaultProjectPolicy(projectId);
  }

  async setProjectPolicy(
    projectId: string,
    input: SetProjectPolicyInput,
  ): Promise<AiOpsProjectPolicyRow> {
    const values = {
      project_id: projectId,
      mode: input.mode ?? AI_OPS_DEFAULT_PROJECT_MODE,
      daily_briefing_limit: input.dailyBriefingLimit ?? AI_OPS_DEFAULT_PROJECT_DAILY_BRIEFING_LIMIT,
      fingerprint_cooldown_minutes:
        input.fingerprintCooldownMinutes ?? AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES,
    };
    const set = definedPatch({
      mode: input.mode,
      daily_briefing_limit: input.dailyBriefingLimit,
      fingerprint_cooldown_minutes: input.fingerprintCooldownMinutes,
      updated_at: sql`now()::text`,
    });

    const [row] = await this.db
      .insert(aiOpsProjectPolicies)
      .values(values)
      .onConflictDoUpdate({
        target: aiOpsProjectPolicies.project_id,
        set,
      })
      .returning();

    return row ?? this.getProjectPolicy(projectId);
  }

  async getServiceOverride(serviceId: string): Promise<AiOpsServiceOverrideRow> {
    const row =
      (
        await this.db
          .select()
          .from(aiOpsServiceOverrides)
          .where(eq(aiOpsServiceOverrides.service_id, serviceId))
          .limit(1)
      )[0] ?? null;

    return row ?? defaultServiceOverride(serviceId);
  }

  async setServiceOverride(
    serviceId: string,
    input: SetServiceOverrideInput,
  ): Promise<AiOpsServiceOverrideRow> {
    const values = {
      service_id: serviceId,
      mode: input.mode ?? AI_OPS_DEFAULT_SERVICE_OVERRIDE_MODE,
    };
    const set = definedPatch({
      mode: input.mode,
      updated_at: sql`now()::text`,
    });

    const [row] = await this.db
      .insert(aiOpsServiceOverrides)
      .values(values)
      .onConflictDoUpdate({
        target: aiOpsServiceOverrides.service_id,
        set,
      })
      .returning();

    return row ?? this.getServiceOverride(serviceId);
  }

  async resolveServicePolicy(
    projectId: string,
    serviceId?: string | null,
  ): Promise<ResolvedAiOpsPolicy> {
    const projectPolicy = await this.getProjectPolicy(projectId);
    const override = serviceId ? await this.getServiceOverride(serviceId) : null;
    return resolveAiOpsMode(projectPolicy.mode, override?.mode);
  }

  async getBriefingBudgetStatus(projectId: string, now: Date = new Date()): Promise<BudgetStatus> {
    const [projectPolicy, instancePolicy] = await Promise.all([
      this.getProjectPolicy(projectId),
      this.getInstancePolicy(),
    ]);
    const sinceIso = startOfUtcDay(now).toISOString();
    const [projectUsed, instanceUsed] = await Promise.all([
      this.countBriefingUsage({ projectId, sinceIso }),
      this.countBriefingUsage({ sinceIso }),
    ]);
    const projectLimit = projectPolicy.daily_briefing_limit;
    const instanceLimit = instancePolicy.daily_briefing_limit;

    return {
      projectUsed,
      projectLimit,
      instanceUsed,
      instanceLimit,
      decision: evaluateAiOpsBriefingBudget({
        projectUsed,
        projectLimit,
        instanceUsed,
        instanceLimit,
      }),
    };
  }

  async getDedupeByKey(dedupeKey: string): Promise<AiOpsDedupeRow | null> {
    const row =
      (
        await this.db
          .select()
          .from(aiOpsDedupe)
          .where(eq(aiOpsDedupe.dedupe_key, dedupeKey))
          .limit(1)
      )[0] ?? null;
    return row;
  }

  private async updateCoolingDedupe(
    existing: AiOpsDedupeRow,
    input: ClaimDedupeWindowInput,
    nowIso: string,
  ): Promise<ClaimDedupeWindowResult> {
    const [updated] = await this.db
      .update(aiOpsDedupe)
      .set({
        last_seen_at: nowIso,
        occurrences: existing.occurrences + 1,
        last_briefing_id: input.briefingId ?? existing.last_briefing_id,
      })
      .where(eq(aiOpsDedupe.dedupe_key, existing.dedupe_key))
      .returning();

    return { status: 'suppressed', dedupe: updated ?? existing };
  }

  private async refreshExpiredDedupe(
    existing: AiOpsDedupeRow,
    input: ClaimDedupeWindowInput,
    nowIso: string,
    cooldownUntil: string,
  ): Promise<ClaimDedupeWindowResult> {
    const [updated] = await this.db
      .update(aiOpsDedupe)
      .set({
        last_seen_at: nowIso,
        cooldown_until: cooldownUntil,
        occurrences: existing.occurrences + 1,
        last_briefing_id: input.briefingId ?? existing.last_briefing_id,
      })
      .where(eq(aiOpsDedupe.dedupe_key, existing.dedupe_key))
      .returning();

    return { status: 'refreshed', dedupe: updated ?? existing };
  }

  async attachDedupeBriefing(dedupeKey: string, briefingId: string): Promise<void> {
    await this.db
      .update(aiOpsDedupe)
      .set({ last_briefing_id: briefingId })
      .where(eq(aiOpsDedupe.dedupe_key, dedupeKey));
  }

  async claimDedupeWindow(input: ClaimDedupeWindowInput): Promise<ClaimDedupeWindowResult> {
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const cooldownMinutes = input.cooldownMinutes ?? AI_OPS_DEFAULT_FINGERPRINT_COOLDOWN_MINUTES;
    const cooldownUntil = new Date(now.getTime() + cooldownMinutes * 60_000).toISOString();
    const dedupeKey = buildAiOpsDedupeKey(input);
    const existing = await this.getDedupeByKey(dedupeKey);

    if (existing && Date.parse(existing.cooldown_until) > now.getTime()) {
      return this.updateCoolingDedupe(existing, input, nowIso);
    }

    if (existing) {
      return this.refreshExpiredDedupe(existing, input, nowIso, cooldownUntil);
    }

    const [created] = await this.db
      .insert(aiOpsDedupe)
      .values({
        id: crypto.randomUUID(),
        dedupe_key: dedupeKey,
        project_id: input.projectId,
        service_id: input.serviceId ?? null,
        resource_kind: input.resourceKind ?? null,
        resource_id: input.resourceId ?? null,
        fingerprint: input.fingerprint,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        cooldown_until: cooldownUntil,
        occurrences: 1,
        last_briefing_id: input.briefingId ?? null,
      })
      .onConflictDoNothing({ target: aiOpsDedupe.dedupe_key })
      .returning();

    if (!created) {
      const row = await this.getDedupeByKey(dedupeKey);
      if (row && Date.parse(row.cooldown_until) > now.getTime()) {
        return this.updateCoolingDedupe(row, input, nowIso);
      }
      if (row) {
        return this.refreshExpiredDedupe(row, input, nowIso, cooldownUntil);
      }
      throw new RepoPersistenceError('ai ops dedupe', dedupeKey);
    }

    return { status: 'created', dedupe: created };
  }

  private async countBriefingUsage(input: {
    projectId?: string;
    sinceIso: string;
  }): Promise<number> {
    const conditions: SQL[] = [
      eq(aiUsageLog.feature, 'ai_ops_briefing'),
      gte(aiUsageLog.created_at, input.sinceIso),
    ];
    if (input.projectId) {
      conditions.push(eq(aiUsageLog.project_id, input.projectId));
    }

    const row =
      (
        await this.db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(aiUsageLog)
          .where(and(...conditions))
          .limit(1)
      )[0] ?? null;

    return row?.count ?? 0;
  }
}
