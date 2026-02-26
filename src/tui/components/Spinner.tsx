/**
 * Animated dots spinner for OpenTUI.
 * Replaces ink-spinner which doesn't exist in OpenTUI.
 */
import { createSignal, onCleanup, type ParentProps } from 'solid-js';

const DOTS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface SpinnerProps extends ParentProps {
  color?: string;
}

export function Spinner(props: SpinnerProps) {
  const [frame, setFrame] = createSignal(0);
  const timer = setInterval(() => {
    setFrame((f) => (f + 1) % DOTS.length);
  }, 80);
  onCleanup(() => clearInterval(timer));

  return <text color={props.color}>{DOTS[frame()]}</text>;
}
