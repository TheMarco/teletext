import { describe, it, expect } from 'vitest';
import { lexTti } from '../../src/tti/ttiLexer.js';

describe('TTI Lexer', () => {
  it('parses a simple PN record', () => {
    const records = lexTti('PN,10000');
    expect(records).toHaveLength(1);
    expect(records[0].command).toBe('PN');
    expect(records[0].parts).toEqual(['10000']);
  });

  it('parses multiple records', () => {
    const input = 'DE,Test Page\nPN,10000\nSC,0000';
    const records = lexTti(input);
    expect(records).toHaveLength(3);
    expect(records[0].command).toBe('DE');
    expect(records[1].command).toBe('PN');
    expect(records[2].command).toBe('SC');
  });

  it('handles OL records with content containing commas', () => {
    const input = 'OL,5,Hello, World';
    const records = lexTti(input);
    expect(records).toHaveLength(1);
    expect(records[0].command).toBe('OL');
    expect(records[0].parts[0]).toBe('5');
    expect(records[0].parts[1]).toBe('Hello, World');
  });

  it('skips blank lines', () => {
    const input = 'PN,10000\n\nOL,0,test\n';
    const records = lexTti(input);
    expect(records).toHaveLength(2);
  });

  it('normalizes line endings', () => {
    const input = 'PN,10000\r\nOL,0,test\rOL,1,test2';
    const records = lexTti(input);
    expect(records).toHaveLength(3);
  });

  it('preserves line numbers', () => {
    const input = '\nPN,10000\n\nOL,0,test';
    const records = lexTti(input);
    expect(records[0].lineNumber).toBe(2);
    expect(records[1].lineNumber).toBe(4);
  });

  it('preserves unrecognized lines as empty-command records', () => {
    const input = 'PN,10000\n# comment line\nOL,0,test';
    const records = lexTti(input);
    expect(records).toHaveLength(3);
    expect(records[1].command).toBe('');
    expect(records[1].raw).toBe('# comment line');
  });

  it('uppercases command names', () => {
    const records = lexTti('pn,10000');
    expect(records[0].command).toBe('PN');
  });

  it('handles FL with multiple comma-separated parts', () => {
    const records = lexTti('FL,200,300,400,500,100,8FF');
    expect(records[0].command).toBe('FL');
    expect(records[0].parts).toEqual(['200', '300', '400', '500', '100', '8FF']);
  });

  it('handles empty OL content', () => {
    const records = lexTti('OL,5,');
    expect(records[0].parts[0]).toBe('5');
    expect(records[0].parts[1]).toBe('');
  });
});
