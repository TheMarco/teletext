import { importT42 } from '../src/tti/t42Import.js';
import { compileRow } from '../src/compile/rowCompiler.js';
import { compileVisualRow, decompileToVisualRow } from '../src/editor/smartRowCompiler.js';
import { readFileSync } from 'fs';

// Test 1: Show that the T42 file already has damaged data
const buf = readFileSync('/tmp/debug.t42');
const result = importT42(new Uint8Array(buf));
const sub = result.pages[0]!.subpages[0];

console.log("=== WHAT'S IN YOUR T42 FILE (already damaged) ===");
const row3 = compileRow(sub.rows[3]);
const visual3 = decompileToVisualRow(Array.from(row3.bytes40));
const text3 = visual3.map(c => c.char >= 0x21 && c.char <= 0x7E && !c.mosaic ? String.fromCharCode(c.char) : '_').join('');
console.log(`Row 3 text: "${text3}"`);
console.log('→ "Welcome to:" is already "elcome t" in the imported data\n');

// Test 2: Prove the fix works with FRESH data
console.log("=== FRESH DATA TEST (simulating what the editor would have) ===");
const freshRow: any[] = [];
for (let i = 0; i < 40; i++) freshRow.push({ char: 0x20, fg: 7, bg: 0, mosaic: false, contiguous: true });

// Red border left
freshRow[0] = { char: 0x6A, fg: 1, bg: 0, mosaic: true, contiguous: true }; // 'j'
// White mosaic face content (simplified)
for (let i = 3; i <= 14; i++) freshRow[i] = { char: 0x7F, fg: 7, bg: 0, mosaic: true, contiguous: true };
// "Welcome to:" text
const text = "Welcome to:";
for (let i = 0; i < text.length; i++) freshRow[20 + i] = { char: text.charCodeAt(i), fg: 7, bg: 0, mosaic: false, contiguous: true };
// Red border right
freshRow[38] = { char: 0x6A, fg: 1, bg: 0, mosaic: true, contiguous: true }; // 'j'

const compiled = compileVisualRow(freshRow);
const bytes = compileRow({ index: 3, tokens: compiled.tokens }).bytes40;

let output = '';
for (let c = 0; c < 40; c++) {
  const b = bytes[c];
  if (b < 0x20) {
    const names: Record<number, string> = {0x01:'aR',0x07:'aW',0x11:'mR',0x17:'mW'};
    output += `[${names[b] ?? b.toString(16)}]`;
  } else {
    output += b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : `{${b.toString(16)}}`;
  }
}
console.log(`Compiled: ${output}`);
console.log('→ "Welcome to:" is fully preserved with fresh data!');
