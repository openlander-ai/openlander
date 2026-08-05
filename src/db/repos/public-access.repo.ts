import { eq } from 'drizzle-orm';

import { RepoPersistenceError } from '../../errors.js';
import type { DrizzleClient, PostgresClient } from '../drizzle.js';
import {
  cloudflareConnections,
  projectPublicAccess,
  type CloudflareConnectionRow,
  type ProjectPublicAccessRow,
} from '../schema.drizzle.js';

export const CLOUDFLARE_CONNECTION_ID = 'cloudflare';

export interface CloudflareConnectionInput {
  accountId: string;
  accountName?: string | null;
  zoneId: string;
  zoneName: string;
  tunnelId: string;
  tunnelName: string;
  encryptedTunnelToken: string;
  tunnelTokenIv: string;
  connectorContainerId?: string | null;
}

export interface CloudflareConnectionPatch {
  status?: CloudflareConnectionRow['status'];
  connectorContainerId?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface ProjectPublicAccessInput {
  projectId: string;
  serviceId: string | null;
  hostname: string;
  cloudflareZoneId: string;
  cloudflareDnsRecordId?: string | null;
  domainMappingId?: string | null;
  status?: ProjectPublicAccessRow['status'];
}

export interface ProjectPublicAccessPatch {
  serviceId?: string | null;
  connectionId?: string | null;
  hostname?: string;
  cloudflareZoneId?: string;
  cloudflareDnsRecordId?: string | null;
  domainMappingId?: string | null;
  status?: ProjectPublicAccessRow['status'];
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  publishedAt?: string | null;
}

export class PublicAccessRepo {
  constructor(
    private readonly db: DrizzleClient,
    private readonly client: PostgresClient,
  ) {
    void this.client;
  }

  async getCloudflareConnection(): Promise<CloudflareConnectionRow | null> {
    const [row] = await this.db
      .select()
      .from(cloudflareConnections)
      .where(eq(cloudflareConnections.id, CLOUDFLARE_CONNECTION_ID))
      .limit(1);
    return row ?? null;
  }

  async upsertCloudflareConnection(
    input: CloudflareConnectionInput,
  ): Promise<CloudflareConnectionRow> {
    const updatedAt = new Date().toISOString();
    const [row] = await this.db
      .insert(cloudflareConnections)
      .values({
        id: CLOUDFLARE_CONNECTION_ID,
        account_id: input.accountId,
        account_name: input.accountName ?? null,
        zone_id: input.zoneId,
        zone_name: input.zoneName,
        tunnel_id: input.tunnelId,
        tunnel_name: input.tunnelName,
        encrypted_tunnel_token: input.encryptedTunnelToken,
        tunnel_token_iv: input.tunnelTokenIv,
        status: 'connected',
        connector_container_id: input.connectorContainerId ?? null,
        last_error_code: null,
        last_error_message: null,
        updated_at: updatedAt,
      })
      .onConflictDoUpdate({
        target: cloudflareConnections.id,
        set: {
          account_id: input.accountId,
          account_name: input.accountName ?? null,
          zone_id: input.zoneId,
          zone_name: input.zoneName,
          tunnel_id: input.tunnelId,
          tunnel_name: input.tunnelName,
          encrypted_tunnel_token: input.encryptedTunnelToken,
          tunnel_token_iv: input.tunnelTokenIv,
          status: 'connected',
          connector_container_id: input.connectorContainerId ?? null,
          last_error_code: null,
          last_error_message: null,
          updated_at: updatedAt,
        },
      })
      .returning();

    if (!row) throw new RepoPersistenceError('Cloudflare connection', CLOUDFLARE_CONNECTION_ID);
    return row;
  }

  async updateCloudflareConnection(
    patch: CloudflareConnectionPatch,
  ): Promise<CloudflareConnectionRow | null> {
    const setValues: Partial<typeof cloudflareConnections.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) setValues.status = patch.status;
    if (patch.connectorContainerId !== undefined) {
      setValues.connector_container_id = patch.connectorContainerId;
    }
    if (patch.lastErrorCode !== undefined) setValues.last_error_code = patch.lastErrorCode;
    if (patch.lastErrorMessage !== undefined) setValues.last_error_message = patch.lastErrorMessage;

