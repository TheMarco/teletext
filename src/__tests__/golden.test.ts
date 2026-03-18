import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { processPage } from '../state-machine/state-machine.js';
import { renderToBuffer, BUFFER_WIDTH, BUFFER_HEIGHT } from '../render-buffer/render-buffer.js';
import { GOLDEN_FIXTURES } from './golden/fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldenEntry {
  name: string;
  description: string;
  hash: string;
  width: number;
  height: number;
  dataLength: number;
}

const goldenPath = resolve(__dirname, 'golden', 'golden.json');
const goldenData: GoldenEntry[] = JSON.parse(readFileSync(goldenPath, 'utf-8'));
const goldenMap = new Map(goldenData.map(e => [e.name, e]));

function hashBuffer(data: Uint8ClampedArray): string {
  const hash = createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

describe('Golden tests: pixel-perfect rendering validation', () => {
  for (const fixture of GOLDEN_FIXTURES) {
    it(`${fixture.name}: ${fixture.description}`, () => {
      const golden = goldenMap.get(fixture.name);
      expect(golden).toBeDefined();

      const grid = processPage(fixture.page);
      const result = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);

      // Verify dimensions match
      expect(result.width).toBe(golden!.width);
      expect(result.height).toBe(golden!.height);
      expect(result.data.length).toBe(golden!.dataLength);

      // Verify pixel-perfect hash match
      const hash = hashBuffer(result.data);
      expect(hash).toBe(golden!.hash);
    });
  }
});

describe('Golden tests: determinism', () => {
  it('same input produces identical output across multiple renders', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      const grid = processPage(fixture.page);
      const r1 = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);
      const r2 = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);

      const h1 = hashBuffer(r1.data);
      const h2 = hashBuffer(r2.data);
      expect(h1).toBe(h2);
    }
  });

  it('rendering is order-independent (no shared mutable state)', () => {
    // Render fixtures in reverse order and verify same hashes
    const reversedFixtures = [...GOLDEN_FIXTURES].reverse();
    for (const fixture of reversedFixtures) {
      const golden = goldenMap.get(fixture.name);
      const grid = processPage(fixture.page);
      const result = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);
      const hash = hashBuffer(result.data);
      expect(hash).toBe(golden!.hash);
    }
  });
});

describe('Golden tests: structural invariants', () => {
  it('all pixels have full opacity (alpha = 255)', () => {
    for (const fixture of GOLDEN_FIXTURES) {
      const grid = processPage(fixture.page);
      const result = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);
      for (let i = 3; i < result.data.length; i += 4) {
        if (result.data[i] !== 255) {
          throw new Error(
            `${fixture.name}: pixel at byte ${i} has alpha ${result.data[i]}, expected 255`
          );
        }
      }
    }
  });

  it('all pixel RGB values are valid palette colors', () => {
    const validColors = new Set([
      '0,0,0',       // BLACK
      '255,0,0',     // RED
      '0,255,0',     // GREEN
      '255,255,0',   // YELLOW
      '0,0,255',     // BLUE
      '255,0,255',   // MAGENTA
      '0,255,255',   // CYAN
      '255,255,255', // WHITE
    ]);

    for (const fixture of GOLDEN_FIXTURES) {
      const grid = processPage(fixture.page);
      const result = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);
      for (let i = 0; i < result.data.length; i += 4) {
        const color = `${result.data[i]},${result.data[i + 1]},${result.data[i + 2]}`;
        if (!validColors.has(color)) {
          throw new Error(
            `${fixture.name}: invalid color ${color} at pixel ${i / 4}`
          );
        }
      }
    }
  });

  it('blank page has exactly zero foreground pixels', () => {
    const fixture = GOLDEN_FIXTURES.find(f => f.name === 'blank')!;
    const grid = processPage(fixture.page);
    const result = renderToBuffer(grid, fixture.flashPhase, fixture.reveal);
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(0);
      expect(result.data[i + 1]).toBe(0);
      expect(result.data[i + 2]).toBe(0);
    }
  });

  it('flash-off hides strictly more pixels than flash-on', () => {
    const onFixture = GOLDEN_FIXTURES.find(f => f.name === 'flash-on')!;
    const offFixture = GOLDEN_FIXTURES.find(f => f.name === 'flash-off')!;

    const gridOn = processPage(onFixture.page);
    const gridOff = processPage(offFixture.page);
    const rOn = renderToBuffer(gridOn, true, false);
    const rOff = renderToBuffer(gridOff, false, false);

    let fgOn = 0;
    let fgOff = 0;
    for (let i = 0; i < rOn.data.length; i += 4) {
      if (rOn.data[i] > 0 || rOn.data[i + 1] > 0 || rOn.data[i + 2] > 0) fgOn++;
      if (rOff.data[i] > 0 || rOff.data[i + 1] > 0 || rOff.data[i + 2] > 0) fgOff++;
    }
    expect(fgOn).toBeGreaterThan(fgOff);
  });

  it('conceal-revealed shows strictly more pixels than conceal-hidden', () => {
    const hiddenFixture = GOLDEN_FIXTURES.find(f => f.name === 'conceal-hidden')!;
    const revealedFixture = GOLDEN_FIXTURES.find(f => f.name === 'conceal-revealed')!;

    const gridH = processPage(hiddenFixture.page);
    const gridR = processPage(revealedFixture.page);
    const rH = renderToBuffer(gridH, true, false);
    const rR = renderToBuffer(gridR, true, true);

    let fgH = 0;
    let fgR = 0;
    for (let i = 0; i < rH.data.length; i += 4) {
      if (rH.data[i] > 0 || rH.data[i + 1] > 0 || rH.data[i + 2] > 0) fgH++;
      if (rR.data[i] > 0 || rR.data[i + 1] > 0 || rR.data[i + 2] > 0) fgR++;
    }
    expect(fgR).toBeGreaterThan(fgH);
  });
});
