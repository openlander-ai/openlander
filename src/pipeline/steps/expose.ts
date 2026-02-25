import { CloudflareTunnel } from '../tunnel.js';

export interface ExposeStepConfig {
  port: number;
}

export interface ExposeStepResult {
  tunnel: CloudflareTunnel;
  publicUrl: string;
}

export async function executeExposeStep(config: ExposeStepConfig): Promise<ExposeStepResult> {
  const tunnel = new CloudflareTunnel();
  const publicUrl = await tunnel.start(config.port);

  return {
    tunnel,
    publicUrl,
  };
}
