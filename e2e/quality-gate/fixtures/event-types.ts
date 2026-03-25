export interface TimelineEvent {
  type: string;
  projectId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export const DEPLOY_EVENTS = {
  START: 'deploy:start',
  CLONE: 'deploy:clone',
  BUILD: 'deploy:build',
  RUN: 'deploy:run',
  SUCCESS: 'deploy:success',
  FAILED: 'deploy:failed',
  AUTO_DETECT: 'deploy:auto-detect',
  CRASH: 'deploy:crash',
  ROLLBACK: 'deploy:rollback',
} as const;

export const RECOVERY_EVENTS = {
  START: 'recovery:start',
  SUCCESS: 'recovery:success',
  FAILED: 'recovery:failed',
  EXHAUSTED: 'recovery:exhausted',
} as const;

export const COMPOSE_EVENTS = {
  START: 'compose:start',
  UP: 'compose:up',
  DOWN: 'compose:down',
  ORPHANS_CLEANED: 'compose:orphans-cleaned',
  FAILED: 'compose:failed',
} as const;

export const BUILD_EVENTS = {
  SUGGEST: 'build:suggest',
  INFORM: 'build:inform',
  OUTPUT: 'build:output',
} as const;
