/**
 * Validation functions for the page model.
 * Per 02_PAGE_MODEL_AND_SERVICE_BUNDLE.md validation rules.
 */

import type {
  TeletextPage,
  TeletextSubpage,
  TeletextRow,
  TeletextToken,
  TeletextService,
  FastextLinks,
  PageNumber,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types.js';
import { tokenDisplayWidth } from './factories.js';

const ROWS_PER_PAGE = 24;
const COLS_PER_ROW = 40;
const MIN_PAGE_NUMBER = 0x100;
const MAX_PAGE_NUMBER = 0x8FF;
const MAX_SUBCODE = 0x3F7F;

// ─── Page number validation ─────────────────────────────────────

export function isValidPageNumber(pageNumber: PageNumber): boolean {
  if (!Number.isInteger(pageNumber)) return false;
  if (pageNumber < MIN_PAGE_NUMBER || pageNumber > MAX_PAGE_NUMBER) return false;
  // Page units and tens must be valid BCD (0-9 each, but hex pages exist)
  // In practice, magazine 1-8 × page 00-FF
  const magazine = (pageNumber >> 8) & 0xF;
  return magazine >= 1 && magazine <= 8;
}

// ─── Subcode validation ─────────────────────────────────────────

export function isValidSubcode(subcode: number): boolean {
  return Number.isInteger(subcode) && subcode >= 0 && subcode <= MAX_SUBCODE;
}

// ─── Fastext validation ─────────────────────────────────────────

export function isValidFastextLink(link: number | null | undefined): boolean {
  if (link === null || link === undefined) return true;
  return isValidPageNumber(link);
}

function validateFastext(
  fastext: FastextLinks | null | undefined,
  errors: ValidationError[],
  path: string,
): void {
  if (!fastext) return;
  const keys = ['red', 'green', 'yellow', 'cyan', 'link', 'index'] as const;
  for (const key of keys) {
    const val = fastext[key];
    if (val !== null && val !== undefined && !isValidPageNumber(val)) {
      errors.push({
        code: 'INVALID_FASTEXT_LINK',
        message: `Invalid fastext ${key} link: ${val}`,
        path: `${path}.fastext.${key}`,
      });
    }
  }
}

// ─── Token validation ───────────────────────────────────────────

function validateToken(
  token: TeletextToken,
  errors: ValidationError[],
  path: string,
): void {
  switch (token.kind) {
    case 'char':
      if (token.codepoint7 < 0x20 || token.codepoint7 > 0x7F) {
        errors.push({
          code: 'INVALID_CHAR_CODE',
          message: `Char token codepoint out of range: 0x${token.codepoint7.toString(16)}`,
          path,
        });
      }
      break;
    case 'mosaic':
      if (token.codepoint7 < 0x20 || token.codepoint7 > 0x7F) {
        errors.push({
          code: 'INVALID_MOSAIC_CODE',
          message: `Mosaic token codepoint out of range: 0x${token.codepoint7.toString(16)}`,
          path,
        });
      }
      break;
    case 'control':
      if (token.codepoint7 < 0x00 || token.codepoint7 > 0x1F) {
        errors.push({
          code: 'INVALID_CONTROL_CODE',
          message: `Control token codepoint out of range: 0x${token.codepoint7.toString(16)}`,
          path,
        });
      }
      break;
    case 'fill':
      if (token.count < 0) {
        errors.push({
          code: 'INVALID_FILL_COUNT',
          message: `Fill token count is negative: ${token.count}`,
          path,
        });
      }
      break;
    case 'comment':
      // Always valid
      break;
  }
}

// ─── Row validation ─────────────────────────────────────────────

export function validateRow(
  row: TeletextRow,
  path: string,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (row.index < 0 || row.index > 23) {
    errors.push({
      code: 'INVALID_ROW_INDEX',
      message: `Row index out of range: ${row.index}`,
      path,
    });
  }

  const width = tokenDisplayWidth(row.tokens);
  if (width > COLS_PER_ROW) {
    warnings.push({
      code: 'ROW_TOO_WIDE',
      message: `Row ${row.index} has ${width} columns (max ${COLS_PER_ROW})`,
      path,
    });
  }

  for (let i = 0; i < row.tokens.length; i++) {
    validateToken(row.tokens[i], errors, `${path}.tokens[${i}]`);
  }

  return { errors, warnings };
}

// ─── Subpage validation ─────────────────────────────────────────

export function validateSubpage(subpage: TeletextSubpage): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isValidSubcode(subpage.subcode)) {
    errors.push({
      code: 'INVALID_SUBCODE',
      message: `Invalid subcode: ${subpage.subcode}`,
      path: 'subcode',
    });
  }

  if (subpage.rows.length !== ROWS_PER_PAGE) {
    errors.push({
      code: 'INVALID_ROW_COUNT',
      message: `Subpage must have exactly ${ROWS_PER_PAGE} rows, got ${subpage.rows.length}`,
      path: 'rows',
    });
  }

  for (let i = 0; i < subpage.rows.length; i++) {
    const rowResult = validateRow(subpage.rows[i], `rows[${i}]`);
    errors.push(...rowResult.errors);
    warnings.push(...rowResult.warnings);
  }

  // Check row indices are sequential 0..23
  for (let i = 0; i < subpage.rows.length; i++) {
    if (subpage.rows[i].index !== i) {
      warnings.push({
        code: 'ROW_INDEX_MISMATCH',
        message: `Row at position ${i} has index ${subpage.rows[i].index}`,
        path: `rows[${i}]`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Page validation ────────────────────────────────────────────

export function validatePage(page: TeletextPage): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isValidPageNumber(page.pageNumber)) {
    errors.push({
      code: 'INVALID_PAGE_NUMBER',
      message: `Invalid page number: 0x${page.pageNumber.toString(16)}`,
      path: 'pageNumber',
    });
  }

  if (page.subpages.length === 0) {
    errors.push({
      code: 'NO_SUBPAGES',
      message: 'Page must have at least one subpage',
      path: 'subpages',
    });
  }

  validateFastext(page.fastext, errors, 'page');

  // Validate each subpage
  for (let i = 0; i < page.subpages.length; i++) {
    const spResult = validateSubpage(page.subpages[i]);
    for (const err of spResult.errors) {
      errors.push({ ...err, path: `subpages[${i}].${err.path ?? ''}` });
    }
    for (const warn of spResult.warnings) {
      warnings.push({ ...warn, path: `subpages[${i}].${warn.path ?? ''}` });
    }
  }

  // Check for duplicate subcodes
  const subcodes = new Set<number>();
  for (let i = 0; i < page.subpages.length; i++) {
    const sc = page.subpages[i].subcode;
    if (subcodes.has(sc)) {
      errors.push({
        code: 'DUPLICATE_SUBCODE',
        message: `Duplicate subcode ${sc} in subpages`,
        path: `subpages[${i}]`,
      });
    }
    subcodes.add(sc);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Service validation ─────────────────────────────────────────

export function validateService(service: TeletextService): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!service.id) {
    errors.push({
      code: 'MISSING_SERVICE_ID',
      message: 'Service must have an id',
      path: 'id',
    });
  }

  // Check for duplicate page numbers
  const pageNumbers = new Set<number>();
  for (let i = 0; i < service.pages.length; i++) {
    const pn = service.pages[i].pageNumber;
    if (pageNumbers.has(pn)) {
      errors.push({
        code: 'DUPLICATE_PAGE_NUMBER',
        message: `Duplicate page number 0x${pn.toString(16)}`,
        path: `pages[${i}]`,
      });
    }
    pageNumbers.add(pn);

    const pageResult = validatePage(service.pages[i]);
    for (const err of pageResult.errors) {
      errors.push({ ...err, path: `pages[${i}].${err.path ?? ''}` });
    }
    for (const warn of pageResult.warnings) {
      warnings.push({ ...warn, path: `pages[${i}].${warn.path ?? ''}` });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
