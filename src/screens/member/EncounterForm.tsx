import { errorMessage } from '../../lib/errorMessage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Send } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useAuth } from '../../auth/useAuth';
import { isMissionAccount } from '../../auth/logic';
import { useBaseRepository, useCurationRepository, usePatientRepository, useTemplateRepository } from '../../data/RepositoryProvider';
import type { TemplateField, ValidationRule } from '../../data/types';
import { validateValues, evaluateRules, hiddenFieldKeys, withoutHiddenValues } from '../../domain/validation';
import { saveOnCtrlEnter } from '../../lib/formKeyboard';
import { saveDraft, loadDraft, clearDraft } from '../../data/drafts';
import { useToast } from '../../components/Toast';
import { EncounterFields, HiddenValuesNotice, fieldAppliesToType } from './EncounterFields';
import { forgetPrefilled, initialValuesFromDefaults, isClearedValue } from '../../domain/fieldDefaults';
import { SkeletonList } from '../../components/Skeleton';

// A4 : un brouillon de rencontre ne retient que de l'ANALYTIQUE (aucune identite).
interface EncounterDraft {
  encounterType: string;
  encounterDate: string;
  status: string;
  values: Record<string, unknown>;
}

const ENCOUNTER_TYPES = ['consultation', 'hospitalisation', 'suivi', 'autre'] as const;
const STATUSES = ['draft', 'complete', 'curated'] as const;