    const [row] = await this.db
      .update(cloudflareConnections)
      .set(setValues)
      .where(eq(cloudflareConnections.id, CLOUDFLARE_CONNECTION_ID))
      .returning();
    return row ?? null;
  }

  async deleteCloudflareConnection(): Promise<boolean> {
    const deleted = await this.db
      .delete(cloudflareConnections)
      .where(eq(cloudflareConnections.id, CLOUDFLARE_CONNECTION_ID))
      .returning({ id: cloudflareConnections.id });
    return deleted.length > 0;
  }

  async getProjectPublicAccess(projectId: string): Promise<ProjectPublicAccessRow | null> {
    const [row] = await this.db
      .select()
      .from(projectPublicAccess)
      .where(eq(projectPublicAccess.project_id, projectId))
      .limit(1);
    return row ?? null;
  }

  async getProjectPublicAccessByHostname(hostname: string): Promise<ProjectPublicAccessRow | null> {
    const [row] = await this.db
      .select()
      .from(projectPublicAccess)
      .where(eq(projectPublicAccess.hostname, hostname))
      .limit(1);
    return row ?? null;
  }

  listProjectPublicAccess(): Promise<ProjectPublicAccessRow[]> {
    return this.db.select().from(projectPublicAccess);
  }

  async upsertProjectPublicAccess(
    input: ProjectPublicAccessInput,
  ): Promise<ProjectPublicAccessRow> {
    const updatedAt = new Date().toISOString();
    const [row] = await this.db
      .insert(projectPublicAccess)
      .values({
        project_id: input.projectId,
        service_id: input.serviceId,
        connection_id: CLOUDFLARE_CONNECTION_ID,
        hostname: input.hostname,
        cloudflare_zone_id: input.cloudflareZoneId,
        cloudflare_dns_record_id: input.cloudflareDnsRecordId ?? null,
        domain_mapping_id: input.domainMappingId ?? null,
        status: input.status ?? 'private',
        updated_at: updatedAt,
      })
      .onConflictDoUpdate({
        target: projectPublicAccess.project_id,
        set: {
          service_id: input.serviceId,
          connection_id: CLOUDFLARE_CONNECTION_ID,
          hostname: input.hostname,
          cloudflare_zone_id: input.cloudflareZoneId,
          cloudflare_dns_record_id: input.cloudflareDnsRecordId ?? null,
          domain_mapping_id: input.domainMappingId ?? null,
          status: input.status ?? 'private',
          updated_at: updatedAt,
        },
      })
      .returning();
    if (!row) throw new RepoPersistenceError('Project public access', input.projectId);
    return row;
  }

  async updateProjectPublicAccess(
    projectId: string,
    patch: ProjectPublicAccessPatch,
  ): Promise<ProjectPublicAccessRow | null> {
    const setValues: Partial<typeof projectPublicAccess.$inferInsert> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.serviceId !== undefined) setValues.service_id = patch.serviceId;
    if (patch.connectionId !== undefined) setValues.connection_id = patch.connectionId;
    if (patch.hostname !== undefined) setValues.hostname = patch.hostname;
    if (patch.cloudflareZoneId !== undefined) {
      setValues.cloudflare_zone_id = patch.cloudflareZoneId;
    }
    if (patch.cloudflareDnsRecordId !== undefined) {
      setValues.cloudflare_dns_record_id = patch.cloudflareDnsRecordId;
    }
    if (patch.domainMappingId !== undefined) {
      setValues.domain_mapping_id = patch.domainMappingId;
    }
    if (patch.status !== undefined) setValues.status = patch.status;
    if (patch.lastErrorCode !== undefined) setValues.last_error_code = patch.lastErrorCode;
    if (patch.lastErrorMessage !== undefined) setValues.last_error_message = patch.lastErrorMessage;
    if (patch.publishedAt !== undefined) setValues.published_at = patch.publishedAt;

    const [row] = await this.db
      .update(projectPublicAccess)
      .set(setValues)
      .where(eq(projectPublicAccess.project_id, projectId))
      .returning();
    return row ?? null;
  }

  async deleteProjectPublicAccess(projectId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(projectPublicAccess)
      .where(eq(projectPublicAccess.project_id, projectId))
      .returning({ projectId: projectPublicAccess.project_id });
    return deleted.length > 0;
  }
}
