import { describe, it, expect } from 'vitest';
import { lexTti } from '../../src/tti/ttiLexer.js';
import { parseTtiRecords } from '../../src/tti/ttiParser.js';

describe('TTI Parser', () => {
  it('parses a single page with PN', () => {
    const records = lexTti('PN,10000\nOL,0,Hello');
    const result = parseTtiRecords(records);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].pageNumber).toBe(0x100);
  });

  it('parses description from DE', () => {
    const records = lexTti('DE,Test Page\nPN,10000');
    const result = parseTtiRecords(records);
    // DE before PN — no active page, so DE is lost
    // DE after PN is associated with the page
    expect(result.pages).toHaveLength(1);
  });

  it('parses DE after PN', () => {
    const records = lexTti('PN,10000\nDE,My Page');
    const result = parseTtiRecords(records);
    expect(result.pages[0].description).toBe('My Page');
  });

  it('parses cycle timing from CT', () => {
    const records = lexTti('PN,10000\nCT,8,C');
    const result = parseTtiRecords(records);
    expect(result.pages[0].cycleMode).toBe('cycle');
    expect(result.pages[0].cycleValue).toBe(8);
  });

  it('parses time-based CT', () => {
    const records = lexTti('PN,10000\nCT,15,T');
    const result = parseTtiRecords(records);
    expect(result.pages[0].cycleMode).toBe('time');
    expect(result.pages[0].cycleValue).toBe(15);
  });

  it('parses subcode from SC', () => {
    const records = lexTti('PN,10000\nSC,0003');
    const result = parseTtiRecords(records);
    expect(result.pages[0].subcode).toBe(3);
  });

  it('parses page status from PS', () => {
    const records = lexTti('PN,10000\nPS,8001');
    const result = parseTtiRecords(records);
    expect(result.pages[0].pageStatus).toBe(0x8001);
  });

  it('parses OL records', () => {
    const records = lexTti('PN,10000\nOL,0,Header text\nOL,5,Row 5 text');
    const result = parseTtiRecords(records);
    expect(result.pages[0].outputLines).toHaveLength(2);
    expect(result.pages[0].outputLines[0].lineNumber).toBe(0);
    expect(result.pages[0].outputLines[0].content).toBe('Header text');
    expect(result.pages[0].outputLines[1].lineNumber).toBe(5);
  });

  it('parses FL records', () => {
    const records = lexTti('PN,10000\nFL,200,300,400,500,100,8FF');
    const result = parseTtiRecords(records);
    expect(result.pages[0].fastextLinks).toEqual([0x200, 0x300, 0x400, 0x500, 0x100, 0x8FF]);
  });

  it('handles multiple pages', () => {
    const input = 'PN,10000\nOL,0,Page 1\nPN,20000\nOL,0,Page 2';
    const records = lexTti(input);
    const result = parseTtiRecords(records);
    expect(result.pages).toHaveLength(2);
  });

  it('preserves unknown records at service level', () => {
    const records = lexTti('XX,unknown\nPN,10000');
    const result = parseTtiRecords(records);
    expect(result.servicePreserved).toHaveLength(1);
    expect(result.servicePreserved[0].command).toBe('XX');
  });

  it('preserves unknown records at page level', () => {
    const records = lexTti('PN,10000\nXX,vendor data');
    const result = parseTtiRecords(records);
    expect(result.pages[0].preservedRecords).toHaveLength(1);
    expect(result.pages[0].preservedRecords[0].command).toBe('XX');
  });

  it('handles empty OL content', () => {
    const records = lexTti('PN,10000\nOL,5,');
    const result = parseTtiRecords(records);
    expect(result.pages[0].outputLines[0].content).toBe('');
  });
});
