import { describe, it, expect } from 'vitest';
import type {
  TeletextToken,
  CharToken,
  MosaicToken,
  ControlToken,
  FillToken,
  CommentToken,
  TeletextRow,
  TeletextSubpage,
  TeletextPage,
  TeletextService,
} from '../../src/model/types.js';

describe('Token type discriminants', () => {
  it('char token has kind "char"', () => {
    const t: CharToken = { kind: 'char', codepoint7: 0x41 };
    expect(t.kind).toBe('char');
    expect(t.codepoint7).toBe(0x41);
  });

  it('mosaic token has kind "mosaic" with contiguous flag', () => {
    const t: MosaicToken = { kind: 'mosaic', codepoint7: 0x3F, contiguous: true };
    expect(t.kind).toBe('mosaic');
    expect(t.contiguous).toBe(true);
  });

  it('control token has kind "control"', () => {
    const t: ControlToken = { kind: 'control', codepoint7: 0x01 };
    expect(t.kind).toBe('control');
    expect(t.codepoint7).toBe(0x01);
  });

  it('fill token has kind "fill" with count', () => {
    const t: FillToken = { kind: 'fill', count: 40, codepoint7: 0x20 };
    expect(t.kind).toBe('fill');
    expect(t.count).toBe(40);
  });

  it('comment token has kind "comment"', () => {
    const t: CommentToken = { kind: 'comment', text: 'editor note' };
    expect(t.kind).toBe('comment');
  });

  it('TeletextToken union accepts all token kinds', () => {
    const tokens: TeletextToken[] = [
      { kind: 'char', codepoint7: 0x41 },
      { kind: 'mosaic', codepoint7: 0x3F, contiguous: true },
      { kind: 'control', codepoint7: 0x07 },
      { kind: 'fill', count: 5, codepoint7: 0x20 },
      { kind: 'comment', text: 'test' },
    ];
    expect(tokens.length).toBe(5);
  });
});
