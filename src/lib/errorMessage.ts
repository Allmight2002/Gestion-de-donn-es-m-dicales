// Extrait un message LISIBLE d'une erreur quelconque.
// Les erreurs Supabase / PostgREST ne sont PAS des instances d'Error : ce sont des objets
// { message, details, hint, code }. Le test `e instanceof Error` echoue donc, et l'UI affichait
// un message generique au lieu du VRAI motif renvoye par le serveur. On lit ici aussi `.message`
// (et quelques variantes) sur les objets pour faire remonter l'erreur reelle.
// Jetons techniques -> message ACTIONNABLE. NB : la detection de conflit de la synchro
// hors-ligne (offline.ts, isConflict) lit err.message BRUT et n'est donc pas affectee.
function humanize(message: string): string {
  if (/L69_OPERATION_MISMATCH/i.test(message)) {
    return 'Cette occurrence est liee a une autre operation. Rechargez la fiche avant de reessayer.';
  }
  if (/L69_OPERATION_INCOMPLETE/i.test(message)) {
    return "Le serveur n'a pas confirme cette occurrence. Reprenez la ligne pour retrouver son etat avant de continuer.";
  }
  if (/L69_OPERATION_INVALID/i.test(message)) {
    return "Cette occurrence ne respecte pas les parametres attendus et n'a pas ete enregistree.";
  }
  if (/L69_OCCURRENCE_PATIENT_NOT_FOUND/i.test(message)) {
    return "Le patient associe a cette occurrence n'existe plus. Rechargez la fiche avant de continuer.";
  }
  if (/WRITE_NOT_FOUND/i.test(message)) {
    return "La ressource n'existe plus. Rechargez la page avant de continuer.";
  }
  if (/WRITE_FORBIDDEN/i.test(message)) {
    return "L'enregistrement a ete refuse : vos droits ou votre affectation ont change.";
  }
  if (/WRITE_STALE/i.test(message)) {
    return 'Ces donnees ont ete modifiees entre-temps. Rechargez la page avant de reessayer.';
  }
  if (/WRITE_INVALID_STATE/i.test(message)) {
    return "Cette operation n'est plus possible dans l'etat actuel de la ressource. Rechargez la page.";
  }
  if (/WRITE_INVALID_INPUT/i.test(message)) {
    return "Les donnees envoyees ne respectent pas la structure attendue et n'ont pas ete enregistrees.";
  }
  if (/WRITE_FAILED/i.test(message)) {
    return "L'enregistrement n'a pas pu etre confirme. Aucun succes n'est affiche ; rechargez avant de reessayer.";
  }
  if (/CONFLIT_VERSION/i.test(message)) {
    return 'Cette rencontre a été modifiée entre-temps (autre utilisateur ou autre onglet). '
      + 'Rechargez la fiche pour voir la version à jour, puis réappliquez votre correction.';
  }
  // Gardes d'un bloc pilote par le diagnostic (assert_diagnosis_configuration) : elles tombent
  // pendant une restructuration du gabarit, sans que la contrainte soit visible a l'ecran.
  if (/DIAGNOSIS_BLOCK_NONCANONICAL/.test(message)) {
    return "Un bloc associé à un diagnostic ne porte qu'une seule règle d'affichage : celle du diagnostic "
      + '(« contient l’un de … » → bloc visible). Rien n’a été enregistré. Retirez l’autre règle de ce bloc, '
      + 'ou placez la condition sur une variable du bloc plutôt que sur le bloc lui-même.';
  }
  if (/DIAGNOSIS_BLOCK_EMPTY/.test(message)) {
    return 'Un bloc associé à un diagnostic doit garder au moins une variable propre, saisissable '
      + '(non calculée) et de même portée que le diagnostic, placée dans le bloc ou dans un sous-bloc '
      + 'non répétable : les variables d’un groupe répétable ne comptent pas. Rien n’a été enregistré.';
  }
  // Delai serveur depasse (PostgreSQL 57014). Le message brut (« canceling statement due to
  // statement timeout ») est un detail interne : il n'indique ni ce qui a echoue, ni quoi faire.
  // L'ecriture a pu aboutir avant l'interruption -- d'ou « rechargez » avant « reessayez ».
  if (/canceling statement due to|statement timeout/i.test(message)) {
    return "Le serveur a interrompu l'opération : elle a dépassé le temps autorisé. "
      + "Rechargez la page pour voir l'état réel avant de réessayer.";
  }
  return message;
}

