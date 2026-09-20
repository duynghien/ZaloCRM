/**
 * date-utils.ts — Timezone helpers normalized to Asia/Ho_Chi_Minh (UTC+7)
 */

export function getVnDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // Format: "YYYY-MM-DD"
}

export function getVnDayStartUtc(date: Date = new Date()): Date {
  const vnDateStr = getVnDateString(date);
  return new Date(`${vnDateStr}T00:00:00+07:00`);
}
