// F3 — Bibliotheque de gabarits de DEPART par specialite. Partir d'une page blanche est intimidant ;
// un modele credible a ~80 % lance l'utilisateur en minutes, puis il ADAPTE (renomme, ajoute,
// supprime). Contenu PUR (aucune I/O) : « Utiliser ce modele » clone les champs dans un gabarit
// personnel via createPersonalTemplate + addField (comme F1). Ces modeles sont des POINTS DE DEPART
// a adapter, pas des standards cliniques.
import type { NewField } from '../data/types';

export interface StarterTemplate {
  id: string;
  name: string;
  specialty: string;
  description: string;
  fields: NewField[];
}

const f = (p: Partial<NewField> & Pick<NewField, 'fieldKey' | 'label' | 'scope' | 'type'>): NewField => ({
  section: 'clinique', required: false, ...p,
});

export const TEMPLATE_LIBRARY: StarterTemplate[] = [
  {
    id: 'neuro',
    name: 'Registre neurologique',
    specialty: 'Neurologie',
    description: 'Suivi neurologique : sexe, antécédents, score de Glasgow, diagnostic.',
    fields: [
      f({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
      f({ fieldKey: 'antecedents', label: 'Antécédents', scope: 'patient', type: 'text' }),
      f({ fieldKey: 'glasgow_score', label: 'Score de Glasgow', scope: 'encounter', type: 'integer', minValue: 3, maxValue: 15 }),
      f({ fieldKey: 'nihss', label: 'Score NIHSS', scope: 'encounter', type: 'integer', minValue: 0, maxValue: 42 }),
      f({ fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter', type: 'text' }),
    ],
  },
  {
    id: 'cardio',
    name: 'Registre cardiologique',
    specialty: 'Cardiologie',
    description: 'Suivi cardiologique : tabac, fréquence, tension, FEVG.',
    fields: [
      f({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
      f({ fieldKey: 'tabac', label: 'Tabagisme', scope: 'patient', type: 'boolean' }),
      f({ fieldKey: 'frequence_cardiaque', label: 'Fréquence cardiaque', scope: 'encounter', type: 'integer', unit: 'bpm', minValue: 0, maxValue: 300 }),
      f({ fieldKey: 'pas', label: 'PA systolique', scope: 'encounter', type: 'integer', unit: 'mmHg' }),
      f({ fieldKey: 'pad', label: 'PA diastolique', scope: 'encounter', type: 'integer', unit: 'mmHg' }),
      f({ fieldKey: 'fevg', label: 'FEVG', scope: 'encounter', type: 'number', unit: '%', section: 'paraclinique', minValue: 0, maxValue: 100 }),
    ],
  },
  {
    id: 'onco',
    name: 'Registre oncologique',
    specialty: 'Oncologie',
    description: 'Suivi oncologique : type de tumeur, stade, traitement, réponse.',
    fields: [
      f({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
      f({ fieldKey: 'type_tumeur', label: 'Type de tumeur', scope: 'patient', type: 'text' }),
      f({ fieldKey: 'stade', label: 'Stade', scope: 'encounter', type: 'select', allowedValues: ['I', 'II', 'III', 'IV'] }),
      f({ fieldKey: 'traitement', label: 'Traitement', scope: 'encounter', type: 'select', allowedValues: ['chirurgie', 'chimiothérapie', 'radiothérapie', 'surveillance'] }),
      f({ fieldKey: 'reponse', label: 'Réponse au traitement', scope: 'encounter', type: 'select', allowedValues: ['complète', 'partielle', 'stable', 'progression'] }),
    ],
  },
  {
    id: 'general',
    name: 'Registre générique',
    specialty: 'Médecine générale',
    description: 'Base minimale à adapter : sexe, motif, diagnostic, traitement.',
    fields: [
      f({ fieldKey: 'sexe', label: 'Sexe', scope: 'patient', type: 'select', allowedValues: ['M', 'F'] }),
      f({ fieldKey: 'motif', label: 'Motif de consultation', scope: 'encounter', type: 'text' }),
      f({ fieldKey: 'diagnostic', label: 'Diagnostic', scope: 'encounter', type: 'text' }),
      f({ fieldKey: 'traitement', label: 'Traitement', scope: 'encounter', type: 'text' }),
    ],
  },
];
