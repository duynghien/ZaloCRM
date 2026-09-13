import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          background: '#F5F2EB',
          surface: '#FFFFFF',
          'surface-variant': '#E8E5DE',
          primary: '#0068FF',
          secondary: '#EBF3FE',
          border: '#18181B',
          error: '#EF4444',
          warning: '#F59E0B',
          success: '#10B981',
          info: '#3B82F6',
          'on-background': '#18181B',
          'on-surface': '#18181B',
          'on-primary': '#FFFFFF',
        },
      },
      dark: {
        dark: true,
        colors: {
          background: '#121214',
          surface: '#1F1F23',
          'surface-variant': '#27272A',
          primary: '#388BFD',
          secondary: '#0C2B59',
          border: '#3F3F46',
          error: '#F43F5E',
          warning: '#EAB308',
          success: '#22C55E',
          info: '#38BDF8',
          'on-background': '#F4F4F5',
          'on-surface': '#F4F4F5',
          'on-primary': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat', rounded: 'sm', elevation: 0 },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VSelect: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VAutocomplete: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VTextarea: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VCard: { variant: 'flat', rounded: 'sm', elevation: 0 },
    VChip: { rounded: 'sm', size: 'small', elevation: 0 },
    VDataTable: { elevation: 0 },
    VAvatar: { rounded: 'sm' },
    VDialog: { maxWidth: 600 },
  },
});
