// Web Worker (§6.1) : parse un classeur (CSV/XLSX) NON FIABLE hors du thread principal.
// Toute faille du parseur (pollution de prototype, ReDoS, explosion memoire) reste confinee ici.
import { parseSpreadsheet, type ParsedSheet } from './spreadsheet';

// Contexte worker type minimalement (evite d'exiger la lib TS "WebWorker").
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ArrayBuffer>) => void) | null;
  postMessage(message: { ok: boolean; result?: ParsedSheet; error?: string }): void;
};

ctx.onmessage = async (e) => {
  try {
    const result = await parseSpreadsheet(e.data);
    ctx.postMessage({ ok: true, result });
  } catch (err) {
    ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
