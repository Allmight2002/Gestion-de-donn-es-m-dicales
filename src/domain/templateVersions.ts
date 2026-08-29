import type { TemplateVersion } from '../data/types';

function latest(versions: readonly TemplateVersion[], status?: TemplateVersion['status']) {
  return versions
    .filter((version) => !status || version.status === status)
    .reduce<TemplateVersion | null>((current, version) => (
      !current || version.versionNumber > current.versionNumber ? version : current
    ), null);
}

/**
 * Priorité d’ouverture d’un jeu : le dernier brouillon en cours, puis la version publiée
 * courante, puis le dernier historique restant comme filet pour les jeux anciens.
 */
export function preferredTemplateVersion(versions: readonly TemplateVersion[]): TemplateVersion | null {
  return latest(versions, 'draft') ?? latest(versions, 'published') ?? latest(versions);
}

export function currentTemplateVersion(versions: readonly TemplateVersion[]): TemplateVersion | null {
  return latest(versions, 'published') ?? latest(versions);
}

export function draftTemplateVersion(versions: readonly TemplateVersion[]): TemplateVersion | null {
  return latest(versions, 'draft');
}
