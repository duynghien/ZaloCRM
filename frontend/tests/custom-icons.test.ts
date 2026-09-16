import { describe, it, expect } from 'vitest';
import { mdiToSvgMap, getSvgContent } from '../src/plugins/custom-icons';

describe('Custom SVG Icons Mapping & Registry', () => {
  it('should map all 41 requested MDI icons to existing SVG content', () => {
    const keys = Object.keys(mdiToSvgMap);
    expect(keys.length).toBe(41);

    for (const mdiKey of keys) {
      const svg = getSvgContent(mdiKey);
      expect(svg, `Expected SVG content for ${mdiKey}`).not.toBeNull();
      expect(svg).toContain('<svg');
      expect(svg).toContain('class="v-icon__svg');
      expect(svg).not.toContain('fill="black"');
    }
  });

  it('should resolve direct SVG filenames and base names', () => {
    const svgByName = getSvgContent('dashboard.svg');
    const svgByBase = getSvgContent('dashboard');
    const svgByMdi = getSvgContent('mdi-view-dashboard-outline');

    expect(svgByName).not.toBeNull();
    expect(svgByName).toBe(svgByBase);
    expect(svgByName).toBe(svgByMdi);

    // AI Provider icons
    expect(getSvgContent('gemini.svg')).not.toBeNull();
    expect(getSvgContent('gemini')).not.toBeNull();
    expect(getSvgContent('deepseek.svg')).not.toBeNull();
    expect(getSvgContent('deepseek')).not.toBeNull();
    expect(getSvgContent('openai.svg')).not.toBeNull();
    expect(getSvgContent('openai')).not.toBeNull();
  });

  it('should return null for unmapped icons so they fallback to MDI font', () => {
    expect(getSvgContent('mdi-api')).toBeNull();
    expect(getSvgContent('mdi-chevron-down')).toBeNull();
    expect(getSvgContent('mdi-close')).toBeNull();
    expect(getSvgContent('unknown-icon')).toBeNull();
  });
});
