// PAP-0 — les trois formulaires fictifs de la campagne « formulaire papier ».
//
// POURQUOI ICI. La mesure de baseline (PAP-0), le modele de placement (PAP-1), la
// prevusualisation (PAP-2) et la validation etudiante (PAP-4) doivent porter sur LES MEMES
// cas, sinon aucun gain n'est comparable a la reference. Ce module est donc la source unique
// des trois cas ; il ne contient que des donnees FICTIVES de demonstration — aucun libelle,
// code ou seuil repris d'un dossier reel.
//
// CE QUE CE MODULE N'EST PAS. Il ne decrit aucune mise en page : ni largeur, ni saut de page,
// ni nombre de lignes d'ecriture. Un cas est une VERSION DE FORMULAIRE ordinaire (version,
// variables, sections, regles), lue par les memes contrats que le produit. La presentation
// papier reste entierement du ressort de PAP-1 et suivants.
//
// LE CAS VOLUMINEUX N'EST PAS REDEFINI ICI : il reutilise `editorRegistryFixture`
// (216 variables / 24 sections / 26 regles), deja partagee avec les tests de l'editeur. La
// recopier en ferait deriver une seconde, et la campagne mesurerait deux contenus differents.

import type {
  TemplateCommonLayout,
  TemplateField,
  TemplateSection,
  TemplateVersion,
  ValidationRule,
} from '../../data/types';
import {
  EDITOR_REGISTRY_FIELD_COUNT,
  EDITOR_REGISTRY_RULE_COUNT,
  EDITOR_REGISTRY_SECTION_COUNT,
  editorRegistryFields,
  editorRegistryRules,
  editorRegistrySections,
  editorRegistryVersion,
} from './editorRegistry';

/** Identifiant stable d'un cas : il sert de cle de releve de PAP-0 a PAP-4. */
export type PaperFormCaseKey = 'court' | 'moyen' | 'volumineux';

export interface PaperFormCase {
  key: PaperFormCaseKey;
  /** Nom lisible, utilise dans les fiches de mesure et les bancs de verification. */
  label: string;
  /** Ce que le cas est cense representer dans la campagne. */
  intent: string;
  version: TemplateVersion;
  fields: TemplateField[];
  sections: TemplateSection[];
  rules: ValidationRule[];
}

function field(
  overrides: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label' | 'displayOrder'>,
): TemplateField {
  return {
    scope: 'encounter',
    section: null,
    type: 'text',
    unit: null,
    allowedValues: null,
    required: false,
    minValue: null,
    maxValue: null,
    allowMissingCodes: false,
    ...overrides,
  };
}

/** Options de liste dans la forme portee par la base (`allowed_options`). */
const options = (entries: readonly (readonly [string, string])[]) =>
  entries.map(([valueKey, label]) => ({ valueKey, label, isActive: true }));

const optionKeys = (entries: readonly (readonly [string, string])[]) => entries.map(([valueKey]) => valueKey);

function choice(
  base: Partial<TemplateField> & Pick<TemplateField, 'id' | 'fieldKey' | 'label' | 'displayOrder'>,
  type: 'select' | 'multiselect',
  entries: readonly (readonly [string, string])[],
): TemplateField {
  return field({
    ...base,
    type,
    allowedOptions: options(entries),
    allowedValues: optionKeys(entries),
  });
}

// ---------------------------------------------------------------------------
// Cas court — consultation de suivi. 18 variables, 3 sections, 2 regles.
// ---------------------------------------------------------------------------

const courtSections: TemplateSection[] = [
  { id: 'court-section-contexte', sectionKey: 'contexte', label: 'Contexte de la consultation', displayOrder: 0, parentSectionKey: null },
  { id: 'court-section-examen', sectionKey: 'examen', label: 'Examen clinique', displayOrder: 1, parentSectionKey: null },
  { id: 'court-section-constantes', sectionKey: 'constantes', label: 'Constantes', displayOrder: 2, parentSectionKey: 'examen' },
];

const TYPE_CONSULTATION = [
  ['premiere', 'Première consultation'],
  ['suivi', 'Suivi'],
  ['urgence', 'Non programmée'],
] as const;

const COTE = [['droit', 'Droit'], ['gauche', 'Gauche'], ['bilateral', 'Bilatéral']] as const;

const courtExamen = { section: 'examen', sectionLabel: 'Examen clinique' } as const;
const courtConstantes = {
  section: 'constantes',
  sectionLabel: 'Constantes',
  parentSectionKey: 'examen',
  parentSectionLabel: 'Examen clinique',
} as const;
const courtContexte = { section: 'contexte', sectionLabel: 'Contexte de la consultation' } as const;

