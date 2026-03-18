/**
 * Golden reference generator.
 *
 * Run with: npx tsx src/__tests__/golden/generate.ts
 *
 * Generates SHA-256 hashes of rendered pixel data for each fixture.
 * These hashes are stored in golden.json and used by the golden tests
 * to verify pixel-perfect rendering.
 *
 * Regenerate whenever the rendering pipeline intentionally changes.
 */

import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processPage } from '../../state-machine/state-machine.js';
import { renderToBuffer } from '../../render-buffer/render-buffer.js';
import { GOLDEN_FIXTURES } from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldenEntry {
  name: string;
  description: string;
  hash: string;      // SHA-256 of RGBA pixel data
  width: number;
  height: number;
  dataLength: number;
}

function hashBuffer(data: Uint8ClampedArray): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

const entries: GoldenEntry[] = [];

for (const fixture of GOLDEN_FIXTURES) {
  const grid = processPage(fixture.page);
  const result = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);
  const hash = hashBuffer(result.data);

  entries.push({
    name: fixture.name,
    description: fixture.description,
    hash,
    width: result.width,
    height: result.height,
    dataLength: result.data.length,
  });

  console.log(`  ${fixture.name}: ${hash.slice(0, 16)}...`);
}

const outputPath = resolve(__dirname, 'golden.json');
writeFileSync(outputPath, JSON.stringify(entries, null, 2) + '\n');
console.log(`\nWrote ${entries.length} golden entries to ${outputPath}`);
