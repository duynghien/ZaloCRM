import { ref, onUnmounted, getCurrentInstance } from 'vue';
import type { StagedFileItem } from '@/components/chat/StagedMediaBar.vue';
import { useChat } from './use-chat';

export const MAX_FILES = 5;
export const MAX_IMAGE_SIZE = 15 * 1024 * 1024; // 15MB
export const MAX_DOC_SIZE = 30 * 1024 * 1024;   // 30MB

const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const ALLOWED_DOC_EXTS = new Set(['pdf', 'xlsx', 'xls', 'docx', 'doc', 'txt', 'zip', 'rar']);

export function useStagedMedia() {
  const { uploadMediaFiles, deleteStagedFile } = useChat();

  const stagedFiles = ref<StagedFileItem[]>([]);
  const uploading = ref(false);
  const isDragging = ref(false);
  const errorMessage = ref('');
  const showErrorSnack = ref(false);
  const fileInput = ref<HTMLInputElement | null>(null);

  function showError(msg: string) {
    errorMessage.value = msg;
    showErrorSnack.value = true;
  }

  function validateAndAddFiles(files: File[] | FileList): boolean {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return false;

    if (stagedFiles.value.length + fileArray.length > MAX_FILES) {
      showError(`Chỉ được gửi tối đa ${MAX_FILES} tệp mỗi lần.`);
      return false;
    }

    for (const file of fileArray) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isImg = ALLOWED_IMAGE_EXTS.has(ext) || file.type.startsWith('image/');
      const isDoc = ALLOWED_DOC_EXTS.has(ext);

      if (!isImg && !isDoc) {
        showError(`Định dạng tệp .${ext || 'unknown'} không được hỗ trợ.`);
        return false;
      }

      if (isImg && file.size > MAX_IMAGE_SIZE) {
        showError(`Hình ảnh "${file.name}" vượt quá dung lượng tối đa 15MB.`);
        return false;
      }

      if (isDoc && file.size > MAX_DOC_SIZE) {
        showError(`Tài liệu "${file.name}" vượt quá dung lượng tối đa 30MB.`);
        return false;
      }
    }

    // Add valid files
    for (const file of fileArray) {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const isImg = ALLOWED_IMAGE_EXTS.has(ext) || file.type.startsWith('image/');
      const previewUrl = isImg ? URL.createObjectURL(file) : undefined;

      stagedFiles.value.push({
        file,
        originalName: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        isImage: isImg,
        previewUrl,
      });
    }

    return true;
  }

  async function removeStagedFile(index: number) {
    if (index < 0 || index >= stagedFiles.value.length) return;
    const [removed] = stagedFiles.value.splice(index, 1);
    if (removed.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl);
    }
    if (removed.id) {
      await deleteStagedFile(removed.id);
    }
  }

  function clearStagedFiles() {
    for (const item of stagedFiles.value) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
    stagedFiles.value = [];
  }

  function triggerFileInput() {
    fileInput.value?.click();
  }

  function onFileInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files) {
      validateAndAddFiles(target.files);
      target.value = ''; // Reset to allow re-selecting same file
    }
  }

  function handlePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    const filesToProcess: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const name = file.name === 'image.png' || !file.name
            ? `screenshot_${Date.now()}.png`
            : file.name;
          const renamedFile = new File([file], name, { type: file.type });
          filesToProcess.push(renamedFile);
        }
      }
    }

    if (filesToProcess.length > 0) {
      event.preventDefault();
      validateAndAddFiles(filesToProcess);
    }
  }

  function handleDrop(event: DragEvent) {
    isDragging.value = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      validateAndAddFiles(files);
    }
  }

  async function uploadStagedFiles(): Promise<string[]> {
    if (stagedFiles.value.length === 0) return [];
    uploading.value = true;
    try {
      const filesToUpload = stagedFiles.value.map(f => f.file);
      const uploaded = await uploadMediaFiles(filesToUpload);
      return uploaded.map(u => u.id);
    } finally {
      uploading.value = false;
    }
  }

  if (getCurrentInstance()) {
    onUnmounted(() => {
      clearStagedFiles();
    });
  }

  return {
    stagedFiles,
    uploading,
    isDragging,
    errorMessage,
    showErrorSnack,
    fileInput,
    validateAndAddFiles,
    removeStagedFile,
    clearStagedFiles,
    triggerFileInput,
    onFileInputChange,
    handlePaste,
    handleDrop,
    uploadStagedFiles,
  };
}
