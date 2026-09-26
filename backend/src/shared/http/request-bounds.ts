import { calendarInstant, RequestValidationError } from './request-schemas.js';
export function boundedPositiveInt(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RequestValidationError('Pagination out of range');
    return value;
  }
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

export function uuidInput(val: unknown, fieldName = 'ID'): string {
  const str = String(val || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str)) {
    throw new RequestValidationError(`${fieldName} phải là định dạng UUID hợp lệ`);
  }
  return str;
}

export function strictBooleanInput(val: unknown, fieldName = 'Trường'): boolean {
  if (typeof val !== 'boolean') {
    throw new RequestValidationError(`${fieldName} phải là kiểu boolean (true hoặc false)`);
  }
  return val;
}
