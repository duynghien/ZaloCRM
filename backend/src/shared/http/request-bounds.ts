import { calendarInstant, RequestValidationError } from './request-schemas.js';
export function boundedPositiveInt(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new RequestValidationError('Invalid pagination');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new RequestValidationError('Pagination out of range');
  return parsed;
}
export function boundedString(value: unknown, maximum: number): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new RequestValidationError('Invalid query string');
  return value;
}
export function validOptionalDate(value: unknown): Date | undefined {
  if (value === undefined) return undefined;
  return new Date(calendarInstant(value));
}
export function boundedFiniteNumber(value: unknown, minimum: number, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}
