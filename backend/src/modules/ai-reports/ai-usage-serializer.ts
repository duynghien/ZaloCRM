/**
 * Safely converts BigInt values (e.g. costVnd, tokens) to JavaScript Numbers
 * before Fastify serializes response payloads into JSON.
 * Avoids Fastify runtime crash: "TypeError: Do not know how to serialize a BigInt".
 */
export function serializeAiUsageStats<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'bigint') {
    return Number(data) as unknown as T;
  }

  if (Array.isArray(data)) {
    return data.map((item) => serializeAiUsageStats(item)) as unknown as T;
  }

  if (typeof data === 'object') {
    if (data instanceof Date) {
      return data;
    }

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'bigint') {
        converted[key] = Number(value);
      } else if (value !== null && typeof value === 'object') {
        converted[key] = serializeAiUsageStats(value);
      } else {
        converted[key] = value;
      }
    }
    return converted as T;
  }

  return data;
}