const courtFields: TemplateField[] = [
  // Variable detachee volontaire : elle exerce la zone de secours du formulaire papier.
  field({ id: 'court-f-01', fieldKey: 'numero_dossier', label: 'Numéro de dossier (fictif)', scope: 'patient', displayOrder: 0, section: null }),
  field({ id: 'court-f-02', fieldKey: 'date_consultation', label: 'Date de la consultation', type: 'date', required: true, displayOrder: 1, ...courtContexte }),
  choice({ id: 'court-f-03', fieldKey: 'type_consultation', label: 'Type de consultation', required: true, displayOrder: 2, ...courtContexte }, 'select', TYPE_CONSULTATION),
  field({ id: 'court-f-04', fieldKey: 'motif', label: 'Motif de consultation', description: 'Motif principal tel qu’il est exprimé, en une phrase.', displayOrder: 3, ...courtContexte }),
  field({ id: 'court-f-05', fieldKey: 'adresse_par', label: 'Adressé par', displayOrder: 4, ...courtContexte }),
  field({ id: 'court-f-06', fieldKey: 'poids', label: 'Poids', type: 'number', unit: 'kg', minValue: 0, maxValue: 300, displayOrder: 5, ...courtConstantes }),
  field({ id: 'court-f-07', fieldKey: 'taille', label: 'Taille', type: 'number', unit: 'm', minValue: 0, maxValue: 3, displayOrder: 6, ...courtConstantes }),
  field({ id: 'court-f-08', fieldKey: 'tension_systolique', label: 'Tension systolique', type: 'integer', unit: 'mmHg', displayOrder: 7, ...courtConstantes }),
  field({ id: 'court-f-09', fieldKey: 'tension_diastolique', label: 'Tension diastolique', type: 'integer', unit: 'mmHg', displayOrder: 8, ...courtConstantes }),
  field({ id: 'court-f-10', fieldKey: 'temperature', label: 'Température', type: 'number', unit: '°C', displayOrder: 9, ...courtConstantes }),
  // Variable calculee : sur papier elle ne demande aucune zone d'ecriture.
  field({ id: 'court-f-11', fieldKey: 'imc', label: 'Indice de masse corporelle', type: 'number', unit: 'kg/m²', formula: 'poids / taille', displayOrder: 10, ...courtConstantes }),
  field({ id: 'court-f-12', fieldKey: 'douleur_presente', label: 'Douleur signalée', type: 'boolean', displayOrder: 11, ...courtExamen }),
  choice({ id: 'court-f-13', fieldKey: 'douleur_cote', label: 'Côté de la douleur', displayOrder: 12, ...courtExamen }, 'select', COTE),
  field({ id: 'court-f-14', fieldKey: 'douleur_intensite', label: 'Intensité de la douleur (0 à 10)', type: 'integer', minValue: 0, maxValue: 10, displayOrder: 13, ...courtExamen }),
  field({ id: 'court-f-15', fieldKey: 'examen_general', label: 'Examen général', description: 'Observation libre ; une à trois lignes suffisent en général.', displayOrder: 14, ...courtExamen }),
  field({ id: 'court-f-16', fieldKey: 'conclusion', label: 'Conclusion', required: true, displayOrder: 15, ...courtExamen }),
  field({ id: 'court-f-17', fieldKey: 'suivi_prevu', label: 'Suivi prévu', type: 'boolean', displayOrder: 16, ...courtExamen }),
  field({ id: 'court-f-18', fieldKey: 'date_prochain_rdv', label: 'Date du prochain rendez-vous', type: 'date', displayOrder: 17, ...courtExamen }),
];

const courtRules: ValidationRule[] = [
  // Condition non resolue sur un formulaire vierge : la question reste imprimee.
  {
    id: 'court-rule-01',
    rule: { if: { field: 'suivi_prevu', operator: 'equals', value: true }, then: { field: 'date_prochain_rdv', operator: 'visible' } },
    message: null,
    severity: 'block',
  },
  {
    id: 'court-rule-02',
    rule: { if: { field: 'douleur_presente', operator: 'equals', value: true }, then: { field: 'douleur_intensite', operator: 'required' } },
    message: 'Préciser l’intensité lorsqu’une douleur est signalée.',
    severity: 'block',
  },
];

const courtVersion: TemplateVersion = {
  id: 'paper-court-version',
  templateId: 'paper-court-template',
  versionNumber: 2,
  status: 'published',
  fieldCount: courtFields.length,
};

