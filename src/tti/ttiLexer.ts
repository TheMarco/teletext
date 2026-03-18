/**
 * TTI lexer: raw line reader + record tokenizer.
 *
 * Stage 1: normalize line endings, preserve raw lines.
 * Stage 2: parse each line into a TtiRecord { command, parts, raw, lineNumber }.
 *
 * Per 03_TTI_INTEROP.md.
 */

export interface TtiRecord {
  command: string;   // two-letter command (e.g., "PN", "OL", "DE")
  raw: string;       // original line text
  parts: string[];   // comma-separated payload parts
  lineNumber: number;
}

/**
 * Lex a TTI file into an array of records.
 * Blank lines and lines without a recognized command prefix are
 * preserved as records with command="" so they can be round-tripped.
 */
export function lexTti(input: string): TtiRecord[] {
  // Normalize line endings
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const records: TtiRecord[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNumber = i + 1;

    // Skip empty lines
    if (raw.trim() === '') continue;

    // TTI records start with a two-letter command followed by a comma
    const commaIndex = raw.indexOf(',');
    if (commaIndex >= 1 && commaIndex <= 3) {
      const command = raw.substring(0, commaIndex).trim().toUpperCase();
      const payload = raw.substring(commaIndex + 1);

      // For OL records, the first part is the line number,
      // and the rest is content that may contain commas.
      // We split only the first comma for the line number.
      let parts: string[];
      if (command === 'OL') {
        const olComma = payload.indexOf(',');
        if (olComma !== -1) {
          parts = [payload.substring(0, olComma), payload.substring(olComma + 1)];
        } else {
          parts = [payload];
        }
      } else {
        parts = payload.split(',');
      }

      records.push({ command, raw, parts, lineNumber });
    } else {
      // Unrecognized line — preserve as-is
      records.push({ command: '', raw, parts: [], lineNumber });
    }
  }

  return records;
}
