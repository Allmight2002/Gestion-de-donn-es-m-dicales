// L59 — choisir un bloc reutilisable et l'importer dans la version en cours d'edition.
//
// Ce panneau n'invente aucune regle. L58 tient toutes les decisions dans la base ; ici on
// montre, dans l'ordre : ce qui existe, ce qui sera ecrit, ce qui coince, et ce que l'import
// coutera. Trois principes le gouvernent.
//
//   1. AUCUNE ECRITURE AVANT CONFIRMATION. Le choix d'un bloc et chaque changement de
//      resolution declenchent `preview_template_section_import`, qui ne pose aucun verrou et
//      n'ecrit rien. La RPC d'import n'est appelee que par le bouton de confirmation.
//   2. AUCUN REFUS ANTICIPE. L'ecran ne rejoue ni la lisibilite, ni le gel, ni la
//      compatibilite d'une variable : il affiche le rapport du serveur. La seule chose qu'il
//      retire du catalogue est la version cible elle-meme, dont l'import echouerait toujours.
//   3. AUCUN RENOMMAGE, JAMAIS (D5). La seule resolution proposee est de reutiliser la
//      variable deja presente, et seulement quand le serveur a pose `reusable`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import type { TemplateRepository } from '../../data/templates';
import type {
  ImportableBlock,
  SectionImportConflict,
  SectionImportReport,
  TemplateField,
} from '../../data/types';
import {
  IMPORT_REFUSAL_MESSAGE_KEY,
  blockFields,
  fieldsBecomingAlwaysRequired,
  groupCatalogByVersion,
  groupConflicts,
  importRefusalCode,
} from '../../domain/templateSectionImport';
import type { ImportedBlockActivation } from '../../domain/blockActivation';

/** Valeur d'option du selecteur : la paire (version, bloc) suffit a designer une source. */
const optionValue = (block: ImportableBlock) => `${block.versionId}::${block.sectionKey}`;

