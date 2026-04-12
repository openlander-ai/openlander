export function buildSetValues<TSource extends Record<string, unknown>>(
  source: Partial<TSource>,
  mapping: { [K in keyof TSource]?: string },
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(mapping)) {
    const value = source[key as keyof TSource];
    const targetKey = mapping[key as keyof TSource];
    if (value !== undefined && targetKey !== undefined) {
      result[targetKey] = value;
    }
  }
  return result;
}

export function pickDefined<T extends Record<string, unknown>>(
  source: Partial<T>,
  ...keys: (keyof T)[]
): Partial<T> {
  const result = {} as Partial<T>;
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}
