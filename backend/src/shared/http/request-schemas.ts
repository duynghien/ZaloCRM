/** Strict boundary checks preserve omission, explicit null and value semantics. */
export class RequestValidationError extends Error { readonly statusCode = 400; }
export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestValidationError('Expected an object');
  return value as Record<string, unknown>;
}
export function calendarInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(value)) throw new RequestValidationError('Invalid calendar date or timestamp');
  const parsed = new Date(value); const calendar = value.slice(0, 10);
  if (!Number.isFinite(parsed.getTime()) || new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) throw new RequestValidationError('Invalid calendar date or timestamp');
  return parsed.toISOString();
}
export function stringInput(value: unknown, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > maximum) throw new RequestValidationError('Invalid string value');
  return value;
}
export function enumInput(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new RequestValidationError('Invalid selection');
  return value;
}
export function identifierInput(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || value.trim() !== value) throw new RequestValidationError('Invalid identifier');
  return value;
}
