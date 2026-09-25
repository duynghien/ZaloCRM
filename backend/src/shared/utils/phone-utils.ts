/**
 * phone-utils.ts — Phone number normalization and variant generation for Vietnamese phone numbers.
 */

/**
 * Normalizes a Vietnamese phone number and returns both domestic ('0xxx')
 * and international without plus ('84xxx') variant representations.
 *
 * Example:
 *  '0912345678' -> ['0912345678', '84912345678']
 *  '+84912345678' -> ['0912345678', '84912345678']
 *  '84912345678' -> ['0912345678', '84912345678']
 */
export function normalizeVietnamesePhoneNumberVariants(phone: string): string[] {
  if (!phone || typeof phone !== 'string') return [];

  const digits = phone.replace(/\D/g, '');
  if (!digits) return [];

  const variants = new Set<string>();

  if (digits.startsWith('84') && digits.length >= 9) {
    const domestic = '0' + digits.slice(2);
    variants.add(domestic);
    variants.add(digits);
  } else if (digits.startsWith('0') && digits.length >= 9) {
    variants.add(digits);
    const international = '84' + digits.slice(1);
    variants.add(international);
  } else if (digits.length === 9) {
    variants.add('0' + digits);
    variants.add('84' + digits);
  } else {
    variants.add(digits);
  }

  return Array.from(variants);
}
