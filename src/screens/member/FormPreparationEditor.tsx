import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/useI18n';
import { useFormPreparationRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { BaseListing, ObservationModel } from '../../data/bases';
import type {
  FormPreparation,
  FormPreparationClassification,
  FormPreparationContext,
  FormPreparationOpenResult,
} from '../../data/formPreparations';
import { FormPreparationError } from '../../data/formPreparations';
import { errorMessage } from '../../lib/errorMessage';
import type { MessageKey } from '../../i18n/messages';
import { SkeletonList } from '../../components/Skeleton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TemplateVersionEditor } from '../staff/TemplateVersionEditor';
import {
  createPreparationTemplateRepository,
  type PreparationEditorLoaded,
  type PreparationTemplateRepository,
} from '../../domain/formPreparationEditor';

interface PreparationSession {
  opened: FormPreparationOpenResult;
  source: PreparationEditorLoaded;
}

export interface FormPreparationEditorProps {
  baseId: string;
  listing: BaseListing;
  onBack: () => void;
}

type PreparationAction = 'save' | 'preview' | 'apply' | 'discard';

function newOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const suffix = Math.floor(Math.random() * 0x1_0000_0000_0000).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const CLASSIFICATION_KEYS: Record<FormPreparationClassification, MessageKey> = {
  additive: 'formprep.classification_additive',
  additive_required: 'formprep.classification_additive_required',
  semantic: 'formprep.classification_semantic',
  unsupported: 'formprep.classification_unsupported',
};

/**
 * Lecture du contrat d'impact réellement produit par E2
 * (`form_preparation_apply_impact`) : `serverCounts`, les listes `added*` et les
 * compteurs d'écriture. Aucun synonyme n'est deviné : si le serveur cesse de publier une
 * mesure, la ligne correspondante disparaît au lieu d'être remplacée par une approximation.
 */
function countOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  return null;
}

function stateLabel(
  preparation: FormPreparation | null,
  dirty: boolean,
  t: (key: MessageKey) => string,
): string {
  if (dirty) return t('formprep.local');
  if (!preparation) return t('formprep.none');
  return t(`formprep.state_${preparation.state}` as MessageKey);
}

function isTerminal(preparation: FormPreparation | null): boolean {
  return preparation?.state === 'applied' || preparation?.state === 'discarded' || preparation?.state === 'expired';
}

function errorCode(error: unknown): string {
  if (error instanceof FormPreparationError) return error.code;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return typeof value.code === 'string' ? value.code : typeof value.message === 'string' ? value.message : '';
  }
  return String(error ?? '');
}

function isConflict(error: unknown): boolean {
  return /CONFLICT|STALE|CONTEXT_CHANGED/i.test(errorCode(error));
}

