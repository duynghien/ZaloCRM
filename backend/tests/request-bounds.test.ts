import { expect, it } from 'vitest';
import { boundedPositiveInt, boundedString } from '../src/shared/http/request-bounds.js';
import { calendarInstant } from '../src/shared/http/request-schemas.js';
it('defaults only omitted pagination and preserves public limit 200', () => {
  expect(boundedPositiveInt(undefined, 50, 200)).toBe(50);
  expect(boundedPositiveInt('200', 50, 200)).toBe(200);
  expect(boundedPositiveInt('10000', 1, 10000)).toBe(10000);
  expect(boundedPositiveInt(50, 20, 100)).toBe(50);
  expect(boundedPositiveInt(1, 1, 10000)).toBe(1);
});
it.each([null, 0, '', '0', '-1', '1.5', 'NaN', '10001', ['1'], {}, '9007199254740993'])('rejects supplied malformed pagination %j', value => {
  expect(() => boundedPositiveInt(value, 1, 10000)).toThrow();
});
it('never truncates identifiers or stringifies an object', () => {
  expect(() => boundedString('x'.repeat(129), 128)).toThrow();
  expect(() => boundedString({}, 128)).toThrow();
});
it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-01-01T00:00:00', '2026-01-01T24:00:00Z', 'yesterday', null, 123])('rejects invalid calendar values %j', value => expect(() => calendarInstant(value)).toThrow());
it('preserves timezone instants and valid leap day', () => {
  expect(calendarInstant('2024-02-29')).toBe('2024-02-29T00:00:00.000Z');
  expect(calendarInstant('2026-09-01T23:30:12.123+07:00')).toBe('2026-09-01T16:30:12.123Z');
});