type StructuredError = { code?: unknown; action?: unknown; hint?: unknown } & Record<string, unknown>;

const KEY_FORMAT = 'une minuscule sans accent en premier, puis seulement minuscules sans accent, chiffres et « _ », 63 caractères au plus';
const IMPORT_LISTS: Record<string, string> = {
  sections: 'blocs', commonGroups: 'rubriques communes', fields: 'variables', rules: 'règles',
  diagnosisConfiguration: 'configuration diagnostique', terminologyReleases: 'nomenclatures',
};
const IMPORT_STAGES: Record<string, string> = {
  template: 'création du jeu', sections: 'blocs', commonGroups: 'rubriques communes', fields: 'variables',
  rules: 'règles', diagnosisConfiguration: 'configuration diagnostique',
};

/** Motif d'un refus d'import (import_template_definition) : quoi corriger dans le fichier. */
function templateImportInvalidReason(d: StructuredError): string {
  const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  const key = text(d.key) ? ` « ${text(d.key)} »` : '';
  const at = text(d.position) ? ` (n° ${text(d.position)})` : '';
  switch (d.reason) {
    case 'payload_malformed': return 'Ce fichier ne contient pas de définition de jeu de variables.';
    case 'list_not_array': return `La liste des ${IMPORT_LISTS[text(d.list)] ?? 'éléments'} du fichier est mal formée.`;
    case 'too_many': return `Le fichier contient ${text(d.count)} ${IMPORT_LISTS[text(d.list)] ?? 'éléments'} : le maximum accepté est ${text(d.limit)}.`;
    case 'section_malformed': return `Un bloc du fichier est mal formé${at}.`;
    case 'section_key_invalid': return `Le code de bloc${key}${at} n'est pas accepté : ${KEY_FORMAT}.`;
    case 'section_label_missing': return `Le bloc${key} n'a pas de libellé.`;
    case 'section_parent_invalid': return `Le bloc${key} est rangé sous « ${text(d.parentKey)} », qui n'est pas un bloc de premier niveau du fichier.`;
    case 'section_repeat_label_invalid': return `Les libellés de saisie du bloc${key} sont mal formés : texte du bouton d'ajout de 80 caractères au plus, nom d'un élément de 60 au plus, sans espace en début ni en fin.`;
    case 'section_duplicate': return `Le code de bloc${key} apparaît plusieurs fois.`;
    case 'group_malformed': return `Une rubrique commune du fichier est mal formée${at}.`;
    case 'group_key_invalid': return `Le code de rubrique commune${key}${at} n'est pas accepté : ${KEY_FORMAT}.`;
    case 'group_label_missing': return `La rubrique commune${key} n'a pas de libellé.`;
    case 'group_duplicate': return `Le code de rubrique commune${key} apparaît plusieurs fois.`;
    case 'field_malformed': return `Une variable du fichier est mal formée${at}.`;
    case 'field_key_invalid': return `Le code de la variable${key}${at} est vide ou entouré d'espaces.`;
    case 'field_label_missing': return `La variable${key} n'a pas de libellé.`;
    case 'field_section_unknown': return `La variable${key} est rangée dans le bloc « ${text(d.section)} », absent du fichier.`;
    case 'field_group_unknown': return `La variable${key} est rangée dans la rubrique « ${text(d.group)} », absente du fichier.`;
    case 'field_duplicate': return `Le code de variable${key} apparaît plusieurs fois.`;
    case 'rule_malformed': return `La règle${at} du fichier est mal formée.`;
    case 'terminology_release_malformed': return `Une nomenclature citée par le fichier est mal décrite${at}.`;
    case 'diagnosis_configuration_malformed': return 'La configuration diagnostique du fichier est mal formée.';
    case 'terminology_reference_unknown': return 'Une règle ou la configuration diagnostique cite une nomenclature que le fichier ne décrit pas.';
    case 'content_incoherent': return `Le fichier est incohérent (étape : ${IMPORT_STAGES[text(d.stage)] ?? 'inconnue'}) : une valeur n'a pas le type attendu ou une contrainte n'est pas respectée. A-t-il été modifié à la main ?`;
    default: return "Ce fichier est incomplet ou incohérent (a-t-il été modifié à la main ?).";
  }
}

