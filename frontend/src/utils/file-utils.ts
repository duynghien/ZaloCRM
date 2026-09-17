/**
 * File utility functions for media & attachment presentation
 */

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

export function isImageFile(filename?: string, mimeType?: string): boolean {
  if (mimeType?.startsWith('image/')) return true;
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
}
