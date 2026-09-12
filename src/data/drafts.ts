// A4 — brouillon LOCAL de saisie en cours (anti-perte). Si l'onglet se ferme, l'app plante ou le
// reseau tombe, la saisie non enregistree est recuperee au retour sur le meme formulaire.
//
// SECURITE : ne stocke QUE des donnees ANALYTIQUES (jamais d'identite) — meme principe que la
// couche hors-ligne. Partitionne par UTILISATEUR courant (poste partage) : un autre compte ne
// retrouve pas le brouillon d'un tiers. Ephemere : efface a l'enregistrement reussi. Best-effort
// (localStorage indisponible / quota -> no-op silencieux, jamais bloquant pour la saisie).
//
// UX-8 — durcissement de ce support local. Ce qui a ete ajoute, et pourquoi :
//   * la MATRICE des donnees autorisees est executable, pas seulement ecrite : un appelant ne
//     peut pas glisser un nom ou une date de naissance dans un brouillon par inadvertance ;
//   * une purge ne s'arrete plus au premier enregistrement illisible — sinon UN seul octet
//     corrompu conservait indefiniment TOUS les autres brouillons expires, TTL compris ;
//   * le format porte un numero, pour qu'un enregistrement ecrit par une version future ne
//     soit pas relu de travers ; les enregistrements anterieurs a UX-8 restent lisibles ;
//   * les brouillons d'un AUTRE compte sont effaces a la connexion, sans dependre du marqueur
//     de proprietaire hors-ligne : les rendre inaccessibles ne suffit pas, ils doivent partir.
//
// Ce qui n'est PAS fait, et ce n'est pas un oubli : aucun chiffrement local. La politique
// (`docs/securite-mode-hors-ligne.md`) constate qu'un chiffrement Web Crypto ne protege ni
// DevTools, ni XSS, ni une session active, qu'une cle permanente ne doit pas etre embarquee
// dans le frontend, et qu'une exception future exigerait cle de session, TTL strict, revue
// RSSI/DPO et MDM. Ajouter une cle locale ici donnerait une protection apparente sans en etre une.
import { getOfflineUser } from './offline';

const PREFIX = 'meddata:draft';
export const DRAFT_TTL_MS = 24 * 3600 * 1000;

/**
 * Version du FORMAT d'enveloppe. Un enregistrement SANS numero vient d'avant UX-8 : il reste
 * lisible et se reecrit au format courant a la sauvegarde suivante. Un enregistrement portant
 * un numero INCONNU vient d'une version plus recente de l'application : il n'est pas relu au
 * hasard, et il n'est pas detruit non plus tant qu'il n'a pas expire — un onglet plus ancien
 * ne doit pas effacer ce qu'un onglet a jour vient d'ecrire pendant une mise a jour PWA.
 */
export const DRAFT_FORMAT = 1;

/**
 * Matrice des donnees autorisees dans un brouillon LOCAL (UX-8).
 *
 * Le contrat UX-0 limite la charge analytique aux cles du formulaire, de la version et du
 * scope. Cote serveur, `save_work_draft` refuse deja l'identite et les cles hors dictionnaire.
 * Cote local, cette liste est l'equivalent verifiable : un `kind` inconnu ou un champ non
 * declare est REFUSE, et l'ecran annonce alors une saisie non protegee plutot que d'ecrire sur
 * cet appareil une donnee que personne n'a autorisee.
 *
 * Les cles de `values` ne sont pas validees ici : elles viennent du gabarit de la version, et
 * c'est le contrat serveur qui les arbitre. Ce qui est verifie ici, c'est qu'aucun autre
 * compartiment que ceux-ci n'entre dans l'enregistrement local.
 */
const ALLOWED_DRAFT_DATA: Record<string, readonly string[]> = {
  encounter: ['templateVersionId', 'encounterType', 'encounterDate', 'status', 'values'],
};

const keyOf = (kind: string, id: string): string => `${PREFIX}:${kind}:${getOfflineUser() ?? ''}:${id}`;

export interface DraftEnvelope<T> {
  at: number; // epoch ms de la derniere sauvegarde
  createdAt?: number; // TTL fixe ; les anciens brouillons utilisent leur date `at`.
  /** Absent = format anterieur a UX-8, accepte tel quel. */
  v?: number;
  data: T;
}

export function isDraftExpired(draft: { at: number; createdAt?: number }, now = Date.now()): boolean {
  const origin = draft.createdAt ?? draft.at;
  return !Number.isFinite(origin) || origin > now || now - origin >= DRAFT_TTL_MS;
}

/** Vrai quand le `kind` et les compartiments de la charge sont declares dans la matrice. */
export function isAllowedDraftData(kind: string, data: unknown): boolean {
  const allowed = ALLOWED_DRAFT_DATA[kind];
  if (!allowed) return false;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.keys(data).every((key) => allowed.includes(key));
}

type ParsedDraft =
  | { state: 'ok'; draft: DraftEnvelope<unknown> }
  /** Illisible : personne ne pourra jamais le reprendre, il n'a plus aucune raison de rester. */
  | { state: 'unreadable' }
  /** Ecrit par une version plus recente : illisible ICI, mais pas forcement perime. */
  | { state: 'future'; draft: { at: number; createdAt?: number } };

