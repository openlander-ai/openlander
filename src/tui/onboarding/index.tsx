import React, { useState, useEffect } from 'react';
import type { AppContext } from '../../app.js';

import { Welcome } from './Welcome.js';
import { DockerCheck } from './DockerCheck.js';
import { GitSetup } from './GitSetup.js';
import { LlmSetup } from './LlmSetup.js';
import { TraefikSetup } from './TraefikSetup.js';
import { Ready } from './Ready.js';

export type OnboardingStep = 'welcome' | 'docker' | 'git' | 'llm' | 'traefik' | 'ready';

export interface OnboardingProps {
  ctx: AppContext;
  onComplete: () => void;
}

export interface ScreenProps {
  ctx: AppContext;
  onNext: () => void;
}

/**
 * Onboarding controller - manages step state and renders current screen.
 * Each screen is full-screen (not a scrolling wizard).
 */
export function Onboarding({ ctx, onComplete }: OnboardingProps): React.ReactElement {
  const [step, setStep] = useState<OnboardingStep>('welcome');

  // Clear console between screens for full-screen feel
  useEffect(() => {
    console.clear();
  }, [step]);

  const handleNext = () => {
    const steps: OnboardingStep[] = ['welcome', 'docker', 'git', 'llm', 'traefik', 'ready'];
    const currentIndex = steps.indexOf(step);
    const nextStep = steps[currentIndex + 1];
    if (nextStep) {
      setStep(nextStep);
    }
  };

  const handleComplete = () => {
    onComplete();
  };

  // Render current screen
  switch (step) {
    case 'welcome':
      return <Welcome onNext={handleNext} />;
    case 'docker':
      return <DockerCheck ctx={ctx} onNext={handleNext} />;
    case 'git':
      return <GitSetup ctx={ctx} onNext={handleNext} />;
    case 'llm':
      return <LlmSetup ctx={ctx} onNext={handleNext} />;
    case 'traefik':
      return <TraefikSetup ctx={ctx} onNext={handleNext} />;
    case 'ready':
      return <Ready onNext={handleComplete} />;
    default:
      return <Welcome onNext={handleNext} />;
  }
}

export { Welcome } from './Welcome.js';
export { DockerCheck } from './DockerCheck.js';
export { GitSetup } from './GitSetup.js';
export { LlmSetup } from './LlmSetup.js';
export { TraefikSetup } from './TraefikSetup.js';
export { Ready } from './Ready.js';
export { PatchNotes } from './PatchNotes.js';