function structuredDetails(e: unknown): StructuredError | null {
  if (!e || typeof e !== 'object') return null;
  const object = e as Record<string, unknown>;
  for (const detailKey of ['details', 'detail'] as const) {
    if (typeof object[detailKey] !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(object[detailKey] as string);
      if (parsed && typeof parsed === 'object') return parsed as StructuredError;
    } catch {
      // Certaines bibliothèques utilisent `details` pour une phrase. Dans ce cas,
      // on conserve les attributs structurés directs éventuels.
    }
  }
  const direct = object as StructuredError;
  if ((typeof direct.code === 'string' && direct.code !== 'P0001') || typeof direct.action === 'string') return direct;
  return null;
}

/** Code fonctionnel renvoyé par une RPC, sans exposer ses détails cliniques. */
export function structuredErrorCode(e: unknown): string | null {
  const details = structuredDetails(e);
  return typeof details?.code === 'string' ? details.code : null;
}

/** Ces erreurs indiquent qu'une copie locale doit être rechargée avant toute nouvelle écriture. */
export function isRefreshRequiredError(e: unknown): boolean {
  const details = structuredDetails(e);
  const code = typeof details?.code === 'string' ? details.code : '';
  const action = typeof details?.action === 'string' ? details.action : '';
  const hint = typeof details?.hint === 'string' ? details.hint : '';
  const message = e instanceof Error ? e.message : e && typeof e === 'object'
    ? String((e as Record<string, unknown>).message ?? '') : String(e ?? '');
  return /^(block_hidden_value|contains_any_hidden_value|conflict_version)$/.test(code)
    || code === 'DRAFT_CONTEXT_CHANGED' || code === 'DRAFT_CONFLICT'
    || code === 'FORM_CONTEXT_CHANGED' || code === 'FORM_RECORD_CONFLICT'
    || action === 'refresh_required' || hint === 'refresh_required'
    || /CONFLIT_VERSION/i.test(message);
}