function parseEnvelope(raw: string): ParsedDraft {
  let parsed: DraftEnvelope<unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as DraftEnvelope<unknown>;
  } catch {
    return { state: 'unreadable' };
  }
  // `data` est verifie ici, et pas seulement `at` : une enveloppe tronquee traversait la
  // lecture et faisait echouer la reprise au moment ou l'ecran lisait sa version de gabarit.
  if (!parsed || typeof parsed !== 'object' || typeof parsed.at !== 'number'
    || !parsed.data || typeof parsed.data !== 'object') return { state: 'unreadable' };
  if (parsed.v !== undefined && parsed.v !== DRAFT_FORMAT) return { state: 'future', draft: parsed };
  return { state: 'ok', draft: parsed };
}

function draftUserFromKey(key: string): string | null {
  if (!key.startsWith(`${PREFIX}:`)) return null;
  const parts = key.split(':');
  return parts.length >= 5 ? parts[3] : null;
}

function draftKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${PREFIX}:`)) keys.push(key);
  }
  return keys;
}

/** Suppression best-effort : un echec sur une cle n'interrompt jamais un balayage. */
function removeKey(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function saveDraft<T>(kind: string, id: string, data: T): boolean {
  try {
    if (!getOfflineUser()) return false;
    // La matrice est verifiee AVANT toute ecriture : un refus ne laisse rien sur l'appareil.
    if (!isAllowedDraftData(kind, data)) return false;
    const key = keyOf(kind, id);
    const previous = localStorage.getItem(key);
    const parsed = previous ? parseEnvelope(previous) : null;
    // Un brouillon expire, illisible ou d'un format inconnu ne PROLONGE pas sa duree de vie :
    // la nouvelle sauvegarde repart de zero plutot que d'heriter d'une origine douteuse.
    const old = parsed?.state === 'ok' && !isDraftExpired(parsed.draft) ? parsed.draft : null;
    if (parsed?.state === 'ok' && isDraftExpired(parsed.draft)) return false;
    const serialized = JSON.stringify({
      at: Date.now(), createdAt: old?.createdAt ?? old?.at ?? Date.now(), v: DRAFT_FORMAT, data,
    });
    if (new TextEncoder().encode(serialized).byteLength > 256 * 1024) return false;
    localStorage.setItem(key, serialized);
    return localStorage.getItem(key) === serialized;
  } catch { return false; }
}

export function loadDraft<T>(kind: string, id: string): DraftEnvelope<T> | null {
  try {
    // Symetrique de l'ecriture : sans compte actif, la cle porterait un segment utilisateur
    // VIDE. Les enregistrements de l'ancien format A4, ecrits avant le partitionnement, en
    // portent un : les lire ici reviendrait a servir le brouillon d'un inconnu au premier
    // compte qui ouvre la meme fiche sur ce poste.
    if (!getOfflineUser()) return null;
    const key = keyOf(kind, id);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = parseEnvelope(raw);
    if (parsed.state === 'unreadable') {
      removeKey(key);
      return null;
    }
    // Format inconnu : ne rien proposer, ne rien detruire. Le balayage l'emportera a son terme.
    if (parsed.state === 'future') return null;
    if (isDraftExpired(parsed.draft)) {
      removeKey(key);
      return null;
    }
    return parsed.draft as DraftEnvelope<T>;
  } catch { return null; }
}

export function clearDraft(kind: string, id: string): void {
  try {
    localStorage.removeItem(keyOf(kind, id));
  } catch { /* no-op */ }
}

/**
 * Balayage des brouillons expires. Chaque enregistrement est traite POUR LUI-MEME : un
 * enregistrement corrompu est supprime et le balayage continue, au lieu d'abandonner la purge
 * de tous les autres.
 */
export function purgeExpiredDrafts(now = Date.now()): number {
  let removed = 0;
  let keys: string[];
  try {
    keys = draftKeys();
  } catch {
    return 0;
  }
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = parseEnvelope(raw);
      const expired = parsed.state !== 'unreadable' && isDraftExpired(parsed.draft, now);
      if ((parsed.state === 'unreadable' || expired) && removeKey(key)) removed += 1;
    } catch {
      // Une cle illisible ne doit pas emporter le balayage des suivantes.
      if (removeKey(key)) removed += 1;
    }
  }
  return removed;
}

export function clearDraftsForCurrentUser(userId = getOfflineUser()): number {
  try {
    const targetUser = userId ?? '';
    let removed = 0;
    for (const key of draftKeys()) {
      if (draftUserFromKey(key) === targetUser && removeKey(key)) removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * UX-8 — poste partage. Les brouillons qui n'appartiennent pas au compte qui ouvre la session
 * sont EFFACES, pas seulement rendus inaccessibles : une cle partitionnee par utilisateur
 * empeche l'application de les relire, elle n'empeche personne de les lire dans l'inspecteur.
 *
 * Cette purge ne depend pas du marqueur de proprietaire hors-ligne : si son ecriture a echoue,
 * ou si la purge globale a ete partielle, la garantie tient quand meme.
 */
export function purgeForeignDrafts(userId = getOfflineUser()): number {
  const owner = userId ?? '';
  let removed = 0;
  let keys: string[];
  try {
    keys = draftKeys();
  } catch {
    return 0;
  }
  for (const key of keys) {
    if (draftUserFromKey(key) !== owner && removeKey(key)) removed += 1;
  }
  return removed;
}
