/**
 * Build the AI-Created teletext service as a .t42 file.
 * Run with: npm run build:t42
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAICreatedService } from '../demo/ai-created-pages.js';
import { exportServiceToT42 } from '../src/tti/t42Export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'ai-created.t42');

const service = buildAICreatedService();
const t42 = exportServiceToT42(service);

writeFileSync(outPath, t42);
console.log(`Wrote ${t42.length} bytes (${Math.floor(t42.length / 42)} packets, ${service.pages.length} pages) to ${outPath}`);