export function SectionImportDialog({
  repo,
  targetVersionId,
  onClose,
  onImported,
  onActivate,
}: {
  repo: TemplateRepository;
  targetVersionId: string;
  onClose: () => void;
  /** Recharge l'editeur : le bloc doit apparaitre en fin de version. */
  onImported: () => void | Promise<void>;
  /** Point d'entree de L60 : conditionner le bloc qui vient d'arriver. La condition d'origine
   *  et son pilote SOURCE partent avec, car le rapport seul ne dit ni le type ni la portee du
   *  pilote, dont L60 a besoin pour juger la compatibilite. */
  onActivate: (activation: ImportedBlockActivation) => void;
}) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<ImportableBlock[] | null>(null);
  const [selection, setSelection] = useState('');
  const [sourceFields, setSourceFields] = useState<TemplateField[]>([]);
  const [report, setReport] = useState<SectionImportReport | null>(null);
  const [reuseKeys, setReuseKeys] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<SectionImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Un refus type porte son code dans `detail`. Tout le reste — reseau, panne, erreur non
  // typee — retombe sur `errorMessage` : l'ecran ne fabrique jamais un motif metier.
  const refusalMessage = useCallback((cause: unknown) => {
    const code = importRefusalCode(cause);
    return code ? t(IMPORT_REFUSAL_MESSAGE_KEY[code]) : errorMessage(cause, t('common.error'));
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await repo.listImportableSections!();
        if (!cancelled) setCatalog(rows);
      } catch (cause) {
        if (!cancelled) { setCatalog([]); setError(refusalMessage(cause)); }
      }
    })();
    return () => { cancelled = true; };
  }, [repo, refusalMessage]);

  const [selectedVersionId, selectedSectionKey] = selection ? selection.split('::') : ['', ''];

  // Previsualisation : rejouee a chaque changement de bloc OU de resolution. `token` ecarte
  // la reponse d'une demande depassee, sinon un aller-retour lent ecraserait le rapport
  // courant par un rapport perime.
  const token = useRef(0);
  useEffect(() => {
    if (!selectedVersionId || !selectedSectionKey) { setReport(null); return; }
    const current = ++token.current;
    setPreviewing(true);
    void (async () => {
      try {
        const [next, fields] = await Promise.all([
          repo.previewSectionImport!(selectedVersionId, selectedSectionKey, targetVersionId, reuseKeys),
          // Les libelles, les types et surtout `required` du bloc ne sont pas dans le rapport :
          // ils se lisent sur la source, qui est lisible par construction puisqu'elle vient
          // du catalogue. `getFields` est allege ; `getVersion` est le repli toujours present.
          repo.getFields ? repo.getFields(selectedVersionId) : repo.getVersion(selectedVersionId).then((v) => v.fields),
        ]);
        if (current !== token.current) return;
        setReport(next);
        setSourceFields(fields);
        setError(null);
      } catch (cause) {
        if (current !== token.current) return;
        setReport(null);
        setError(refusalMessage(cause));
      } finally {
        if (current === token.current) setPreviewing(false);
      }
    })();
  }, [repo, selectedVersionId, selectedSectionKey, targetVersionId, reuseKeys, refusalMessage]);

  const groups = groupCatalogByVersion(catalog ?? [], targetVersionId);
  const { reusable, blocking } = groupConflicts(report);
  const alwaysRequired = fieldsBecomingAlwaysRequired(report, sourceFields);
  const imported = blockFields(report, sourceFields).filter((f) => report?.importedFields.includes(f.fieldKey));
  const labelOf = (key: string) => sourceFields.find((f) => f.fieldKey === key)?.label ?? key;

  const groupLabel = (group: (typeof groups)[number]) => {
    const name = group.templateName ?? t('blockimport.source_unnamed');
    const version = t('blockimport.source_version').replace('{n}', String(group.versionNumber));
    return group.isGlobal ? `${name} · ${version} (${t('blockimport.source_global')})` : `${name} · ${version}`;
  };

  const conflictWhere = (conflict: SectionImportConflict) =>
    conflict.existingSection
      ? t('blockimport.conflict_location_section').replace('{section}', conflict.existingSection)
      : t('blockimport.conflict_location_common');

  // Garde de double clic : l'etat React est asynchrone, deux clics rapproches peuvent donc
  // franchir un bouton simplement `disabled`. Le verrou de reference, lui, est pose dans le
  // meme tour de boucle que le premier clic. Un double clic ne produit jamais deux imports.
  const inFlight = useRef(false);
  async function confirm() {
    if (inFlight.current || !selectedVersionId || !selectedSectionKey) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const result = await repo.importSection!(selectedVersionId, selectedSectionKey, targetVersionId, reuseKeys);
      setDone(result);
      setError(null);
      await onImported();
    } catch (cause) {
      setError(refusalMessage(cause));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const summary = done && t('blockimport.success_summary')
    .replace('{block}', done.sectionKey)
    .replace('{imported}', String(done.importedFields.length))
    .replace('{reused}', String(done.reusedFields.length))
    .replace('{rules}', String(done.copiedRules))
    .replace('{subsections}', String(done.subsections.length));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button type="button" className="absolute inset-0 bg-slate-950/30" aria-label={t('blockimport.close')} onClick={onClose} />
      <aside
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-import-title"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white/95 p-4 backdrop-blur">
          <h3 id="block-import-title" className="text-lg font-semibold text-slate-900">
            {done ? t('blockimport.success_title') : t('blockimport.title')}
          </h3>
          <button type="button" className="icon-button h-11 w-11" onClick={onClose} aria-label={t('blockimport.close')}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-4 p-4 text-sm">
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}

          {done ? (
            <>
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">{summary}</p>
              {/* Le bloc arrive TOUJOURS visible sans condition : D7 interdit de copier sa
                  regle d'activation. Le passage a L60 est donc propose systematiquement. */}
              <p className="text-slate-700">{t('blockimport.success_activation')}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={() => onActivate({
                  sectionKey: done.sectionKey,
                  activation: done.activationRule,
                  // Le pilote se lit sur la SOURCE, deja chargee pour l'apercu. Absent de la
                  // liste, il reste `null` : L60 conclura au pilote introuvable plutot que
                  // de comparer contre rien.
                  sourceDriver: sourceFields.find((f) => f.fieldKey === done.activationRule?.field) ?? null,
                })}>
                  {t('blockimport.activate_cta')}
                </button>
                <button type="button" className="btn-ghost" onClick={onClose}>{t('blockimport.close')}</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-600">{t('blockimport.help')}</p>

              {catalog === null ? (
                <p className="text-slate-500">{t('blockimport.catalog_loading')}</p>
              ) : groups.length === 0 ? (
                // Catalogue vide : un etat explicite, jamais un ecran blanc.
                <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600">
                  {t('blockimport.catalog_empty')}
                </p>
              ) : (
                <label className="form-label">
                  {t('blockimport.catalog_label')}
                  <select
                    className="input"
                    value={selection}
                    onChange={(event) => { setSelection(event.target.value); setReuseKeys([]); }}
                  >
                    <option value="">{t('blockimport.catalog_choose')}</option>
                    {groups.map((group) => (
                      <optgroup key={group.versionId} label={groupLabel(group)}>
                        {group.blocks.map((block) => (
                          <option key={optionValue(block)} value={optionValue(block)}>
                            {block.label} · {t('blockimport.block_summary')
                              .replace('{n}', String(block.fieldCount))
                              .replace('{s}', String(block.subsectionCount))}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              )}

              {previewing && <p className="text-slate-500">{t('blockimport.preview_loading')}</p>}

              {report && !previewing && (
                <>
                  <section className="card space-y-2 p-3">
                    <h4 className="text-sm font-semibold text-slate-700">{t('blockimport.preview_title')}</h4>
                    {report.subsections.length > 0 && (
                      <p className="text-slate-600">
                        {t('blockimport.preview_subsections').replace('{list}', report.subsections.join(', '))}
                      </p>
                    )}
                    <p className="font-medium text-slate-700">{t('blockimport.preview_fields')}</p>
                    <ul className="space-y-1">
                      {imported.map((field) => (
                        <li key={field.fieldKey} className="flex flex-wrap items-baseline gap-2">
                          <span className="text-slate-900">{field.label}</span>
                          <span className="font-mono text-xs text-slate-400">{field.fieldKey}</span>
                          {field.required && <span className="badge">{t('admin.required')}</span>}
                        </li>
                      ))}
                    </ul>
                    {report.reusedFields.length > 0 && (
                      <p className="text-slate-600">
                        {t('blockimport.preview_reused')} : {report.reusedFields.map(labelOf).join(', ')}
                      </p>
                    )}
                    <p className="text-slate-600">
                      {t('blockimport.preview_rules').replace('{n}', String(report.copiedRules))}
                    </p>
                    <p className="text-slate-600">
                      {report.activationRule?.field
                        ? t('blockimport.activation_not_copied').replace('{field}', labelOf(report.activationRule.field))
                        : t('blockimport.activation_none')}
                    </p>
                  </section>

                  {/* D9 : l'avertissement ne se decouvre pas au premier formulaire. Il n'est
                      affiche que s'il s'applique — des variables `required` reellement
                      importees —, sans quoi il deviendrait un bruit qu'on cesse de lire. */}
                  {alwaysRequired.length > 0 && (
                    <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                      {t('blockimport.required_warning')
                        .replace('{n}', String(alwaysRequired.length))
                        .replace('{list}', alwaysRequired.map((field) => field.label).join(', '))}
                    </p>
                  )}

                  {(reusable.length > 0 || blocking.length > 0) && (
                    <section className="card space-y-3 p-3">
                      <h4 className="text-sm font-semibold text-slate-700">{t('blockimport.conflicts_title')}</h4>
                      {reusable.map((conflict) => (
                        <div key={`reusable-${conflict.fieldKey}`} className="space-y-1 border-l-4 border-amber-300 pl-3">
                          <p className="font-mono text-xs text-slate-500">{conflict.fieldKey}</p>
                          <p className="text-slate-700">{t('blockimport.conflict_reusable')}</p>
                          <p className="text-slate-600">
                            {t('blockimport.conflict_lives_in').replace('{where}', conflictWhere(conflict))}
                          </p>
                          <label className="flex items-center gap-2 text-slate-800">
                            <input
                              type="checkbox"
                              checked={reuseKeys.includes(conflict.fieldKey!)}
                              onChange={(event) => setReuseKeys((keys) => (event.target.checked
                                ? [...keys, conflict.fieldKey!]
                                : keys.filter((key) => key !== conflict.fieldKey)))}
                            />
                            {t('blockimport.conflict_reuse_action')}
                          </label>
                        </div>
                      ))}
                      {/* Aucune proposition ici : la cle, le lieu et le motif, puis la main
                          rendue a l'utilisateur. Un renommage automatique detruirait la
                          comparabilite entre bases, qui est la raison d'etre du produit. */}
                      {blocking.map((conflict, index) => (
                        <div key={`blocking-${conflict.fieldKey ?? index}`} className="space-y-1 border-l-4 border-red-300 pl-3">
                          {conflict.fieldKey && <p className="font-mono text-xs text-slate-500">{conflict.fieldKey}</p>}
                          <p className="text-slate-700">{t(IMPORT_REFUSAL_MESSAGE_KEY[conflict.code])}</p>
                          {/* Le lieu n'est annonce que si le rapport le porte vraiment. Pour un
                              conflit de formule le serveur laisse `existingSection` a null quel
                              que soit l'endroit : affirmer « tronc commun » serait inventer. */}
                          {conflict.existingSection && (
                            <p className="text-slate-600">
                              {t('blockimport.conflict_lives_in').replace('{where}', conflictWhere(conflict))}
                            </p>
                          )}
                          {conflict.operandKey && (
                            <p className="text-slate-600">
                              {t('blockimport.conflict_operand').replace('{key}', conflict.operandKey)}
                            </p>
                          )}
                        </div>
                      ))}
                      <p className="text-xs text-slate-500">{t('blockimport.conflict_no_rename')}</p>
                    </section>
                  )}

                  {reuseKeys.length > 0 && (
                    <p className="text-xs text-slate-500">{t('blockimport.conflict_reuse_chosen')}</p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {!done && (
          <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
            <button
              type="button"
              className="btn-primary"
              // Confirmation fermee tant qu'un conflit subsiste : l'import le refuserait, et
              // annoncer un echec previsible vaut mieux qu'un aller-retour pour rien.
              disabled={!report || previewing || submitting || report.conflicts.length > 0}
              onClick={() => void confirm()}
            >
              {submitting ? t('blockimport.importing') : t('blockimport.confirm')}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
              {t('blockimport.cancel')}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