export function errorMessage(e: unknown, fallback: string): string {
  const code = structuredErrorCode(e);
  if (code === 'block_hidden_value' || code === 'contains_any_hidden_value') {
    return 'La fiche a été modifiée ou sa visibilité a changé entre-temps. Vos saisies sont conservées : rechargez les données avant de recommencer.';
  }
  if (code === 'conflict_version') {
    return 'La fiche a été modifiée entre-temps. Vos saisies sont conservées : rechargez les données avant de recommencer.';
  }
  if (code === 'FORM_CONTEXT_CHANGED' || code === 'FORM_RECORD_CONFLICT') {
    return 'La fiche ou son formulaire a changé entre-temps. Vos saisies sont conservées : rechargez les données avant de recommencer.';
  }
  if (code === 'FORM_FIELD_UNKNOWN') {
    return "La variable envoyée n'existe pas dans le formulaire de cette fiche. Vos saisies n'ont pas été enregistrées.";
  }
  if (code === 'FORM_SCOPE_INCOMPATIBLE') {
    return "La variable envoyée ne s'applique pas à cette fiche. Vos saisies n'ont pas été enregistrées.";
  }
  if (code === 'FORM_VALUE_CONVERSION_REQUIRED') {
    return "Cette modification nécessite une conversion explicite du formulaire. Vos saisies n'ont pas été enregistrées.";
  }
  // L72e — visibilité d'un groupe répétable en sous-section et retrait de ses occurrences.
  if (code === 'GROUP_BLOCK_HIDDEN') {
    return "Le bloc de ce groupe est masqué pour ce patient : l'occurrence ne peut être ni créée ni corrigée. Vos saisies sont conservées ; rechargez la fiche pour voir son état actuel.";
  }
  if (code === 'GROUP_WITHDRAWAL_CONFLICT' || code === 'GROUP_WITHDRAWAL_REQUIRED') {
    return "Les occurrences concernées par cet enregistrement (bloc masqué ou valeurs effacées) ont changé entre-temps. Rien n'a été enregistré ; vos saisies sont conservées : rechargez les données avant de recommencer.";
  }
  if (code === 'GROUP_WITHDRAWAL_FORBIDDEN') {
    return "Cet enregistrement masque un bloc qui porte des occurrences, et vous n'avez pas le droit de les supprimer. Rien n'a été enregistré.";
  }
  if (code === 'GROUP_WITHDRAWAL_OCCURRENCE_BLOCKED') {
    return "Une occurrence ne peut pas perdre la valeur que cette fiche masque : elle ne respecte plus une règle de son formulaire. Rien n'a été enregistré ; corrigez d'abord cette occurrence.";
  }
  if (code === 'GROUP_WITHDRAWAL_VERSION_REFUSED') {
    return 'Cette version du formulaire masquerait des blocs qui portent des occurrences enregistrées, ou des valeurs d’occurrences. Elle n’a pas été appliquée.';
  }
  // Transfert d'un jeu de variables par fichier : rien n'est cree quand l'un de ces refus tombe.
  if (code === 'TEMPLATE_IMPORT_FORMAT_UNSUPPORTED') {
    return "Ce fichier n'est pas un jeu de variables MedData pris en charge. Rien n'a été créé.";
  }
  if (code === 'TEMPLATE_IMPORT_TERMINOLOGY_MISSING') {
    return "Ce jeu de variables utilise une nomenclature absente de ce serveur. Rien n'a été créé.";
  }
  if (code === 'TEMPLATE_IMPORT_INVALID') {
    return `${templateImportInvalidReason(structuredDetails(e) ?? {})} Rien n'a été créé.`;
  }  if (code === 'FIELD_KEY_DIAGNOSIS_BOUND') {
    return 'Ce code ne peut pas être renommé : la variable pilote la configuration diagnostique, '
      + 'ou en est la proposition « _autre ». Les deux codes doivent rester appariés : retirez '
      + "d'abord la configuration diagnostique, renommez, puis reconfigurez-la. Rien n'a été enregistré.";
  }
  if (code === 'FIELD_KEY_FORMULA_INCOMPATIBLE') {
    const formulaField = structuredDetails(e)?.formulaField;
    return `Ce code ne peut pas être utilisé : la formule${typeof formulaField === 'string' ? ` de « ${formulaField} »` : ''} `
      + "utilise cette variable, et une formule n'accepte que lettres sans accent, chiffres et « _ » "
      + "(pas d'accent, d'espace ni de tiret). Rien n'a été enregistré.";
  }
  if (code === 'FIELD_KEY_RENAME_CONFLICT') {
    return 'Ce nom interne est déjà porté par une autre valeur dans au moins un dossier : '
      + "choisissez-en un autre. Rien n'a été enregistré.";
  }
  if (code === 'OPTION_REPLACEMENT_REQUIRED') {
    return 'Une option retirée est encore choisie dans des dossiers : choisissez une option de '
      + "remplacement ou videz ces valeurs. Rien n'a été enregistré.";
  }
  if (code === 'OPTION_REPLACEMENT_INVALID') {
    return "Le remplacement choisi n'est pas une option active de la liste. Rien n'a été enregistré.";
  }
  if (code === 'INVALID_BASE_NAME') {
    return "Le nom de la base doit compter entre 1 et 120 caractères. Rien n'a été enregistré.";
  }
  if (code === 'BASE_RENAME_FORBIDDEN') {
    return "Seul le propriétaire peut renommer cette base, et elle doit exister encore. Rien n'a été enregistré.";
  }
  if (code === 'BASE_RENAME_CONFLICT') {
    return "La base a été renommée entre-temps (autre onglet ou autre appareil). Rien n'a été enregistré : "
      + 'rechargez la page pour voir son nom actuel, puis recommencez si besoin.';
  }
  if (code === 'TEMPLATE_IMPORT_FORBIDDEN') {
    return "Votre rôle ne permet pas de créer un jeu de variables. Rien n'a été créé.";
  }
  if (code === 'TEMPLATE_EXPORT_NOT_FOUND') {
    return "Ce jeu de variables n'existe plus ou ne vous est pas accessible.";
  }
  if (code === 'FORM_RECORD_FORBIDDEN') {
    return "L'accès à cette fiche ou la permission de la modifier a changé. Vos saisies n'ont pas été enregistrées.";
  }
  if (e instanceof Error && e.message) return humanize(e.message);
  if (typeof e === 'string' && e) return humanize(e);
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    for (const k of ['message', 'error_description', 'error', 'hint', 'details']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return humanize(v);
    }
  }
  return fallback;
}
