import { ref } from 'vue';
import { api } from '@/api/index';
import type { Message, Conversation } from '@/composables/use-chat';

/**
 * useChatAppointmentSync — Composable đồng bộ lịch hẹn từ tin nhắn Zalo Reminder sang hệ thống CRM.
 */
export function useChatAppointmentSync() {
  const syncSnack = ref({ show: false, text: '', color: 'success' });

  async function syncAppointment(conversation: Conversation | null, msg: Message) {
    if (!conversation?.contact?.id) {
      syncSnack.value = { show: true, text: 'Không có thông tin khách hàng', color: 'error' };
      return;
    }
    try {
      const p = JSON.parse(msg.content!);
      const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
      let appointmentDate: string | null = null;
      for (const h of params?.highLightsV2 || []) {
        if (h.ts > 1e12) {
          appointmentDate = new Date(h.ts).toISOString();
          break;
        }
      }
      if (!appointmentDate) {
        syncSnack.value = { show: true, text: 'Không tìm thấy thời gian hẹn', color: 'warning' };
        return;
      }
      await api.post('/appointments', {
        contactId: conversation.contact.id,
        appointmentDate,
        appointmentTime: new Date(appointmentDate).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        type: 'tai_kham',
        notes: `[Zalo] ${p.title || ''}`,
      });
      syncSnack.value = { show: true, text: 'Đã đồng bộ lịch hẹn thành công!', color: 'success' };
    } catch (err: any) {
      syncSnack.value = { show: true, text: err.response?.data?.error || 'Đồng bộ thất bại', color: 'error' };
    }
  }

  return {
    syncSnack,
    syncAppointment,
  };
}