// Saisie dynamique d'une rencontre (cahier §8.5, §10) : champs par section, controles,
// valeurs manquantes codifiees, statut, age calcule (apercu), regles de coherence.
export function EncounterForm() {
  const { id: baseId, patientId } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const bases = useBaseRepository();
  const templates = useTemplateRepository();
  const patients = usePatientRepository();
  const curation = useCurationRepository();
  const { toast } = useToast();
  const { profile } = useAuth();
  // Meme regle que pour le patient : la voie curation est fermee aux comptes de mission.
  const maySubmitToCuration = !isMissionAccount(profile);

  const [fields, setFields] = useState<TemplateField[]>([]);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [encounterType, setEncounterType] = useState<string>('consultation');
  const [encounterDate, setEncounterDate] = useState('');
  const [status, setStatus] = useState<string>('draft');
  const [values, setValues] = useState<Record<string, unknown>>({});
  // Cles preremplies par le jeu de variables et pas encore touchees (L28) : affichage seul.
  const [prefilled, setPrefilled] = useState<Set<string>>(new Set());
  const [age, setAge] = useState<number | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draftRestored, setDraftRestored] = useState(false); // A4
  const draftReady = useRef(false); // A4 : autorise l'autosave seulement apres chargement + restauration

  const labelOf = (key: string) => fields.find((f) => f.fieldKey === key)?.label ?? key;
  const msg = (e: unknown) => (errorMessage(e, t('common.error')));

  // L32 — la visibilite s'evalue sur EXACTEMENT ce qui partira au serveur : les champs
  // applicables au type choisi. Evaluer sur autre chose ferait diverger l'ecran du serveur
  // des qu'une variable pilote cesse de s'appliquer au type de visite.
  const applicableFields = useMemo(
    () => fields.filter((f) => fieldAppliesToType(f, encounterType)),
    [fields, encounterType],
  );
  const { hidden, removed, data: submittedData } = useMemo(() => {
    const applicableData = Object.fromEntries(
      Object.entries(values).filter(([k]) => applicableFields.some((f) => f.fieldKey === k)),
    );
    const hiddenKeys = hiddenFieldKeys(rules, applicableData);
    const stripped = withoutHiddenValues(applicableData, hiddenKeys);
    return { hidden: hiddenKeys, removed: stripped.removed, data: stripped.values };
  }, [values, applicableFields, rules]);

  const load = useCallback(async () => {
    if (!baseId) return;
    setLoading(true);
    try {
      const base = await bases.getBase(baseId);
      if (!base?.base.currentTemplateVersionId) {
        setError(t('common.error'));
        return;
      }
      const version = await templates.getVersion(base.base.currentTemplateVersionId);
      const encounterFields = version.fields.filter((f) => f.scope === 'encounter').sort((a, b) => a.displayOrder - b.displayOrder);
      setFields(encounterFields);
      setRules(version.rules);
      // A4 : restaurer un brouillon local eventuel (saisie non enregistree recuperee).
      const draft = patientId ? loadDraft<EncounterDraft>('encounter', patientId) : null;
      if (draft) {
        setEncounterType(draft.data.encounterType);
        setEncounterDate(draft.data.encounterDate);
        setStatus(draft.data.status);
        setValues(draft.data.values);
        setDraftRestored(true);
      } else {
        // Preremplissage a la CREATION seulement, et jamais par-dessus un brouillon : une
        // valeur que la personne avait effacee ne doit pas reapparaitre a la reprise.
        const proposed = initialValuesFromDefaults(encounterFields);
        setValues(proposed.values);
        setPrefilled(proposed.prefilled);
      }
      setError(null);
    } catch (e) {
      setError(msg(e));
    } finally {
      setLoading(false);
      draftReady.current = true; // autosave actif seulement apres ce premier chargement
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseId, patientId, bases, templates]);

  // A4 : sauvegarde continue (debounce) du brouillon ANALYTIQUE tant qu'il y a du contenu.
  useEffect(() => {
    if (!draftReady.current || !patientId) return;
    const hasContent = !!encounterDate || Object.keys(values).length > 0;
    const handle = setTimeout(() => {
      if (hasContent) saveDraft<EncounterDraft>('encounter', patientId, { encounterType, encounterDate, status, values });
    }, 600);
    return () => clearTimeout(handle);
  }, [patientId, encounterType, encounterDate, status, values]);

  function discardDraft() {
    if (patientId) clearDraft('encounter', patientId);
    setEncounterType('consultation');
    setEncounterDate('');
    setStatus('draft');
    // Abandonner le brouillon rend un formulaire NEUF : les propositions reviennent.
    const proposed = initialValuesFromDefaults(fields);
    setValues(proposed.values);
    setPrefilled(proposed.prefilled);
    setDraftRestored(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  // Apercu de l'age : calcule par le systeme des que la date est posee (DOB jamais exposee).
  useEffect(() => {
    let on = true;
    if (!patientId || !encounterDate) {
      setAge(null);
      return;
    }
    patients
      .computeAge(patientId, encounterDate)
      .then((a) => on && setAge(a))
      .catch(() => on && setAge(null));
    return () => {
      on = false;
    };
  }, [patientId, encounterDate, patients]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!baseId || !patientId) return;

    // Seuls les champs APPLICABLES au type choisi sont valides / envoyes (ex: pas d'admission
    // pour une consultation). Les valeurs des champs masques ne sont pas soumises : c'est ICI
    // que l'effacement decide par le lot a lieu, apres l'annonce faite a l'ecran.
    const applicable = applicableFields;
    const applicableData = submittedData;
    // Le serveur valide toujours les valeurs renseignees, mais n'impose la completude et les
    // regles bloquantes qu'au statut curated. Le frontend reproduit exactement cette frontiere.
    const requireComplete = status === 'curated';
    const fieldErrors = validateValues(applicable, applicableData, requireComplete, hidden).map((fe) =>
      `${labelOf(fe.fieldKey)} : ${fe.message}`
    );
    const ruleEval = evaluateRules(
      rules.map((r) => ({ rule: r.rule, message: r.message, severity: r.severity })),
      applicableData,
      hidden,
    );
    const block = [...fieldErrors, ...(requireComplete ? ruleEval.blocking : [])];
    if (!encounterDate) block.unshift(t('encounter.date'));
    setBlocking(block);
    setWarnings(ruleEval.warnings);
    if (block.length > 0) return;

    setBusy(true);
    try {
      await patients.createEncounter(patientId, {
        encounterType, encounterDate, validationStatus: status, ageUnit: 'years', data: applicableData,
      });
      clearDraft('encounter', patientId); // A4 : la saisie est enregistree -> plus de brouillon
      toast(t('toast.encounter_saved')); // UI-2 : la reussite se voit
      navigate(`/bases/${baseId}/patients/${patientId}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  // Confier la rencontre au staff : cree une demande de portee 'encounter' et ouvre la page
  // de depot des documents deidentifies. La saisie en cours reste dans son brouillon local.
  async function submitToStaff() {
    if (!baseId || !patientId) return;
    setBusy(true);
    try {
      const { taskId } = await curation.createSubmission(baseId, patientId, null, 'encounter');
      navigate(`/curation/${taskId}`);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <SkeletonList rows={6} label={t('common.loading')} />;

  return (
    <section className="max-w-2xl space-y-5 sm:space-y-6">
      <div>
        <button onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="text-sm font-medium text-slate-500 hover:text-teal-700">
          ← {t('admin.back')}
        </button>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="page-title">{t('encounter.new')}</h1>
          {maySubmitToCuration && (
            <button type="button" onClick={() => void submitToStaff()} disabled={busy} className="btn-secondary">
              <Send size={16} aria-hidden /> {t('create.submit')}
            </button>
          )}
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {draftRestored && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
          <span>{t('draft.restored')}</span>
          <button type="button" onClick={discardDraft} className="whitespace-nowrap font-medium text-sky-700 hover:underline">
            {t('draft.discard')}
          </button>
        </div>
      )}

      <form onSubmit={submit} onKeyDown={saveOnCtrlEnter} className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col text-sm">
            <span className="text-slate-700">{t('encounter.type')}</span>
            <select className="input mt-1" value={encounterType} onChange={(e) => setEncounterType(e.target.value)}>
              {ENCOUNTER_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`encountertype.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-slate-700">{t('encounter.date')}</span>
            {/* A2 : focus d'emblee sur la date (type/statut ont un defaut) -> saisie sans la souris. */}
            <input type="date" autoFocus className="input mt-1" value={encounterDate} onChange={(e) => setEncounterDate(e.target.value)} required />
          </label>
          <label className="flex flex-col text-sm">
            <span className="text-slate-700">{t('encounter.status')}</span>
            <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`encstatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {t('encounter.age')} : <strong>{age ?? '—'}</strong>
          <span className="ml-2 text-xs text-teal-600">{t('encounter.age_hint')}</span>
        </div>

        <EncounterFields
          fields={applicableFields}
          values={values}
          prefilledKeys={prefilled}
          hiddenKeys={hidden}
          onChange={(k, v) => {
            // Effacer une proposition jamais confirmee retire la cle, au lieu d'enregistrer
            // une valeur vide la ou une fiche non preremplie n'aurait rien du tout.
            const wasProposed = prefilled.has(k);
            setPrefilled((current) => forgetPrefilled(current, k));
            setValues((p) => {
              if (wasProposed && isClearedValue(v)) {
                const { [k]: _cleared, ...rest } = p;
                return rest;
              }
              return { ...p, [k]: v };
            });
          }}
          onRemove={(key) => {
            setPrefilled((current) => forgetPrefilled(current, key));
            setValues((current) => {
              const { [key]: _removed, ...remaining } = current;
              return remaining;
            });
          }}
        />

        <HiddenValuesNotice removedKeys={removed} fields={fields} />

        {blocking.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">{t('encounter.blocking')}</p>
            <ul className="list-disc pl-5">
              {blocking.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">{t('encounter.warnings')}</p>
            <ul className="list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className="btn-primary">
            {t('encounter.save')}
          </button>
          <button type="button" onClick={() => navigate(`/bases/${baseId}/patients/${patientId}`)} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <span className="ml-auto text-xs text-slate-400">{t('common.save_shortcut')}</span>
        </div>
      </form>
    </section>
  );
}
