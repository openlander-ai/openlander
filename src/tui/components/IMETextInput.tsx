import { createSignal, type JSX } from 'solid-js';

export interface IMETextInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly focus?: boolean;
  readonly showCursor?: boolean;
  readonly mask?: string;
  readonly highlightPastedText?: boolean;
}

export default function IMETextInput(props: IMETextInputProps): JSX.Element {
  return (
    <input
      value={props.value}
      onChange={(val: string) => {
        props.onChange(val);
      }}
      onSubmit={(val: string) => props.onSubmit?.(val)}
      placeholder={props.placeholder}
      focused={props.focus}
    />
  );
}

export function UncontrolledIMETextInput(
  props: Omit<IMETextInputProps, 'value' | 'onChange'> & { readonly initialValue?: string },
): JSX.Element {
  const [value, setValue] = createSignal(props.initialValue ?? '');
  return <IMETextInput {...props} value={value()} onChange={setValue} />;
}
