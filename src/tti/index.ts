export { lexTti } from './ttiLexer.js';
export type { TtiRecord } from './ttiLexer.js';
export { parseTtiRecords } from './ttiParser.js';
export type { TtiPageGroup, TtiOutputLine, TtiParseResult } from './ttiParser.js';
export { mapTtiGroupToSubpage, mapTtiToService, encodePageFlags, encodeLanguageSubset } from './ttiMapper.js';
export { exportPageToTti, exportServiceToTti } from './ttiExporter.js';
export type { TtiExportOptions } from './ttiExporter.js';
export {
  ttiByteToTeletext,
  teletextByteToTti,
  decodeOLContent,
  encodeOLContent,
} from './ttiTranslations.js';
export { importT42, extractTeletextLines, t42ToTti } from './t42Import.js';
export type { T42ImportResult } from './t42Import.js';
export { exportServiceToT42, exportPageToT42 } from './t42Export.js';

/**
 * Convenience: parse a TTI string all the way to a TeletextService.
 */
import { lexTti } from './ttiLexer.js';
import { parseTtiRecords } from './ttiParser.js';
import { mapTtiToService } from './ttiMapper.js';
import type { TeletextService } from '../model/types.js';

export function importTti(
  ttiText: string,
  serviceId?: string,
  serviceTitle?: string,
): TeletextService {
  const records = lexTti(ttiText);
  const parsed = parseTtiRecords(records);
  return mapTtiToService(parsed, serviceId, serviceTitle);
}
