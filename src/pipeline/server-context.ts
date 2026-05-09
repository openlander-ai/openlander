import type { Docker } from './docker/facade.js';

export const DEFAULT_SERVER_ID = 'local';

export interface ServerContext {
  id: string;
  host: string;
  docker: Docker;
  isLocal: boolean;
}

export class LocalServerContext implements ServerContext {
  readonly id = DEFAULT_SERVER_ID;
  readonly host = '127.0.0.1';
  readonly isLocal = true;
  constructor(public readonly docker: Docker) {}
}

export function createLocalServerContext(docker: Docker): ServerContext {
  return new LocalServerContext(docker);
}