function PreparationCanvas({
  baseId,
  context,
  source,
  initialPreparation,
  templateName,
  observationModel,
  repository,
  onClosed,
  onBackToBase,
}: {
  baseId: string;
  context: FormPreparationContext;
  source: PreparationEditorLoaded;
  initialPreparation: FormPreparation | null;
  templateName?: string;
  observationModel?: ObservationModel;
  repository: ReturnType<typeof useFormPreparationRepository>;
  onClosed: (preparation: FormPreparation | null) => void;
  onBackToBase: () => void;
}) {
  const { t } = useI18n();
  const initialDefinition = initialPreparation?.payload ?? context.definition;
  const [editorRevision, setEditorRevision] = useState(0);
  const [preparation, setPreparation] = useState<FormPreparation | null>(initialPreparation);
  const [action, setAction] = useState<PreparationAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [impact, setImpact] = useState<Record<string, unknown> | null>(null);
  const [application, setApplication] = useState<Record<string, unknown> | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const onCandidateChanged = useCallback(() => {
    setEditorRevision((value) => value + 1);
    setActionError(null);
    setNotice(null);
    setImpact(null);
  }, []);
  const adapter = useMemo<PreparationTemplateRepository>(
    () => createPreparationTemplateRepository(source, initialDefinition, onCandidateChanged),
    [source, initialDefinition, onCandidateChanged],
  );
  // Le candidat ne change qu'à une commande de l'éditeur : sérialiser à chaque rendu
  // coûterait tout le formulaire, et une base réelle en porte plusieurs centaines de variables.
  const candidateSnapshot = useMemo(
    () => JSON.stringify(adapter.getPreparationPayload()),
    // `editorRevision` est le signal de changement d’un dépôt mutable : la règle ne peut pas
    // le déduire, et l’omettre figerait le candidat sur son état du premier rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter, editorRevision],
  );
  const baselineSnapshot = useRef<string | null>(null);
  if (baselineSnapshot.current === null) baselineSnapshot.current = candidateSnapshot;
  const dirty = candidateSnapshot !== baselineSnapshot.current;
  const inFlight = useRef(false);
  const preparationId = useRef(initialPreparation?.id ?? newOperationId());
  const attempts = useRef(new Map<string, { key: string; operationId: string }>());

  const expectedSourceRevision = context.sourceRevision;
  const expectedSourceFingerprint = context.sourceFingerprint;
  const expectedPreparationRevision = preparation?.preparationRevision ?? 0;

  function operationFor(kind: PreparationAction, key: string): string {
    const previous = attempts.current.get(kind);
    if (previous?.key === key) return previous.operationId;
    const next = { key, operationId: newOperationId() };
    attempts.current.set(kind, next);
    return next.operationId;
  }

  function clearOperation(kind: PreparationAction): void {
    attempts.current.delete(kind);
  }

  function lock(kind: PreparationAction): boolean {
    if (inFlight.current) return false;
    inFlight.current = true;
    setAction(kind);
    return true;
  }

  function unlock(): void {
    inFlight.current = false;
    setAction(null);
  }

  function readableError(error: unknown): string {
    const code = errorCode(error);
    if (code === 'FORM_CHANGE_UNSUPPORTED') return t('formprep.change_unsupported');
    if (code === 'FORM_SEMANTIC_MIGRATION_REQUIRED') return t('formprep.semantic_migration');
    return errorMessage(error, t('common.error'));
  }

  useEffect(() => {
    if (!dirty) return;
    // Un nouveau candidat périme l'impact déjà vérifié. L'état serveur reste « prêt » tant que
    // ce candidat n'est pas enregistré, mais l'application est bloquée entre-temps.
    setImpact(null);
  }, [candidateSnapshot, dirty]);

  async function savePreparation(): Promise<void> {
    if (!dirty || editorDirty || preparation?.state === 'conflict' || isTerminal(preparation) || !lock('save')) return;
    const payload = adapter.getPreparationPayload();
    const payloadSnapshot = JSON.stringify(payload);
    const key = JSON.stringify({
      baseId,
      preparationId: preparationId.current,
      expectedPreparationRevision,
      expectedSourceRevision,
      expectedSourceFingerprint,
      payloadSnapshot,
    });
    const operationId = operationFor('save', key);
    setActionError(null);
    try {
      const receipt = await repository.save({
        preparationId: preparationId.current,
        baseId,
        expectedPreparationRevision,
        expectedSourceRevision,
        expectedSourceFingerprint,
        operationId,
        payload,
      });
      setPreparation(receipt.preparation);
      baselineSnapshot.current = payloadSnapshot;
      setImpact(null);
      setNotice(t('formprep.saved'));
      clearOperation('save');
    } catch (error) {
      if (isConflict(error) && preparation) setPreparation({ ...preparation, state: 'conflict' });
      setActionError(readableError(error));
    } finally {
      unlock();
    }
  }

  async function previewPreparation(): Promise<void> {
    if (!preparation || dirty || editorDirty || isTerminal(preparation) || !lock('preview')) return;
    const key = JSON.stringify({
      preparationId: preparation.id,
      expectedPreparationRevision: preparation.preparationRevision,
      expectedSourceRevision,
      expectedSourceFingerprint,
    });
    const operationId = operationFor('preview', key);
    setActionError(null);
    try {
      const receipt = await repository.preview({
        preparationId: preparation.id,
        expectedPreparationRevision: preparation.preparationRevision,
        expectedSourceRevision,
        expectedSourceFingerprint,
        operationId,
      });
      setPreparation(receipt.preparation);
      setImpact(receipt.impact ?? null);
      setNotice(null);
      clearOperation('preview');
    } catch (error) {
      if (isConflict(error)) setPreparation({ ...preparation, state: 'conflict' });
      // Un refus sémantique reste accompagné de son impact serveur : le montrer explique le
      // refus sans jamais rendre l'application possible, l'état restant hors de « ready ».
      const refused = error instanceof FormPreparationError ? error.receipt?.impact : undefined;
      setImpact(refused ?? null);
      setActionError(readableError(error));
    } finally {
      unlock();
    }
  }

  async function applyPreparation(): Promise<void> {
    if (!preparation || preparation.state !== 'ready' || dirty || editorDirty || !impact || !lock('apply')) return;
    const key = JSON.stringify({
      preparationId: preparation.id,
      expectedPreparationRevision: preparation.preparationRevision,
      expectedSourceRevision,
      expectedSourceFingerprint,
    });
    const operationId = operationFor('apply', key);
    setActionError(null);
    try {
      const receipt = await repository.apply({
        preparationId: preparation.id,
        expectedPreparationRevision: preparation.preparationRevision,
        expectedSourceRevision,
        expectedSourceFingerprint,
        operationId,
      });
      setPreparation(receipt.preparation);
      setApplication(receipt.application ?? null);
      setNotice(t('formprep.apply_success'));
      clearOperation('apply');
    } catch (error) {
      if (isConflict(error)) setPreparation({ ...preparation, state: 'conflict' });
      setActionError(readableError(error));
    } finally {
      unlock();
      setApplyOpen(false);
    }
  }

  async function discardPreparation(): Promise<void> {
    setDiscardOpen(false);
    if (!preparation) {
      onClosed(null);
      return;
    }
    if (isTerminal(preparation) || !lock('discard')) return;
    const key = JSON.stringify({
      preparationId: preparation.id,
      expectedPreparationRevision: preparation.preparationRevision,
      expectedSourceRevision,
      expectedSourceFingerprint,
    });
    const operationId = operationFor('discard', key);
    setActionError(null);
    try {
      await repository.discard({
        preparationId: preparation.id,
        expectedPreparationRevision: preparation.preparationRevision,
        expectedSourceRevision,
        expectedSourceFingerprint,
        operationId,
      });
      clearOperation('discard');
      onClosed(null);
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      unlock();
    }
  }

  function requestClose(): void {
    if (inFlight.current) return;
    if (dirty || editorDirty) setLeaveOpen(true);
    else onClosed(preparation && !isTerminal(preparation) ? preparation : null);
  }

  function abandonLocalAndClose(): void {
    setLeaveOpen(false);
    onClosed(preparation && !isTerminal(preparation) ? preparation : null);
  }

  const canPreview = !!preparation && !dirty && !isTerminal(preparation)
    && !editorDirty
    && (preparation.state === 'active' || preparation.state === 'ready');
  const canApply = preparation?.state === 'ready' && !dirty && !editorDirty && impact !== null && !inFlight.current;
  const busy = action !== null;
  const stateText = stateLabel(preparation, dirty || editorDirty, t);
  const serverCounts = objectOf(impact?.serverCounts);
  const clinicalWrites = objectOf(impact?.clinicalWrites);
  const patientCount = countOf(serverCounts?.patients);
  const encounterCount = countOf(serverCounts?.encounters);
  const fieldCount = countOf(impact?.addedFields);
  const sectionCount = countOf(impact?.addedSections);
  const groupCount = countOf(impact?.addedCommonGroups);
  const ruleCount = countOf(impact?.addedRules);
  const diagnosisCount = countOf(impact?.addedDiagnosisAssociations);
  // L'absence d'écriture clinique n'est affirmée que si le serveur la déclare lui-même.
  const noClinicalWrites = impact !== null && clinicalWrites !== null
    && countOf(clinicalWrites.patients) === 0
    && countOf(clinicalWrites.encounters) === 0
    && countOf(clinicalWrites.values) === 0
    && countOf(impact.identityWrites) === 0
    && countOf(impact.documentWrites) === 0;

  return (
    <>
      <ConfirmDialog
        open={leaveOpen}
        title={t('formprep.leave_title')}
        body={t('formprep.leave_body')}
        confirmLabel={t('formprep.leave_confirm')}
        busy={busy}
        onCancel={() => setLeaveOpen(false)}
        onConfirm={abandonLocalAndClose}
      />
      <ConfirmDialog
        open={discardOpen}
        title={t('formprep.abandon_title')}
        body={preparation ? t('formprep.abandon_body') : t('formprep.abandon_local_body')}
        confirmLabel={t('formprep.abandon')}
        danger
        busy={busy}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => void discardPreparation()}
      />
      <ConfirmDialog
        open={applyOpen}
        title={t('formprep.apply_title')}
        body={(
          <div className="space-y-2">
            <p>{t('formprep.apply_body')}</p>
            {impact && <p className="text-xs text-slate-500">{t('formprep.impact_help')}</p>}
          </div>
        )}
        confirmLabel={t('formprep.apply')}
        busy={busy}
        confirmDisabled={!canApply}
        onCancel={() => setApplyOpen(false)}
        onConfirm={() => void applyPreparation()}
      />

      <section className="card space-y-4 p-4" data-testid="form-preparation-session">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{t('formprep.title')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('formprep.description')}</p>
            <p className="mt-2 text-xs text-slate-500">
              {t('formprep.source')}: {templateName ?? source.version.templateId}
              {' · '}{t('formprep.source_version')} {source.version.versionNumber}
              {' · '}{t('formprep.source_revision')} {context.sourceRevision}
            </p>
            <p className="mt-1 break-all text-xs text-slate-400">
              {t('formprep.source_fingerprint')}: {context.sourceFingerprint.slice(0, 18)}…
            </p>
          </div>
          <span
            data-testid="formprep-state"
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${dirty || editorDirty || preparation?.state === 'conflict'
              ? 'bg-amber-100 text-amber-900' : preparation?.state === 'ready' ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-100 text-slate-700'}`}
          >
            {t('formprep.status')}: {stateText}
          </span>
        </div>
        <p className="text-xs text-slate-500">{t('formprep.technical_note')}</p>
        <p className="text-xs text-slate-500">{t('formprep.no_justification')}</p>

        <div className="flex flex-wrap gap-2" data-testid="formprep-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void savePreparation()}
            disabled={!dirty || editorDirty || busy || preparation?.state === 'conflict' || isTerminal(preparation)}
          >
            {action === 'save' ? t('formprep.saving') : t('formprep.save')}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void previewPreparation()}
            disabled={!canPreview || busy}
          >
            {action === 'preview' ? t('formprep.saving') : t('formprep.impact')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setApplyOpen(true)}
            disabled={!canApply || busy}
          >
            {t('formprep.apply')}
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => setDiscardOpen(true)}
            disabled={busy || (isTerminal(preparation) && !dirty)}
          >
            {t('formprep.abandon')}
          </button>
          <button type="button" className="btn-ghost" onClick={requestClose} disabled={busy}>
            {t('formprep.close')}
          </button>
        </div>

        {preparation?.state === 'conflict' && (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t('formprep.conflict_help')}
          </p>
        )}
        {editorDirty && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('formprep.editor_pending')}</p>}
        {actionError && <p role="alert" className="text-sm text-red-600">{actionError}</p>}
        {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
        {application && (
          <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p>{t('formprep.apply_success')}</p>
            <button type="button" className="mt-2 font-medium underline underline-offset-2" onClick={onBackToBase}>
              {t('formprep.back')}
            </button>
          </div>
        )}

        {impact && (
          <div data-testid="formprep-impact" className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950">
            <h3 className="font-semibold">{t('formprep.impact_title')}</h3>
            <p className="mt-1 text-xs">{t('formprep.impact_help')}</p>
            {preparation && (
              <p className="mt-1 text-xs font-medium">
                {t('formprep.impact_classification').replace('{label}', t(CLASSIFICATION_KEYS[preparation.classification]))}
              </p>
            )}
            <ul className="mt-2 space-y-1">
              {patientCount !== null && <li>{t('formprep.impact_patients').replace('{count}', String(patientCount))}</li>}
              {encounterCount !== null && <li>{t('formprep.impact_encounters').replace('{count}', String(encounterCount))}</li>}
              {fieldCount !== null && <li>{t('formprep.impact_fields').replace('{count}', String(fieldCount))}</li>}
              {sectionCount !== null && <li>{t('formprep.impact_sections').replace('{count}', String(sectionCount))}</li>}
              {groupCount !== null && <li>{t('formprep.impact_groups').replace('{count}', String(groupCount))}</li>}
              {ruleCount !== null && <li>{t('formprep.impact_rules').replace('{count}', String(ruleCount))}</li>}
              {diagnosisCount !== null && <li>{t('formprep.impact_diagnosis').replace('{count}', String(diagnosisCount))}</li>}
            </ul>
            {noClinicalWrites && <p className="mt-2 font-medium">{t('formprep.impact_no_clinical_writes')}</p>}
          </div>
        )}
      </section>

      <div className="relative">
        <TemplateVersionEditor
          versionId={source.version.id}
          templateName={templateName}
          observationModel={observationModel}
          onBack={requestClose}
          showVersionActions={false}
          repository={adapter}
          preparationMode
          onDirtyChange={setEditorDirty}
        />
        {busy && <div className="absolute inset-0 z-10 cursor-wait bg-white/30" aria-hidden="true" />}
      </div>
    </>
  );
}