// ---------------------------------------------------------------------------
// Cas moyen — registre de suivi post-operatoire. 10 sections, 9 regles.
//
// Ce cas porte la VARIETE que le cas volumineux n'a pas : consignes, listes de toutes les
// tailles (radios, liste native, recherche), multiselection, terminologie, formules,
// libelles longs, raisons de valeur manquante et rubriques communes.
// ---------------------------------------------------------------------------

const moyenSections: TemplateSection[] = [
  { id: 'moyen-section-admission', sectionKey: 'admission', label: 'Admission', displayOrder: 0, parentSectionKey: null },
  { id: 'moyen-section-antecedents', sectionKey: 'antecedents', label: 'Antécédents et terrain', displayOrder: 1, parentSectionKey: null },
  { id: 'moyen-section-antecedents-medicaux', sectionKey: 'antecedents_medicaux', label: 'Antécédents médicaux', displayOrder: 2, parentSectionKey: 'antecedents' },
  { id: 'moyen-section-antecedents-chirurgicaux', sectionKey: 'antecedents_chirurgicaux', label: 'Antécédents chirurgicaux', displayOrder: 3, parentSectionKey: 'antecedents' },
  { id: 'moyen-section-intervention', sectionKey: 'intervention', label: 'Intervention', displayOrder: 4, parentSectionKey: null },
  { id: 'moyen-section-intervention-technique', sectionKey: 'intervention_technique', label: 'Technique opératoire', displayOrder: 5, parentSectionKey: 'intervention' },
  { id: 'moyen-section-biologie', sectionKey: 'biologie', label: 'Biologie péri-opératoire', displayOrder: 6, parentSectionKey: null },
  { id: 'moyen-section-suites', sectionKey: 'suites', label: 'Suites opératoires', displayOrder: 7, parentSectionKey: null },
  { id: 'moyen-section-suites-complications', sectionKey: 'suites_complications', label: 'Complications', displayOrder: 8, parentSectionKey: 'suites' },
  { id: 'moyen-section-sortie', sectionKey: 'sortie', label: 'Sortie et suivi', displayOrder: 9, parentSectionKey: null },
];

const sectionLabelOf = new Map(moyenSections.map((section) => [section.sectionKey, section.label]));
const parentOf = new Map(moyenSections.map((section) => [section.sectionKey, section.parentSectionKey ?? null]));

/** Rattache une variable a une section en renseignant les libelles joints, comme la lecture reelle. */
function inSection(sectionKey: string): Partial<TemplateField> {
  const parentSectionKey = parentOf.get(sectionKey) ?? null;
  return {
    section: sectionKey,
    sectionLabel: sectionLabelOf.get(sectionKey) ?? null,
    parentSectionKey,
    parentSectionLabel: parentSectionKey ? sectionLabelOf.get(parentSectionKey) ?? null : null,
  };
}

// Liste a 3 options courtes -> boutons radio : les choix sont VISIBLES sur papier.
const SERVICE_ADMISSION = [['urgences', 'Urgences'], ['programme', 'Programmé'], ['transfert', 'Transfert']] as const;
// Liste a 6 options -> menu deroulant natif : les choix DISPARAISSENT a l'impression.
const ASA = [
  ['asa1', 'ASA 1'], ['asa2', 'ASA 2'], ['asa3', 'ASA 3'],
  ['asa4', 'ASA 4'], ['asa5', 'ASA 5'], ['asa_non_evalue', 'Non évalué'],
] as const;
// Liste a 12 options -> champ de recherche : les choix DISPARAISSENT aussi.
const VOIE_ABORD = [
  ['anterieure', 'Voie antérieure'], ['posterieure', 'Voie postérieure'], ['laterale', 'Voie latérale'],
  ['endoscopique', 'Voie endoscopique'], ['percutanee', 'Voie percutanée'], ['mixte', 'Voie mixte'],
  ['transorale', 'Voie transorale'], ['retroperitoneale', 'Voie rétropéritonéale'],
  ['thoracique', 'Voie thoracique'], ['cervicale', 'Voie cervicale'],
  ['sous_costale', 'Voie sous-costale'], ['autre_voie', 'Autre voie'],
] as const;
// Multiselection courte -> grille de cases : visible sur papier.
const COMORBIDITES = [
  ['hta', 'Hypertension artérielle'], ['diabete', 'Diabète'],
  ['tabac', 'Tabagisme actif'], ['obesite', 'Obésité'],
] as const;
// Multiselection longue -> recherche multiple : invisible sur papier.
const COMPLICATIONS = [
  ['infection_site', 'Infection du site opératoire'], ['hemorragie', 'Hémorragie'],
  ['thrombose', 'Thrombose veineuse'], ['embolie', 'Embolie pulmonaire'],
  ['fistule', 'Fistule'], ['eventration', 'Éventration'],
  ['pneumopathie', 'Pneumopathie'], ['sepsis', 'Sepsis'],
  ['insuffisance_renale', 'Insuffisance rénale aiguë'], ['reprise', 'Reprise chirurgicale'],
] as const;

