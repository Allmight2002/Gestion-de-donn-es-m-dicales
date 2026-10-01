// Repli LEXICAL du codage assiste : sans LLM, a partir du seul texte du medecin.
// Module sans dependance externe : il sert aussi au calibrage (test/terminology-calibration.test.ts).
import type { DiagnosisInterpretation } from './scoring.ts';

export const MAX_DIAGNOSES = 5;

// Abreviations frequentes, developpees vers les intitules de la classification. Liste
// volontairement courte : c'est un repli, pas un dictionnaire medical.
const ABBREVIATIONS: Record<string, { normalized: string; terms: string[] }> = {
  hsd: { normalized: 'Hématome sous-dural', terms: ['Hémorragie sousdurale', 'Hématome sous-dural'] },
  hed: { normalized: 'Hématome extradural', terms: ['Hémorragie extradurale', 'Hématome extradural'] },
  hsa: { normalized: 'Hémorragie sous-arachnoïdienne', terms: ['Hémorragie sous-arachnoïdienne'] },
  hic: { normalized: 'Hémorragie intracérébrale', terms: ['Hémorragie intracérébrale'] },
  hip: { normalized: 'Hémorragie intraparenchymateuse', terms: ['Hémorragie intracérébrale'] },
  tce: { normalized: 'Traumatisme crânio-encéphalique', terms: ['Traumatisme intracrânien', 'Lésion intracrânienne'] },
  avc: { normalized: 'Accident vasculaire cérébral', terms: ['Accident vasculaire cérébral'] },
  hta: { normalized: 'Hypertension artérielle', terms: ['Hypertension essentielle', 'Hypertension'] },
  hdh: { normalized: 'Hernie discale', terms: ['Hernie discale'] },
  lcs: { normalized: 'Fuite de liquide cérébrospinal', terms: ['Fuite de liquide cérébrospinal'] },
  ait: { normalized: 'Accident ischémique transitoire', terms: ['Accident ischémique transitoire'] },
  bpco: {
    normalized: 'Bronchopneumopathie chronique obstructive',
    terms: ['Bronchopneumopathie chronique obstructive'],
  },
  sep: { normalized: 'Sclérose en plaques', terms: ['Sclérose en plaques'] },
  mav: { normalized: 'Malformation artérioveineuse', terms: ['Malformation artérioveineuse cérébrale'] },
  gbm: { normalized: 'Glioblastome', terms: ['Glioblastome du cerveau'] },
  dt1: { normalized: 'Diabète de type 1', terms: ['Diabète sucré de type 1'] },
  dt2: { normalized: 'Diabète de type 2', terms: ['Diabète sucré de type 2'] },
  idm: { normalized: 'Infarctus du myocarde', terms: ['Infarctus aigu du myocarde'] },
};

/** Repli sans LLM : decoupage sur les separateurs explicites, abreviations developpees. */
export function lexicalInterpretation(text: string): DiagnosisInterpretation[] {
  return text
    .split(/[;\n+]|,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .slice(0, MAX_DIAGNOSES)
    .map((part) => {
      const words = part.split(/\s+/);
      const abbreviation = ABBREVIATIONS[words[0].toLowerCase()];
      if (!abbreviation) {
        return { normalized: part, searchTerms: [part], ambiguous: false, alternativeTerms: [] };
      }
      const rest = words.slice(1).join(' ');
      const normalized = rest ? `${abbreviation.normalized} ${rest}` : abbreviation.normalized;
      // Le qualificatif ecrit (« traumatique », « remittente ») reste dans le terme PREFERE :
      // sans lui, l'intitule generique l'emporterait sur l'intitule precis.
      const qualified = rest ? abbreviation.terms.map((t) => `${t} ${rest}`) : [];
      return {
        normalized,
        searchTerms: [...qualified, ...abbreviation.terms, normalized],
        ambiguous: false,
        alternativeTerms: [],
      };
    });
}
