import { h } from 'vue';
import type { IconProps, IconSet } from 'vuetify';

// Eagerly import all SVG icons from public/icons
const svgModules = import.meta.glob('../../public/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Map of normalized SVG contents keyed by filename (with and without .svg)
const svgRegistry = new Map<string, string>();

for (const [filePath, rawSvg] of Object.entries(svgModules)) {
  // filePath is e.g. '../../public/icons/dashboard.svg'
  const fileName = filePath.split('/').pop() || '';
  const baseName = fileName.replace(/\.svg$/, '');

  // Normalize SVG: inject class="v-icon__svg", ensure fill="currentColor"
  let normalized = rawSvg
    .replace(/fill="black"/g, 'fill="currentColor"')
    .replace(/<svg\b([^>]*)>/, (_match, attrs) => {
      // Remove hardcoded width and height so Vuetify can control sizing via viewBox & CSS
      let cleaned = attrs
        .replace(/\b(width|height)="[^"]*"/g, '')
        .trim();
      if (!cleaned.includes('class=')) {
        cleaned = `class="v-icon__svg" ${cleaned}`;
      } else {
        cleaned = cleaned.replace(/class="([^"]*)"/, 'class="v-icon__svg $1"');
      }
      return `<svg ${cleaned}>`;
    });

  svgRegistry.set(fileName.toLowerCase(), normalized);
  svgRegistry.set(baseName.toLowerCase(), normalized);
}

// 41 mappings from current MDI icon to SVG file
export const mdiToSvgMap: Record<string, string> = {
  'mdi-view-dashboard-outline': 'dashboard.svg',
  'mdi-message-text-outline': 'message-circle-dots.svg',
  'mdi-account-group-outline': 'users.svg',
  'mdi-cellphone-link': 'zalo.svg',
  'mdi-calendar-clock-outline': 'calendar-check.svg',
  'mdi-cart-outline': 'basket-shopping-alt.svg',
  'mdi-chart-arc': 'chart-pie.svg',
  'mdi-robot-outline': 'ai.svg',
  'mdi-account-cog-outline': 'face-smile.svg',
  'mdi-message-alert-outline': 'message-circle-exclamation.svg',
  'mdi-email-mark-as-unread': 'message-circle-question.svg',
  'mdi-calendar-check-outline': 'calendar-day.svg',
  'mdi-cash-multiple': 'dong.svg',
  'mdi-chart-bar': 'message-circle-chart-lines.svg',
  'mdi-filter-variant': 'lines-leaning.svg',
  'mdi-email-outline': 'mailbox.svg',
  'mdi-lock-outline': 'fingerprint.svg',
  'mdi-login': 'arrow-narrow-circle-broken-down.svg',
  'mdi-weather-night': 'moon.svg',
  'mdi-weather-sunny': 'sun.svg',
  'mdi-bell-outline': 'bell-alt-1.svg',
  'mdi-source-branch': 'code-branch.svg',
  'mdi-magnify': 'search-alt-1.svg',
  'mdi-account-details-outline': 'water.svg',
  'mdi-send': 'send.svg',
  'mdi-account': 'user-alt.svg',
  'mdi-message-processing': 'zalo.svg',
  'mdi-delete': 'trash-xmark-alt.svg',
  'mdi-shield-account': 'shield-keyhole.svg',
  'mdi-plus': 'plus-large.svg',
  'mdi-cart': 'basket-shopping-alt.svg',
  'mdi-check-circle': 'check.svg',
  'mdi-currency-usd': 'dong.svg',
  'mdi-calendar-today': 'calendar-day.svg',
  'mdi-lightning-bolt-outline': 'bolt.svg',
  'mdi-flash': 'bolt.svg',
  'mdi-history': 'keyboard-alt.svg',
  'mdi-cog-outline': 'auto.svg',
  'mdi-check-decagram': 'check.svg',
  'mdi-pencil': 'pen.svg',
  'mdi-lock-reset': 'fingerprint.svg',
};

/**
 * Resolve an icon key (mdi-*, *.svg, svg:*, or basename) to its SVG string
 */
export function getSvgContent(iconKey?: unknown): string | null {
  if (typeof iconKey !== 'string') return null;
  const cleanKey = iconKey.trim().replace(/^svg:/, '').toLowerCase();

  // 1. Check direct registry by name (e.g. "dashboard.svg", "dashboard")
  if (svgRegistry.has(cleanKey)) {
    return svgRegistry.get(cleanKey)!;
  }

  // 2. Check MDI mapping table (e.g. "mdi-view-dashboard-outline")
  const mappedTarget = mdiToSvgMap[cleanKey];
  if (mappedTarget && svgRegistry.has(mappedTarget.toLowerCase())) {
    return svgRegistry.get(mappedTarget.toLowerCase())!;
  }

  return null;
}

/**
 * Custom Vuetify IconSet:
 * - If the icon matches our SVG registry or MDI mapping, render inline SVG
 * - Otherwise, fall back to standard @mdi/font icon class
 */
export const customIconSet: IconSet = {
  component: (props: IconProps) => {
    const svg = getSvgContent(props.icon);

    if (svg) {
      return h(props.tag, {
        class: 'v-icon--custom-svg',
        innerHTML: svg,
      });
    }

    // Fallback to standard @mdi/font icon
    const iconClass = typeof props.icon === 'string' ? props.icon : '';
    return h(props.tag, {
      class: ['mdi', iconClass],
    });
  },
};
