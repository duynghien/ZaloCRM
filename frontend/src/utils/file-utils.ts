/**
 * File utility functions for media & attachment presentation
 */

/**
 * Resolves an attachment URL. Same-origin requests rely on HttpOnly media session cookies
 * or explicit short-lived tickets. Query tokens are no longer appended to prevent JWT leakage.
 */
export function resolveAttachmentUrl(url?: string): string {
  if (!url) return '';
  return url;
}


export function formatFileSize(bytes?: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function getFileIcon(filename?: string): string {
  if (!filename) return 'mdi-file-document-outline';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'mdi-file-pdf-box';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return 'mdi-file-excel-box';
  if (['docx', 'doc'].includes(ext)) return 'mdi-file-word-box';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'mdi-folder-zip';
  return 'mdi-file-document-outline';
}

export function getFileIconColor(filename?: string): string {
  if (!filename) return 'grey-darken-1';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return '#EF4444';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return '#10B981';
  if (['docx', 'doc'].includes(ext)) return '#3B82F6';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '#F59E0B';
  return 'grey-darken-1';
}

export function isImageFile(filename?: string, mimeType?: string, url?: string): boolean {
  if (mimeType) return mimeType.startsWith('image/');
  const target = filename || url || '';
  const clean = target.split('?')[0];
  const ext = clean.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return true;
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip', 'rar', '7z', 'tar', 'gz', 'txt', 'exe'].includes(ext)) return false;
  if (url && (url.includes('photo-stal') || url.includes('/attachments/'))) return true;
  return false;
}