const GRADE_CLAVIEN = [
  ['grade1', 'Grade I'], ['grade2', 'Grade II'], ['grade3a', 'Grade III a'],
  ['grade3b', 'Grade III b'], ['grade4', 'Grade IV'], ['grade5', 'Grade V'],
] as const;

const DESTINATION_SORTIE = [
  ['domicile', 'Domicile'], ['ssr', 'Soins de suite'], ['autre_service', 'Autre service'],
] as const;

const moyenDiagnosisRelease = '7c1f2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

let moyenOrder = 0;
const nextOrder = () => moyenOrder++;

const moyenFields: TemplateField[] = [
  // --- Variables communes, sans section clinique (rubriques UX-16).
  field({ id: 'moyen-f-code', fieldKey: 'code_inclusion', label: 'Code d’inclusion (fictif)', scope: 'patient', displayOrder: nextOrder(), required: true }),
  field({ id: 'moyen-f-date-inclusion', fieldKey: 'date_inclusion', label: 'Date d’inclusion', scope: 'patient', type: 'date', displayOrder: nextOrder() }),
  field({
    id: 'moyen-f-diagnostics', fieldKey: 'diagnostics', label: 'Diagnostics retenus', scope: 'patient',
    type: 'terminology', isMultiple: true, displayOrder: nextOrder(),
    description: 'Un ou plusieurs codes du référentiel ; le référentiel n’est pas recopié sur le formulaire.',
  }),
  field({ id: 'moyen-f-diagnostics-autre', fieldKey: 'diagnostics_autre', label: 'Diagnostics — valeur proposée', scope: 'patient', displayOrder: nextOrder() }),
  field({ id: 'moyen-f-centre', fieldKey: 'centre', label: 'Centre', scope: 'patient', displayOrder: nextOrder() }),
  field({ id: 'moyen-f-operateur', fieldKey: 'operateur_principal', label: 'Opérateur principal', displayOrder: nextOrder() }),

  // --- Admission.
  field({ id: 'moyen-f-adm-01', fieldKey: 'date_admission', label: 'Date d’admission', type: 'date', required: true, displayOrder: nextOrder(), ...inSection('admission') }),
  field({ id: 'moyen-f-adm-02', fieldKey: 'heure_admission', label: 'Heure d’admission', type: 'datetime', displayOrder: nextOrder(), ...inSection('admission') }),
  choice({ id: 'moyen-f-adm-03', fieldKey: 'service_admission', label: 'Mode d’admission', required: true, displayOrder: nextOrder(), ...inSection('admission') }, 'select', SERVICE_ADMISSION),
  field({ id: 'moyen-f-adm-04', fieldKey: 'provenance', label: 'Provenance', displayOrder: nextOrder(), ...inSection('admission') }),
  field({
    id: 'moyen-f-adm-05', fieldKey: 'motif_hospitalisation',
    label: 'Motif d’hospitalisation tel qu’il est formulé par l’équipe qui adresse le patient',
    description: 'Reprendre la formulation du courrier ; ne pas reformuler en termes de diagnostic.',
    displayOrder: nextOrder(), ...inSection('admission'),
  }),
  field({ id: 'moyen-f-adm-06', fieldKey: 'poids_admission', label: 'Poids à l’admission', type: 'number', unit: 'kg', displayOrder: nextOrder(), ...inSection('admission') }),
  field({ id: 'moyen-f-adm-07', fieldKey: 'taille_admission', label: 'Taille', type: 'number', unit: 'm', displayOrder: nextOrder(), ...inSection('admission') }),
  field({ id: 'moyen-f-adm-08', fieldKey: 'imc_admission', label: 'IMC à l’admission', type: 'number', unit: 'kg/m²', formula: 'poids_admission / taille_admission', displayOrder: nextOrder(), ...inSection('admission') }),
  field({ id: 'moyen-f-adm-09', fieldKey: 'autonomie_admission', label: 'Patient autonome à l’admission', type: 'boolean', displayOrder: nextOrder(), ...inSection('admission') }),

  // --- Antecedents medicaux.
  choice({ id: 'moyen-f-atcd-01', fieldKey: 'comorbidites', label: 'Comorbidités', displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }, 'multiselect', COMORBIDITES),
  choice({ id: 'moyen-f-atcd-02', fieldKey: 'score_asa', label: 'Score ASA', displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }, 'select', ASA),
  field({ id: 'moyen-f-atcd-03', fieldKey: 'traitement_anticoagulant', label: 'Traitement anticoagulant en cours', type: 'boolean', displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }),
  field({ id: 'moyen-f-atcd-04', fieldKey: 'traitement_detail', label: 'Détail du traitement en cours', description: 'Molécule, posologie et date de dernière prise si elle est connue.', displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }),
  field({ id: 'moyen-f-atcd-05', fieldKey: 'allergies', label: 'Allergies connues', displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }),
  field({ id: 'moyen-f-atcd-06', fieldKey: 'tabac_paquets_annees', label: 'Tabagisme', type: 'integer', unit: 'paquets-années', allowMissingCodes: true, missingReasons: ['inconnu', 'non_documente'], displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }),
  field({ id: 'moyen-f-atcd-07', fieldKey: 'antecedent_familial', label: 'Antécédent familial notable', type: 'boolean', displayOrder: nextOrder(), ...inSection('antecedents_medicaux') }),

  // --- Antecedents chirurgicaux.
  field({ id: 'moyen-f-atcdc-01', fieldKey: 'chirurgie_anterieure', label: 'Chirurgie antérieure sur le même site', type: 'boolean', displayOrder: nextOrder(), ...inSection('antecedents_chirurgicaux') }),
  field({ id: 'moyen-f-atcdc-02', fieldKey: 'chirurgie_anterieure_annee', label: 'Année de la dernière chirurgie', type: 'integer', displayOrder: nextOrder(), ...inSection('antecedents_chirurgicaux') }),
  field({ id: 'moyen-f-atcdc-03', fieldKey: 'chirurgie_anterieure_detail', label: 'Nature de la chirurgie antérieure', displayOrder: nextOrder(), ...inSection('antecedents_chirurgicaux') }),
  field({ id: 'moyen-f-atcdc-04', fieldKey: 'complication_anterieure', label: 'Complication lors d’une chirurgie antérieure', type: 'boolean', displayOrder: nextOrder(), ...inSection('antecedents_chirurgicaux') }),

  // --- Intervention.
  field({ id: 'moyen-f-int-01', fieldKey: 'date_intervention', label: 'Date de l’intervention', type: 'date', required: true, displayOrder: nextOrder(), ...inSection('intervention') }),
  field({ id: 'moyen-f-int-02', fieldKey: 'heure_incision', label: 'Heure d’incision', type: 'datetime', displayOrder: nextOrder(), ...inSection('intervention') }),
  field({ id: 'moyen-f-int-03', fieldKey: 'heure_fermeture', label: 'Heure de fermeture', type: 'datetime', displayOrder: nextOrder(), ...inSection('intervention') }),
  field({ id: 'moyen-f-int-04', fieldKey: 'duree_intervention', label: 'Durée de l’intervention', type: 'number', unit: 'minutes', formula: 'heure_fermeture - heure_incision', displayOrder: nextOrder(), ...inSection('intervention') }),
  field({ id: 'moyen-f-int-05', fieldKey: 'urgence_intervention', label: 'Intervention réalisée en urgence', type: 'boolean', displayOrder: nextOrder(), ...inSection('intervention') }),
  field({ id: 'moyen-f-int-06', fieldKey: 'anesthesie_generale', label: 'Anesthésie générale', type: 'boolean', displayOrder: nextOrder(), ...inSection('intervention') }),

  // --- Technique operatoire.
  choice({ id: 'moyen-f-tec-01', fieldKey: 'voie_abord', label: 'Voie d’abord', displayOrder: nextOrder(), ...inSection('intervention_technique') }, 'select', VOIE_ABORD),
  field({ id: 'moyen-f-tec-02', fieldKey: 'conversion', label: 'Conversion en cours d’intervention', type: 'boolean', displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({ id: 'moyen-f-tec-03', fieldKey: 'conversion_motif', label: 'Motif de la conversion', displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({ id: 'moyen-f-tec-04', fieldKey: 'drainage', label: 'Drainage mis en place', type: 'boolean', displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({ id: 'moyen-f-tec-05', fieldKey: 'nombre_drains', label: 'Nombre de drains', type: 'integer', minValue: 0, maxValue: 6, displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({ id: 'moyen-f-tec-06', fieldKey: 'pertes_sanguines', label: 'Pertes sanguines estimées', type: 'integer', unit: 'mL', allowMissingCodes: true, missingReasons: ['non_documente'], displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({ id: 'moyen-f-tec-07', fieldKey: 'transfusion_peroperatoire', label: 'Transfusion per-opératoire', type: 'boolean', displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({ id: 'moyen-f-tec-08', fieldKey: 'culots_transfuses', label: 'Nombre de culots transfusés', type: 'integer', displayOrder: nextOrder(), ...inSection('intervention_technique') }),
  field({
    id: 'moyen-f-tec-09', fieldKey: 'compte_rendu_operatoire',
    label: 'Description du geste réalisé',
    description: 'Description libre du geste : temps opératoires, matériel implanté, incidents. Ce champ est celui qui reçoit le plus de texte manuscrit sur le formulaire papier.',
    displayOrder: nextOrder(), ...inSection('intervention_technique'),
  }),
];

// Serie biologique homogene : elle reproduit ce qui, dans un registre reel, occupe beaucoup
// de lignes pour des reponses tres courtes.
const BIOLOGIE = [
  ['hemoglobine', 'Hémoglobine', 'g/dL'],
  ['leucocytes', 'Leucocytes', 'G/L'],
  ['plaquettes', 'Plaquettes', 'G/L'],
  ['creatinine', 'Créatininémie', 'µmol/L'],
  ['crp', 'Protéine C réactive', 'mg/L'],
  ['albumine', 'Albuminémie', 'g/L'],
  ['glycemie', 'Glycémie à jeun', 'g/L'],
  ['inr', 'INR', null],
] as const;

for (const [key, label, unit] of BIOLOGIE) {
  moyenFields.push(field({
    id: `moyen-f-bio-${key}`, fieldKey: `${key}_preop`, label: `${label} (pré-opératoire)`,
    type: 'number', unit, allowMissingCodes: true, missingReasons: ['non_fait', 'non_documente'],
    displayOrder: nextOrder(), ...inSection('biologie'),
  }));
}
for (const [key, label, unit] of BIOLOGIE.slice(0, 5)) {
  moyenFields.push(field({
    id: `moyen-f-bio-${key}-post`, fieldKey: `${key}_postop`, label: `${label} (post-opératoire)`,
    type: 'number', unit, displayOrder: nextOrder(), ...inSection('biologie'),
  }));
}

moyenFields.push(
  // --- Suites operatoires.
  field({ id: 'moyen-f-sui-01', fieldKey: 'sejour_reanimation', label: 'Séjour en réanimation', type: 'boolean', displayOrder: nextOrder(), ...inSection('suites') }),
  field({ id: 'moyen-f-sui-02', fieldKey: 'duree_reanimation', label: 'Durée du séjour en réanimation', type: 'integer', unit: 'jours', displayOrder: nextOrder(), ...inSection('suites') }),
  field({ id: 'moyen-f-sui-03', fieldKey: 'reprise_alimentation', label: 'Reprise de l’alimentation', type: 'date', displayOrder: nextOrder(), ...inSection('suites') }),
  field({ id: 'moyen-f-sui-04', fieldKey: 'lever_precoce', label: 'Lever précoce réalisé', type: 'boolean', displayOrder: nextOrder(), ...inSection('suites') }),
  field({ id: 'moyen-f-sui-05', fieldKey: 'antalgiques_palier', label: 'Palier antalgique maximal', type: 'integer', minValue: 1, maxValue: 3, displayOrder: nextOrder(), ...inSection('suites') }),
  field({
    id: 'moyen-f-sui-06', fieldKey: 'evolution_libre', label: 'Évolution pendant le séjour',
    description: 'Deux à cinq lignes : ce champ sert de compte rendu de séjour lorsqu’aucune complication n’est cochée.',
    displayOrder: nextOrder(), ...inSection('suites'),
  }),

  // --- Complications.
  field({ id: 'moyen-f-cpl-01', fieldKey: 'complication_survenue', label: 'Survenue d’au moins une complication', type: 'boolean', displayOrder: nextOrder(), ...inSection('suites_complications') }),
  choice({ id: 'moyen-f-cpl-02', fieldKey: 'complications', label: 'Complications observées', displayOrder: nextOrder(), ...inSection('suites_complications') }, 'multiselect', COMPLICATIONS),
  choice({ id: 'moyen-f-cpl-03', fieldKey: 'grade_clavien', label: 'Grade de la complication la plus sévère', displayOrder: nextOrder(), ...inSection('suites_complications') }, 'select', GRADE_CLAVIEN),
  field({ id: 'moyen-f-cpl-04', fieldKey: 'date_complication', label: 'Date de la complication', type: 'date', displayOrder: nextOrder(), ...inSection('suites_complications') }),
  field({ id: 'moyen-f-cpl-05', fieldKey: 'reintervention', label: 'Réintervention nécessaire', type: 'boolean', displayOrder: nextOrder(), ...inSection('suites_complications') }),
  field({ id: 'moyen-f-cpl-06', fieldKey: 'reintervention_detail', label: 'Nature de la réintervention', displayOrder: nextOrder(), ...inSection('suites_complications') }),
  field({ id: 'moyen-f-cpl-07', fieldKey: 'antibiotherapie', label: 'Antibiothérapie curative', type: 'boolean', displayOrder: nextOrder(), ...inSection('suites_complications') }),
  field({ id: 'moyen-f-cpl-08', fieldKey: 'antibiotherapie_duree', label: 'Durée de l’antibiothérapie', type: 'integer', unit: 'jours', displayOrder: nextOrder(), ...inSection('suites_complications') }),

  // --- Sortie et suivi.
  field({ id: 'moyen-f-sor-01', fieldKey: 'date_sortie', label: 'Date de sortie', type: 'date', displayOrder: nextOrder(), ...inSection('sortie') }),
  field({ id: 'moyen-f-sor-02', fieldKey: 'duree_sejour', label: 'Durée de séjour', type: 'number', unit: 'jours', formula: 'date_sortie - date_admission', displayOrder: nextOrder(), ...inSection('sortie') }),
  choice({ id: 'moyen-f-sor-03', fieldKey: 'destination_sortie', label: 'Destination à la sortie', displayOrder: nextOrder(), ...inSection('sortie') }, 'select', DESTINATION_SORTIE),
  field({ id: 'moyen-f-sor-04', fieldKey: 'ordonnance_sortie', label: 'Ordonnance de sortie remise', type: 'boolean', displayOrder: nextOrder(), ...inSection('sortie') }),
  field({ id: 'moyen-f-sor-05', fieldKey: 'date_consultation_controle', label: 'Date de la consultation de contrôle', type: 'date', displayOrder: nextOrder(), ...inSection('sortie') }),
  field({ id: 'moyen-f-sor-06', fieldKey: 'deces', label: 'Décès pendant le séjour', type: 'boolean', displayOrder: nextOrder(), ...inSection('sortie') }),
  field({ id: 'moyen-f-sor-07', fieldKey: 'date_deces', label: 'Date du décès', type: 'date', displayOrder: nextOrder(), ...inSection('sortie') }),
  field({
    id: 'moyen-f-sor-08', fieldKey: 'commentaire_sortie', label: 'Commentaire de sortie',
    description: 'Consigne longue volontairement verbeuse, afin de mesurer ce qu’une consigne imprimée coûte en hauteur : rappeler les consignes de pansement, la date de retrait des fils et les signes devant conduire à reconsulter.',
    displayOrder: nextOrder(), ...inSection('sortie'),
  }),
  // Variable detachee : elle doit rester visible dans la zone de secours.
  field({ id: 'moyen-f-detache', fieldKey: 'remarque_registre', label: 'Remarque pour le registre', displayOrder: nextOrder(), section: null }),
);

const moyenCommonLayout: TemplateCommonLayout = {
  fingerprint: 'paper-moyen-layout-v1',
  locked: false,
  inUse: false,
  defaultKey: 'identification',
  sections: moyenSections.filter((section) => !section.parentSectionKey).map((section) => ({ key: section.sectionKey, label: section.label })),
  groups: [
    {
      key: 'identification',
      label: 'Identification du dossier',
      anchor: 0,
      isDefault: true,
      fields: ['code_inclusion', 'date_inclusion', 'diagnostics', 'diagnostics_autre'],
    },
    {
      key: 'equipe',
      label: 'Équipe et centre',
      anchor: 1,
      isDefault: false,
      fields: ['centre', 'operateur_principal'],
    },
  ],
  unassigned: [],
};

const moyenRules: ValidationRule[] = [
  {
    id: 'moyen-rule-01',
    rule: { if: { field: 'complication_survenue', operator: 'equals', value: true }, then: { field: 'complications', operator: 'visible' } },
    message: null,
    severity: 'block',
  },
  {
    id: 'moyen-rule-02',
    rule: { if: { field: 'complication_survenue', operator: 'equals', value: true }, then: { field: 'grade_clavien', operator: 'required' } },
    message: 'Préciser le grade lorsqu’une complication est déclarée.',
    severity: 'block',
  },
  {
    id: 'moyen-rule-03',
    rule: { if: { field: 'reintervention', operator: 'equals', value: true }, then: { field: 'reintervention_detail', operator: 'required' } },
    message: null,
    severity: 'block',
  },
  {
    id: 'moyen-rule-04',
    rule: { if: { field: 'conversion', operator: 'equals', value: true }, then: { field: 'conversion_motif', operator: 'visible' } },
    message: null,
    severity: 'block',
  },
  {
    id: 'moyen-rule-05',
    rule: { if: { field: 'transfusion_peroperatoire', operator: 'equals', value: true }, then: { field: 'culots_transfuses', operator: 'required' } },
    message: null,
    severity: 'block',
  },
  {
    id: 'moyen-rule-06',
    rule: { if: { field: 'deces', operator: 'equals', value: true }, then: { field: 'date_deces', operator: 'visible' } },
    message: null,
    severity: 'block',
  },
  {
    id: 'moyen-rule-07',
    rule: { if: { field: 'sejour_reanimation', operator: 'equals', value: true }, then: { field: 'duree_reanimation', operator: 'required' } },
    message: null,
    severity: 'warn',
  },
  {
    id: 'moyen-rule-08',
    rule: { if: { field: 'drainage', operator: 'equals', value: true }, then: { field: 'nombre_drains', operator: 'required' } },
    message: null,
    severity: 'block',
  },
  // Condition portant sur un BLOC entier : sur un formulaire vierge elle reste non resolue.
  {
    id: 'moyen-rule-09',
    rule: {
      if: { field: 'diagnostics', operator: 'contains_any', value: ['DX-DIGESTIF'], terminologyReleaseId: moyenDiagnosisRelease },
      then: { section: 'biologie', operator: 'visible' },
    },
    message: null,
    severity: 'block',
  },
];

const moyenVersion: TemplateVersion = {
  id: 'paper-moyen-version',
  templateId: 'paper-moyen-template',
  versionNumber: 5,
  status: 'published',
  fieldCount: moyenFields.length,
  commonLayout: moyenCommonLayout,
  diagnosisConfiguration: [{
    scope: 'patient',
    diagnosisFieldKey: 'diagnostics',
    terminologyReleaseId: moyenDiagnosisRelease,
    commonOnlyCodes: ['DX-COMMUN'],
  }],
  diagnosisContext: [{
    scope: 'patient',
    diagnosisFieldKey: 'diagnostics',
    terminologyReleaseId: moyenDiagnosisRelease,
    commonOnlyCodes: ['DX-COMMUN'],
    proposalFieldKey: 'diagnostics_autre',
    recognizedCodes: ['DX-DIGESTIF', 'DX-THORACIQUE', 'DX-COMMUN'],
  }],
};

// ---------------------------------------------------------------------------
// Les trois cas de la campagne.
// ---------------------------------------------------------------------------

export const paperShortCase: PaperFormCase = {
  key: 'court',
  label: 'Consultation de suivi (fictive)',
  intent: 'Formulaire court : une consultation tient normalement sur une à deux pages.',
  version: courtVersion,
  fields: courtFields,
  sections: courtSections,
  rules: courtRules,
};

export const paperMediumCase: PaperFormCase = {
  key: 'moyen',
  label: 'Registre de suivi post-opératoire (fictif)',
  intent:
    'Formulaire moyen portant la variété de présentation : consignes, listes de toutes tailles, '
    + 'multisélection, terminologie, formules, libellés longs et raisons de valeur manquante.',
  version: moyenVersion,
  fields: moyenFields,
  sections: moyenSections,
  rules: moyenRules,
};

export const paperLargeCase: PaperFormCase = {
  key: 'volumineux',
  label: 'Registre multipathologies (fictif)',
  intent:
    `Formulaire volumineux de la fixture éditeur : ${EDITOR_REGISTRY_FIELD_COUNT} variables, `
    + `${EDITOR_REGISTRY_SECTION_COUNT} sections et ${EDITOR_REGISTRY_RULE_COUNT} règles.`,
  version: editorRegistryVersion,
  fields: editorRegistryFields,
  sections: editorRegistrySections,
  rules: editorRegistryRules,
};

/** Les trois cas, dans l'ordre de la campagne PAP-0 -> PAP-4. */
export const PAPER_FORM_CASES: readonly PaperFormCase[] = [paperShortCase, paperMediumCase, paperLargeCase];

export function paperFormCase(key: PaperFormCaseKey): PaperFormCase {
  const found = PAPER_FORM_CASES.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`Cas de formulaire papier inconnu : ${key}`);
  return found;
}
