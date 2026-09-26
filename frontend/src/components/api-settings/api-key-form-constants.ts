/**
 * api-key-form-constants.ts — Form options and scope definitions for API Key creation.
 */
export const EXPIRATION_OPTIONS = [
  { title: '30 ngày', value: 30 },
  { title: '90 ngày (Khuyến nghị)', value: 90 },
  { title: '365 ngày', value: 365 },
  { title: 'Không thời hạn (Vĩnh viễn)', value: 0 },
];

export const SCOPE_GROUPS = [
  {
    title: 'Khách hàng',
    items: [
      { label: 'Đọc (contacts:read)', value: 'contacts:read' },
      { label: 'Ghi/Sửa (contacts:write)', value: 'contacts:write' },
    ],
  },
  {
    title: 'Đơn hàng',
    items: [
      { label: 'Đọc (orders:read)', value: 'orders:read' },
      { label: 'Tạo/Sửa (orders:write)', value: 'orders:write' },
    ],
  },
  {
    title: 'Hội thoại & Tin nhắn',
    items: [
      { label: 'Đọc tin (messages:read)', value: 'messages:read' },
      { label: 'Gửi tin (messages:write)', value: 'messages:write' },
    ],
  },
  {
    title: 'Lịch hẹn & Zalo OA',
    items: [
      { label: 'Đọc lịch (appointments:read)', value: 'appointments:read' },
      { label: 'Tạo lịch (appointments:write)', value: 'appointments:write' },
      { label: 'Tài khoản OA (zalo_accounts:read)', value: 'zalo_accounts:read' },
    ],
  },
];
