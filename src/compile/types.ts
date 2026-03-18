/**
 * Compiler output types per 04_PACKET_COMPILER.md.
 */

import type { CompileDiagnostic } from './diagnostics.js';

export interface CompiledDisplayRow {
  rowNumber: number;
  bytes40: Uint8Array;
}

export interface CompiledPacket {
  magazine: number;
  packetNumber: number;
  designationCode?: number;
  payload: Uint8Array;
}

export interface CompiledPagePayload {
  pageNumber: number;
  subcode: number;
  headerPacket: CompiledPacket;
  displayPackets: CompiledPacket[];
  extensionPackets: CompiledPacket[];
  diagnostics: CompileDiagnostic[];
}

export interface CompiledServiceBundle {
  pages: CompiledPagePayload[];
  diagnostics: CompileDiagnostic[];
}

export interface CompilerFeatureFlags {
  enablePacket25: boolean;
  enablePacket26: boolean;
  enablePacket27: boolean;
  enablePacket28: boolean;
}

export const DEFAULT_FEATURE_FLAGS: CompilerFeatureFlags = {
  enablePacket25: false,
  enablePacket26: false,
  enablePacket27: false,
  enablePacket28: false,
};
