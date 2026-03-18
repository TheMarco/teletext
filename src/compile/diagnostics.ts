/**
 * Compiler diagnostics per 04_PACKET_COMPILER.md.
 */

export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  pageNumber?: number;
  subcode?: number;
  row?: number;
  col?: number;
}

export class DiagnosticCollector {
  readonly diagnostics: CompileDiagnostic[] = [];

  error(code: string, message: string, context?: Partial<CompileDiagnostic>): void {
    this.diagnostics.push({ severity: 'error', code, message, ...context });
  }

  warning(code: string, message: string, context?: Partial<CompileDiagnostic>): void {
    this.diagnostics.push({ severity: 'warning', code, message, ...context });
  }

  hasErrors(): boolean {
    return this.diagnostics.some(d => d.severity === 'error');
  }

  get errors(): CompileDiagnostic[] {
    return this.diagnostics.filter(d => d.severity === 'error');
  }

  get warnings(): CompileDiagnostic[] {
    return this.diagnostics.filter(d => d.severity === 'warning');
  }
}
