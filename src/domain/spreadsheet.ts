// Lecture d'un classeur (CSV / XLSX) DEPOSE par l'utilisateur -> en-tetes + lignes.
//
// SECURITE (§6.1) — un fichier importe est une ENTREE NON FIABLE :
//  1) On utilise SheetJS 0.20.3, qui corrige la pollution de prototype (CVE-2023-30533) et le
//     ReDoS (CVE-2024-22363). La version 0.18.5 du registre npm (abandonnee) etait vulnerable ;
//     la version corrigee s'installe depuis le CDN SheetJS (cf. package.json).
//  2) Le parsing tourne dans un WEB WORKER (parseSpreadsheetOffThread) : un eventuel defaut
//     FUTUR du parseur (pollution de prototype, ReDoS, explosion memoire) reste ISOLE du thread
//     principal -> ni l'etat de l'application ni la reactivite de l'UI ne sont compromis.
export interface ParsedSheet {
  headers: string[];
  rows: unknown[][];
}

// Parsing PUR (utilise tel quel par le worker, et en repli sur le thread principal).
export async function parseSpreadsheet(buf: ArrayBuffer): Promise<ParsedSheet> {
  const XLSX = await import('xlsx');
  // cellDates -> les dates deviennent des objets Date ; on les normalise en ISO nous-memes
  // (sinon Excel/CSV les rendrait au format LOCAL, ex. "1/5/24"). §6.6.
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cell = (c: unknown): unknown => (c instanceof Date ? iso(c) : (c ?? ''));
  const headers = (aoa[0] ?? []).map((h) => String(cell(h)).trim()); // garde TOUTES les colonnes (meme vides)
  const rows = aoa.slice(1).map((r) => r.map(cell)).filter((r) => r.some((c) => String(c).trim() !== ''));
  return { headers, rows };
}

// §5.3 : delai maximum de parsing -> au-dela, on termine le worker et on abandonne (anti fichier
// hostile / zip-bomb / parsing sans fin). 30 s : largement au-dessus d'un fichier <= 5000 lignes.
const PARSE_TIMEOUT_MS = 30_000;

// Parse HORS du thread principal quand c'est possible (Web Worker).
// §5.4 — Le repli sur le thread principal n'a lieu QUE si les Workers sont INDISPONIBLES (vieux
// navigateur, jsdom/tests) ou si la CREATION du worker echoue. Une fois le worker cree, une erreur
// (ou un timeout) de parsing N'EST PAS rejouee sur le thread principal : un fichier potentiellement
// hostile ne doit pas etre execute une 2e fois cote React. On propage l'erreur a l'appelant.
export async function parseSpreadsheetOffThread(buf: ArrayBuffer): Promise<ParsedSheet> {
  if (typeof Worker === 'undefined') return parseSpreadsheet(buf); // pas de Worker -> repli legitime
  let worker: Worker;
  try {
    worker = new Worker(new URL('./spreadsheet.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return parseSpreadsheet(buf); // creation impossible (env sans worker module) -> repli legitime
  }
  return runWorker(worker, buf);
}

function runWorker(worker: Worker, buf: ArrayBuffer): Promise<ParsedSheet> {
  return new Promise<ParsedSheet>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Lecture du fichier interrompue (delai depasse).'));
    }, PARSE_TIMEOUT_MS);
    const finish = (fn: () => void) => { clearTimeout(timer); worker.terminate(); fn(); };
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: ParsedSheet; error?: string }>) => {
      const d = e.data;
      if (d.ok && d.result) finish(() => resolve(d.result as ParsedSheet));
      else finish(() => reject(new Error(d.error ?? 'Echec du parsing du fichier')));
    };
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'Echec du worker de parsing')));
    worker.postMessage(buf);
  });
}
