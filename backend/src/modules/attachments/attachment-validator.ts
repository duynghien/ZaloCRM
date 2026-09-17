/**
 * attachment-validator.ts — Strict validation for file uploads (size limits,
 * extension whitelist, MIME types, and magic bytes verification).
 */
import path from 'node:path';

export const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15MB
export const MAX_DOC_SIZE = 30 * 1024 * 1024;   // 30MB
export const MAX_FILES_PER_BATCH = 5;

export const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export const ALLOWED_DOC_EXTENSIONS = new Set([
  'pdf',
  'xlsx',
  'xls',
  'docx',
  'doc',
  'txt',
  'zip',
  'rar',
]);
export const ALLOWED_DOC_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/octet-stream',
]);

export const FORBIDDEN_EXTENSIONS = new Set([
  'html', 'htm', 'svg', 'xml', 'exe', 'sh', 'bat', 'cmd', 'js', 'mjs', 'cjs',
  'vbs', 'php', 'py', 'com', 'msi', 'bin', 'dll', 'jar', 'jsp', 'asp', 'aspx',
  'cgi', 'pl', 'scr', 'ps1', 'psm1', 'vbe', 'wsf', 'wsh'
]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
  fileType?: 'image' | 'file';
  mimeType?: string;
  safeName?: string;
}

/**
 * Sanitize filename to prevent directory traversal and injection attacks.
 */
export function sanitizeFilename(rawName: string): string {
  const base = path.basename(rawName).trim();
  // Remove dangerous chars, control characters, replace whitespace with underscore
  const sanitized = base
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);

  return sanitized || `file_${Date.now()}`;
}

/**
 * Extract normalized extension without leading dot.
 */
export function getExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/^\./, '');
  return ext;
}

/**
 * Validate metadata (name, extension, announced MIME, size).
 */
export function validateFileMetadata(
  filename: string,
  mimeType: string,
  sizeBytes: number,
): ValidationResult {
  const safeName = sanitizeFilename(filename);
  const ext = getExtension(safeName);

  if (!ext || FORBIDDEN_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Định dạng tệp .${ext || 'unknown'} không được phép tải lên vì lý do bảo mật.`,
    };
  }

  const normalizedMime = (mimeType || '').toLowerCase().trim();

  // Check if image
  if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    if (sizeBytes > MAX_IMAGE_SIZE) {
      return {
        valid: false,
        error: `Hình ảnh "${safeName}" vượt quá dung lượng tối đa cho phép (15MB).`,
      };
    }
    return {
      valid: true,
      fileType: 'image',
      mimeType: normalizedMime || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      safeName,
    };
  }

  // Check if document
  if (ALLOWED_DOC_EXTENSIONS.has(ext)) {
    if (sizeBytes > MAX_DOC_SIZE) {
      return {
        valid: false,
        error: `Tài liệu "${safeName}" vượt quá dung lượng tối đa cho phép (30MB).`,
      };
    }
    return {
      valid: true,
      fileType: 'file',
      mimeType: normalizedMime || 'application/octet-stream',
      safeName,
    };
  }

  return {
    valid: false,
    error: `Định dạng tệp .${ext} không nằm trong danh sách hỗ trợ (Ảnh: jpg, png, webp, gif; Tài liệu: pdf, excel, word, txt, zip, rar).`,
  };
}

/**
 * Deep inspection of magic numbers (first bytes) to prevent extension spoofing.
 */
export function validateMagicBytes(header: Buffer, ext: string): { valid: boolean; error?: string } {
  if (!header || header.length < 4) {
    return { valid: false, error: 'Tệp rỗng hoặc không thể đọc cấu trúc header.' };
  }

  const normalizedExt = ext.toLowerCase();

  // Block any embedded script or HTML/SVG in header
  const headerString = header.toString('utf8', 0, Math.min(header.length, 512)).toLowerCase();
  if (
    headerString.includes('<svg') ||
    headerString.includes('<html') ||
    headerString.includes('<script') ||
    headerString.includes('<!doctype')
  ) {
    return { valid: false, error: 'Phát hiện nội dung mã thực thi độc hại (HTML/SVG/Script).' };
  }

  // JPEG: FF D8 FF
  if (normalizedExt === 'jpg' || normalizedExt === 'jpeg') {
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
      return { valid: true };
    }
    return { valid: false, error: 'Dữ liệu không khớp định dạng JPEG hợp lệ.' };
  }

  // PNG: 89 50 4E 47 (0x89, 'PNG')
  if (normalizedExt === 'png') {
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
      return { valid: true };
    }
    return { valid: false, error: 'Dữ liệu không khớp định dạng PNG hợp lệ.' };
  }

  // GIF: GIF87a or GIF89a (47 49 46 38)
  if (normalizedExt === 'gif') {
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
      return { valid: true };
    }
    return { valid: false, error: 'Dữ liệu không khớp định dạng GIF hợp lệ.' };
  }

  // WEBP: RIFF....WEBP
  if (normalizedExt === 'webp') {
    if (
      header.length >= 12 &&
      header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 && // RIFF
      header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50 // WEBP
    ) {
      return { valid: true };
    }
    return { valid: false, error: 'Dữ liệu không khớp định dạng WEBP hợp lệ.' };
  }

  // PDF: %PDF- (25 50 44 46)
  if (normalizedExt === 'pdf') {
    if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
      return { valid: true };
    }
    return { valid: false, error: 'Dữ liệu không khớp định dạng PDF hợp lệ.' };
  }

  // ZIP, DOCX, XLSX: PK.. (50 4B 03 04, 50 4B 05 06, 50 4B 07 08)
  if (normalizedExt === 'zip' || normalizedExt === 'docx' || normalizedExt === 'xlsx') {
    if (
      header[0] === 0x50 &&
      header[1] === 0x4b &&
      (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07)
    ) {
      return { valid: true };
    }
    return { valid: false, error: `Dữ liệu không khớp định dạng ${normalizedExt.toUpperCase()} hợp lệ.` };
  }

  // RAR: Rar! (52 61 72 21)
  if (normalizedExt === 'rar') {
    if (header[0] === 0x52 && header[1] === 0x61 && header[2] === 0x72 && header[3] === 0x21) {
      return { valid: true };
    }
    return { valid: false, error: 'Dữ liệu không khớp định dạng RAR hợp lệ.' };
  }

  // TXT: plain text, no binary control null bytes in the sample
  if (normalizedExt === 'txt') {
    for (let i = 0; i < Math.min(header.length, 512); i++) {
      if (header[i] === 0x00) {
        return { valid: false, error: 'Tệp văn bản chứa ký tự điều khiển nhị phân (Binary null bytes).' };
      }
    }
    return { valid: true };
  }

  // OLE2 / Legacy Office DOC, XLS: D0 CF 11 E0
  if (normalizedExt === 'doc' || normalizedExt === 'xls') {
    if (
      (header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0) ||
      (header[0] === 0x50 && header[1] === 0x4b) // or OOXML renamed
    ) {
      return { valid: true };
    }
    return { valid: false, error: `Dữ liệu không khớp định dạng ${normalizedExt.toUpperCase()} hợp lệ.` };
  }

  return { valid: true };
}
