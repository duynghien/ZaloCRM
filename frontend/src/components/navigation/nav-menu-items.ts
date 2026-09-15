export interface NavMenuItem {
  title: string;
  icon: string;
  path: string;
}

export const navMenuItems: NavMenuItem[] = [
  { title: 'Dashboard', icon: 'dashboard.svg', path: '/' },
  { title: 'Tin nhắn', icon: 'message-circle-dots.svg', path: '/chat' },
  { title: 'Khách hàng', icon: 'users.svg', path: '/contacts' },
  { title: 'Tài khoản Zalo', icon: 'zalo.svg', path: '/zalo-accounts' },
  { title: 'Lịch hẹn', icon: 'calendar-check.svg', path: '/appointments' },
  { title: 'Đơn hàng', icon: 'basket-shopping-alt.svg', path: '/orders' },
  { title: 'Báo cáo', icon: 'chart-pie.svg', path: '/reports' },
  { title: 'Báo cáo AI', icon: 'ai.svg', path: '/ai-reports' },
  { title: 'Nhân viên', icon: 'face-smile.svg', path: '/settings' },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings' },
];
