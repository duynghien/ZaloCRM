import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatFileSize, getFileIcon, getFileIconColor, isImageFile } from '../src/utils/file-utils';
import {
  useStagedMedia,
  MAX_FILES,
  MAX_IMAGE_SIZE,
  MAX_DOC_SIZE,
} from '../src/composables/use-staged-media';

// Mock useChat so useStagedMedia can operate in isolation
vi.mock('../src/composables/use-chat', () => ({
  useChat: () => ({
    uploadMediaFiles: vi.fn().mockResolvedValue([
      { id: 'att-1', filename: 'file1.png', originalName: 'file1.png' },
    ]),
    deleteStagedFile: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('Media Messaging Utils & Staged Media Composable', () => {
  describe('file-utils', () => {
    it('formats file sizes accurately', () => {
      expect(formatFileSize()).toBe('0 B');
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(2048)).toBe('2 KB');
      expect(formatFileSize(15 * 1024 * 1024)).toBe('15.0 MB');
    });

    it('returns appropriate icon for document types', () => {
      expect(getFileIcon('test.pdf')).toBe('mdi-file-pdf-box');
      expect(getFileIcon('sheet.xlsx')).toBe('mdi-file-excel-box');
      expect(getFileIcon('doc.docx')).toBe('mdi-file-word-box');
      expect(getFileIcon('archive.zip')).toBe('mdi-folder-zip');
      expect(getFileIcon('file.unknown')).toBe('mdi-file-document-outline');
      expect(getFileIcon('')).toBe('mdi-file-document-outline');
    });

    it('returns appropriate colors for document types', () => {
      expect(getFileIconColor('test.pdf')).toBe('#EF4444');
      expect(getFileIconColor('data.xlsx')).toBe('#10B981');
      expect(getFileIconColor('contract.docx')).toBe('#3B82F6');
      expect(getFileIconColor('backup.zip')).toBe('#F59E0B');
      expect(getFileIconColor('readme.txt')).toBe('grey-darken-1');
    });

    it('correctly identifies image files', () => {
      expect(isImageFile('pic.jpg')).toBe(true);
      expect(isImageFile('pic.jpeg')).toBe(true);
      expect(isImageFile('pic.png')).toBe(true);
      expect(isImageFile('pic.webp')).toBe(true);
      expect(isImageFile('pic.gif')).toBe(true);
      expect(isImageFile('any.bin', 'image/png')).toBe(true);
      expect(isImageFile('doc.pdf')).toBe(false);
      expect(isImageFile('malicious.exe')).toBe(false);
    });
  });

  describe('useStagedMedia', () => {
    beforeEach(() => {
      // Stub URL.createObjectURL and URL.revokeObjectURL for happy-dom / jsdom
      global.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test-preview');
      global.URL.revokeObjectURL = vi.fn();
    });

    it('validates and accepts valid files within limits', () => {
      const { stagedFiles, validateAndAddFiles } = useStagedMedia();

      const validImg = new File(['valid-image-content'], 'photo.jpg', { type: 'image/jpeg' });
      const validDoc = new File(['valid-pdf-content'], 'contract.pdf', { type: 'application/pdf' });

      const success = validateAndAddFiles([validImg, validDoc]);
      expect(success).toBe(true);
      expect(stagedFiles.value.length).toBe(2);
      expect(stagedFiles.value[0].isImage).toBe(true);
      expect(stagedFiles.value[0].previewUrl).toBe('blob:http://localhost/test-preview');
      expect(stagedFiles.value[1].isImage).toBe(false);
    });

    it('rejects more than MAX_FILES (5) items', () => {
      const { stagedFiles, validateAndAddFiles, errorMessage, showErrorSnack } = useStagedMedia();

      const files = Array.from({ length: 6 }, (_, i) =>
        new File(['content'], `file${i}.png`, { type: 'image/png' }),
      );

      const success = validateAndAddFiles(files);
      expect(success).toBe(false);
      expect(stagedFiles.value.length).toBe(0);
      expect(showErrorSnack.value).toBe(true);
      expect(errorMessage.value).toContain('Chỉ được gửi tối đa 5 tệp');
    });

    it('rejects image files exceeding 15MB', () => {
      const { stagedFiles, validateAndAddFiles, errorMessage } = useStagedMedia();

      const largeImg = new File(['x'], 'large.png', { type: 'image/png' });
      Object.defineProperty(largeImg, 'size', { value: MAX_IMAGE_SIZE + 1000 });

      const success = validateAndAddFiles([largeImg]);
      expect(success).toBe(false);
      expect(stagedFiles.value.length).toBe(0);
      expect(errorMessage.value).toContain('15MB');
    });

    it('rejects document files exceeding 30MB', () => {
      const { stagedFiles, validateAndAddFiles, errorMessage } = useStagedMedia();

      const largeDoc = new File(['x'], 'big.pdf', { type: 'application/pdf' });
      Object.defineProperty(largeDoc, 'size', { value: MAX_DOC_SIZE + 1000 });

      const success = validateAndAddFiles([largeDoc]);
      expect(success).toBe(false);
      expect(stagedFiles.value.length).toBe(0);
      expect(errorMessage.value).toContain('30MB');
    });

    it('rejects unsupported and malicious extensions (e.g. .exe, .html)', () => {
      const { stagedFiles, validateAndAddFiles, errorMessage } = useStagedMedia();

      const badFile = new File(['evil'], 'payload.exe', { type: 'application/octet-stream' });
      const success = validateAndAddFiles([badFile]);
      expect(success).toBe(false);
      expect(stagedFiles.value.length).toBe(0);
      expect(errorMessage.value).toContain('không được hỗ trợ');
    });

    it('removes staged file and revokes its preview URL', async () => {
      const { stagedFiles, validateAndAddFiles, removeStagedFile } = useStagedMedia();

      const file = new File(['img'], 'photo.png', { type: 'image/png' });
      validateAndAddFiles([file]);
      expect(stagedFiles.value.length).toBe(1);

      await removeStagedFile(0);
      expect(stagedFiles.value.length).toBe(0);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/test-preview');
    });

    it('clears all staged files and revokes previews', () => {
      const { stagedFiles, validateAndAddFiles, clearStagedFiles } = useStagedMedia();

      const file1 = new File(['1'], 'p1.png', { type: 'image/png' });
      const file2 = new File(['2'], 'p2.png', { type: 'image/png' });
      validateAndAddFiles([file1, file2]);
      expect(stagedFiles.value.length).toBe(2);

      clearStagedFiles();
      expect(stagedFiles.value.length).toBe(0);
      expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    });
  });
});
