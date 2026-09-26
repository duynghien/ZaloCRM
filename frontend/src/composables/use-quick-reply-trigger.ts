/**
 * use-quick-reply-trigger.ts — Manages "/" trigger detection, IME composition guard, and keyboard navigation.
 */
import { ref } from 'vue';
import type { QuickReply } from '@/api/quick-reply-api';

export function useQuickReplyTrigger(
  getInputText: () => string,
  updateInputText: (val: string) => void
) {
  const showSelector = ref(false);
  const query = ref('');
  const isComposing = ref(false);
  const showManager = ref(false);

  function checkTrigger(text: string) {
    const match = text.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      query.value = match[1] || '';
      showSelector.value = true;
    } else {
      showSelector.value = false;
      query.value = '';
    }
  }

  function handleKeydown(
    e: KeyboardEvent,
    selectorRef: { navigateDown: () => void; navigateUp: () => void; selectCurrent: () => boolean } | null,
    onSend: () => void
  ): boolean {
    if (isComposing.value || e.isComposing) return false;

    if (showSelector.value) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        selectorRef?.navigateDown();
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        selectorRef?.navigateUp();
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        const handled = selectorRef?.selectCurrent();
        if (handled) return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        showSelector.value = false;
        return true;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
      return true;
    }

    return false;
  }

  function insertReply(reply: QuickReply) {
    const current = getInputText();
    const replaced = current.replace(/(^|\s)\/[a-zA-Z0-9_-]*$/, (match, prefix) => {
      return (prefix || '') + reply.content;
    });
    updateInputText(replaced);
    showSelector.value = false;
    query.value = '';
  }

  return {
    showSelector,
    query,
    isComposing,
    showManager,
    checkTrigger,
    handleKeydown,
    insertReply,
  };
}
