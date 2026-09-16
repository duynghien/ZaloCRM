import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getSvgContent } from '../src/plugins/custom-icons';

describe('UI & Layout Modifications Validation', () => {
  describe('AccountRail Desktop padding fix', () => {
    it('ensures .account-rail-desktop .rail-items-container has padding: 4px and not padding: 0 4px', () => {
      const filePath = path.resolve(__dirname, '../src/components/chat/AccountRail.vue');
      expect(fs.existsSync(filePath), 'AccountRail.vue exists').toBe(true);

      const content = fs.readFileSync(filePath, 'utf8');

      // Match the style block for .account-rail-desktop .rail-items-container
      const ruleRegex = /\.account-rail-desktop\s+\.rail-items-container\s*\{([^}]+)\}/;
      const match = content.match(ruleRegex);

      expect(match, 'CSS rule for .account-rail-desktop .rail-items-container found').not.toBeNull();
      const ruleBody = match![1];

      expect(ruleBody).toContain('padding: 4px;');
      expect(ruleBody).not.toContain('padding: 0 4px;');
    });
  });

  describe('AI Provider Settings Tabs Icons', () => {
    const aiProviderCardPath = path.resolve(
      __dirname,
      '../src/components/ai-reports/AiProviderSettingsCard.vue'
    );

    it('ensures AiProviderSettingsCard.vue has no emoji characters in provider tabs', () => {
      expect(fs.existsSync(aiProviderCardPath), 'AiProviderSettingsCard.vue exists').toBe(true);
      const content = fs.readFileSync(aiProviderCardPath, 'utf8');

      // Extract the <v-tabs ...>...</v-tabs> block for provider selection
      const tabsRegex = /<v-tabs[^>]*v-model="selectedTab"[^>]*>([\s\S]*?)<\/v-tabs>/;
      const tabsMatch = content.match(tabsRegex);
      expect(tabsMatch, 'Provider selection <v-tabs> block found').not.toBeNull();

      const tabsContent = tabsMatch![1];

      // Emojis must be removed
      expect(tabsContent).not.toContain('🔵');
      expect(tabsContent).not.toContain('🐋');
      expect(tabsContent).not.toContain('🟢');
      expect(tabsContent).not.toContain('⚙️');

      // Official icons must be present
      expect(tabsContent).toContain('gemini.svg');
      expect(tabsContent).toContain('deepseek.svg');
      expect(tabsContent).toContain('openai.svg');
      expect(tabsContent).toContain('auto.svg');

      // Tab labels must remain intact
      expect(tabsContent).toContain('Gemini');
      expect(tabsContent).toContain('DeepSeek');
      expect(tabsContent).toContain('OpenAI');
      expect(tabsContent).toContain('Custom');
    });

    it('ensures the default system chip does not use gear emoji', () => {
      const content = fs.readFileSync(aiProviderCardPath, 'utf8');
      expect(content).not.toContain('⚙️ Đang dùng cấu hình mặc định');
      expect(content).toContain('Đang dùng cấu hình mặc định');
      expect(content).toContain('auto.svg');
    });
  });

  describe('Brand Vector SVG Icons Integrity', () => {
    const icons = [
      { name: 'gemini.svg', base: 'gemini' },
      { name: 'deepseek.svg', base: 'deepseek' },
      { name: 'openai.svg', base: 'openai' },
      { name: 'auto.svg', base: 'auto' },
    ];

    for (const icon of icons) {
      it(`validates SVG file integrity and custom-icons registration for ${icon.name}`, () => {
        const filePath = path.resolve(__dirname, '../public/icons', icon.name);
        expect(fs.existsSync(filePath), `Icon file ${icon.name} exists in public/icons`).toBe(true);

        const raw = fs.readFileSync(filePath, 'utf8');
        expect(raw).toContain('<svg');
        expect(raw).toContain('viewBox="0 0 24 24"');
        expect(raw).toContain('fill="currentColor"');

        // Test resolution via custom-icons registry
        const byFullName = getSvgContent(icon.name);
        const byBaseName = getSvgContent(icon.base);

        expect(byFullName, `Resolved ${icon.name}`).not.toBeNull();
        expect(byBaseName, `Resolved ${icon.base}`).not.toBeNull();
        expect(byFullName).toBe(byBaseName);

        // Vuetify class injection test
        expect(byFullName).toContain('class="v-icon__svg"');
        expect(byFullName).not.toContain('fill="black"');
      });
    }
  });
});
