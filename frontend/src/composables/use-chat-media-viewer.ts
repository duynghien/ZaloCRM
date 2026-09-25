import { ref } from 'vue';
import { api } from '@/api/index';
import type { Message } from '@/composables/use-chat';
import type { AlbumImage } from '@/utils/chat-message-clustering';

/**
 * useChatMediaViewer — Composable quản lý hiển thị lightbox bộ sưu tập ảnh,
 * tải tệp đính kèm an toàn và cơ chế phục hồi vé bảo mật media khi tải ảnh thất bại.
 */
export function useChatMediaViewer() {
  const showLightbox = ref(false);
  const lightboxUrl = ref('');
  const lightboxFilename = ref('');
  const galleryImages = ref<AlbumImage[]>([]);
  const galleryIndex = ref(0);

  const imageRetries = new Set<string>();
  const failedImages = ref<Set<string>>(new Set());

  function onOpenGallery(payload: { index: number; images: AlbumImage[] }) {
    galleryImages.value = [...payload.images];
    galleryIndex.value = payload.index;
    lightboxUrl.value = payload.images[payload.index]?.url || '';
    lightboxFilename.value =
      payload.images[payload.index]?.originalName ||
      payload.images[payload.index]?.filename ||
      '';
    showLightbox.value = true;
  }

  function openLightbox(url: string, filename?: string) {
    if (!url) return;
    galleryImages.value = [{ url, filename, messageId: '' }];
    galleryIndex.value = 0;
    lightboxUrl.value = url;
    lightboxFilename.value = filename || '';
    showLightbox.value = true;
  }

  async function handleAlbumImageError({ event, image }: { event: Event; image: AlbumImage }) {
    const key = image.url;
    const target = event.target as HTMLImageElement | null;
    const filename = image.filename || (target ? target.src.split('/attachments/')[1]?.split('?')[0] : undefined);
    if (!filename) {
      failedImages.value.add(key);
      return;
    }

    if (!imageRetries.has(filename)) {
      imageRetries.add(filename);
      try {
        const res = await api.post('/attachments/ticket', { filename });
        if (res.data?.ticket && target) {
          target.src = `/api/v1/attachments/${encodeURIComponent(filename)}?ticket=${encodeURIComponent(res.data.ticket)}`;
          return;
        }
      } catch (err) {
        console.warn('[chat-album-image] Failed to refresh media ticket:', err);
      }
    }

    failedImages.value.add(key);
  }

  function retryLoadAlbumImage(image: AlbumImage) {
    const key = image.url;
    const target = image.filename || image.url.split('/attachments/')[1]?.split('?')[0];
    if (target) {
      imageRetries.delete(target);
    }
    failedImages.value.delete(key);
  }

  async function handleImageError({ event, att, msg }: { event: Event; att?: any; msg?: Message }) {
    const key = att?.url || att?.filename || msg?.id || '';
    const target = event.target as HTMLImageElement | null;
    if (!target) {
      failedImages.value.add(key);
      return;
    }

    const filename = att?.filename || target.src.split('/attachments/')[1]?.split('?')[0];
    if (!filename) {
      failedImages.value.add(key);
      return;
    }

    if (!imageRetries.has(filename)) {
      imageRetries.add(filename);
      try {
        const res = await api.post('/attachments/ticket', { filename });
        if (res.data?.ticket) {
          target.src = `/api/v1/attachments/${encodeURIComponent(filename)}?ticket=${encodeURIComponent(res.data.ticket)}`;
          return;
        }
      } catch (err) {
        console.warn('[chat-image] Failed to refresh media ticket:', err);
      }
    }

    failedImages.value.add(key);
  }

  function retryLoadImage({ att, msg }: { att?: any; msg?: Message }) {
    const key = att?.url || att?.filename || msg?.id || '';
    const target = att?.filename || att?.url?.split('/attachments/')[1]?.split('?')[0];
    if (target) {
      imageRetries.delete(target);
    }
    failedImages.value.delete(key);
  }

  function openFile(url: string) {
    if (!url) return;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {}
  }

  return {
    showLightbox,
    lightboxUrl,
    lightboxFilename,
    galleryImages,
    galleryIndex,
    failedImages,
    onOpenGallery,
    openLightbox,
    handleAlbumImageError,
    retryLoadAlbumImage,
    handleImageError,
    retryLoadImage,
    openFile,
  };
}
