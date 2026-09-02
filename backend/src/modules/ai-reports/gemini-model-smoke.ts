import { config } from '../../config/index.js';
import { validateConfiguredGeminiModel } from './ai-client.js';

await validateConfiguredGeminiModel(true);
console.log(`Gemini model ${config.geminiModel} supports generateContent.`);