export function FormPreparationEditor({ baseId, listing, onBack }: FormPreparationEditorProps) {
  const { t } = useI18n();
  const repository = useFormPreparationRepository();
  const templates = useTemplateRepository();
  const [session, setSession] = useState<PreparationSession | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resumeAttempt = useRef<{ key: string; operationId: string } | null>(null);

  const load = useCallback(async () => {
    if (!repository.available) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const opened = await repository.openOrResume(baseId);
      const sourceVersion = await templates.getVersion(opened.context.sourceTemplateVersionId);
      setSession({
        opened,
        source: sourceVersion,
      });
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, t('common.error')));
    } finally {
      setLoading(false);
    }
  }, [baseId, repository, templates, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resumeConflict(): Promise<void> {
    const preparation = session?.opened.preparation;
    if (!preparation || preparation.state !== 'conflict' || busy) return;
    const key = `${preparation.id}:${preparation.preparationRevision}`;
    const operationId = resumeAttempt.current?.key === key
      ? resumeAttempt.current.operationId
      : newOperationId();
    resumeAttempt.current = { key, operationId };
    setBusy(true);
    setError(null);
    try {
      await repository.resume({
        preparationId: preparation.id,
        expectedPreparationRevision: preparation.preparationRevision,
        operationId,
      });
      await load();
      setEditing(true);
      resumeAttempt.current = null;
    } catch (cause) {
      setError(errorMessage(cause, t('common.error')));
    } finally {
      setBusy(false);
    }
  }

  function beginEditing(): void {
    if (busy || !session) return;
    if (session.opened.preparation?.state === 'conflict') {
      void resumeConflict();
      return;
    }
    setError(null);
    setEditing(true);
  }

  function closeEditor(preparation: FormPreparation | null): void {
    setEditing(false);
    setSession((current) => current ? {
      ...current,
      opened: {
        ...current.opened,
        preparation: preparation && !isTerminal(preparation) ? preparation : null,
        persisted: !!preparation && !isTerminal(preparation),
      },
    } : current);
    if (preparation?.state === 'applied') {
      // Après une application réussie, la fiche de base pointe encore l'ancienne version :
      // recharger le contexte en lecture seule avant de réafficher l'écran d'accueil.
      void load();
    }
  }

  if (loading) return <SkeletonList rows={5} label={t('common.loading')} />;
  if (!repository.available) return <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('formprep.unavailable')}</p>;
  if (error && !session) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!session) return <p role="alert" className="text-sm text-red-600">{t('common.error')}</p>;

  if (editing) {
    return (
      <PreparationCanvas
        baseId={baseId}
        context={session.opened.context}
        source={session.source}
        initialPreparation={session.opened.preparation}
        templateName={listing.templateName ?? undefined}
        observationModel={listing.base.observationModel}
        repository={repository}
        onClosed={closeEditor}
        onBackToBase={onBack}
      />
    );
  }

  const preparation = session.opened.preparation;
  const conflict = preparation?.state === 'conflict';
  const actionLabel = conflict ? t('formprep.resume') : preparation ? t('formprep.continue') : t('formprep.start');

  return (
    <section className="space-y-4" data-testid="form-preparation-landing">
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{t('formprep.title')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('formprep.description')}</p>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">{t('formprep.source')}</dt><dd className="font-medium">{listing.templateName ?? session.source.version.templateId}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('formprep.source_version')}</dt><dd>{session.source.version.versionNumber}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('formprep.source_revision')}</dt><dd>{session.opened.context.sourceRevision}</dd></div>
          <div><dt className="text-xs text-slate-500">{t('formprep.source_fingerprint')}</dt><dd className="break-all text-xs">{session.opened.context.sourceFingerprint.slice(0, 18)}…</dd></div>
        </dl>
        <p className="text-xs text-slate-500">{t('formprep.technical_note')}</p>
        {preparation && <p data-testid="formprep-landing-state" className="text-sm text-slate-700">{t('formprep.status')}: {stateLabel(preparation, false, t)}</p>}
        {conflict && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('formprep.conflict_help')}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={beginEditing} disabled={busy}>
            {busy ? t('formprep.saving') : actionLabel}
          </button>
          <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>{t('formprep.back')}</button>
        </div>
      </div>
    </section>
  );
}
