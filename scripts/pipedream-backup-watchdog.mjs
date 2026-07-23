const REPOSITORY = 'Allmight2002/Gestion-de-donn-es-m-dicales';
const WORKFLOW = 'continuity-backup.yml';
const BRANCH = 'develop';
const STAGING_JOB = 'backup (staging)';
const MAX_AGE_HOURS = 30;
const RUN_LOOKBACK_HOURS = 36;
const MAX_RUNS = 10;
const GITHUB_API = 'https://api.github.com';

const asComponent = typeof globalThis.defineComponent === 'function'
  ? globalThis.defineComponent
  : (component) => component;

const clean = (value) => value?.trim() ?? '';
const numericRunId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0
  ? String(value)
  : null;
const validDate = (value) => Number.isFinite(Date.parse(value ?? ''));

function boundedResult({
  ok,
  observedAt,
  errorCode = null,
  latestSuccessAt = null,
  runId = null,
  drill = false,
}) {
  return {
    ok,
    target: 'staging',
    check: 'continuity-backup',
    observedAt,
    maxAgeHours: MAX_AGE_HOURS,
    errorCode,
    latestSuccessAt,
    runId,
    drill,
  };
}

async function githubJson(path, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${GITHUB_API}${path}`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'meddata-backup-watchdog',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('github-api-unavailable');
  }

  if (response.status < 200 || response.status >= 300) {
    await response.arrayBuffer().catch(() => undefined);
    throw new Error('github-api-unavailable');
  }

  try {
    return await response.json();
  } catch {
    throw new Error('github-api-unavailable');
  }
}

export async function checkBackupFreshness({
  token,
  now = new Date(),
  fetchImpl = fetch,
  forceTestAlert = false,
} = {}) {
  const observedAt = new Date(now);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error('Date de controle invalide.');
  }

  if (forceTestAlert) {
    return boundedResult({
      ok: false,
      observedAt: observedAt.toISOString(),
      errorCode: 'expected-test-alert',
      drill: true,
    });
  }

  const cleanToken = clean(token);
  if (!cleanToken) {
    return boundedResult({
      ok: false,
      observedAt: observedAt.toISOString(),
      errorCode: 'github-api-unavailable',
    });
  }

  try {
    const runsPath = `/repos/${REPOSITORY}/actions/workflows/${encodeURIComponent(WORKFLOW)}/runs`
      + `?branch=${encodeURIComponent(BRANCH)}&per_page=${MAX_RUNS}&exclude_pull_requests=true`;
    const runsPayload = await githubJson(runsPath, cleanToken, fetchImpl);
    if (!Array.isArray(runsPayload?.workflow_runs)) {
      throw new Error('github-api-unavailable');
    }

    const lookbackStart = observedAt.getTime() - RUN_LOOKBACK_HOURS * 60 * 60 * 1000;
    const candidateRuns = runsPayload.workflow_runs.filter((run) => (
      numericRunId(run?.id)
      && run?.status === 'completed'
      && run?.head_branch === BRANCH
      && validDate(run?.created_at)
      && Date.parse(run.created_at) >= lookbackStart
    ));

    let latest = null;
    for (const run of candidateRuns) {
      const runId = numericRunId(run.id);
      const jobsPayload = await githubJson(
        `/repos/${REPOSITORY}/actions/runs/${runId}/jobs?per_page=100`,
        cleanToken,
        fetchImpl,
      );
      if (!Array.isArray(jobsPayload?.jobs)) {
        throw new Error('github-api-unavailable');
      }

      for (const job of jobsPayload.jobs) {
        if (
          job?.name !== STAGING_JOB
          || job?.status !== 'completed'
          || job?.conclusion !== 'success'
          || !validDate(job?.completed_at)
        ) {
          continue;
        }
        const completedAt = new Date(job.completed_at);
        if (!latest || completedAt > latest.completedAt) {
          latest = { completedAt, runId };
        }
      }
    }

    const maximumAgeMs = MAX_AGE_HOURS * 60 * 60 * 1000;
    if (latest && observedAt.getTime() - latest.completedAt.getTime() <= maximumAgeMs) {
      return boundedResult({
        ok: true,
        observedAt: observedAt.toISOString(),
        latestSuccessAt: latest.completedAt.toISOString(),
        runId: latest.runId,
      });
    }

    return boundedResult({
      ok: false,
      observedAt: observedAt.toISOString(),
      errorCode: 'backup-missing',
      latestSuccessAt: latest?.completedAt.toISOString() ?? null,
      runId: latest?.runId ?? null,
    });
  } catch {
    return boundedResult({
      ok: false,
      observedAt: observedAt.toISOString(),
      errorCode: 'github-api-unavailable',
    });
  }
}

export function buildWatchdogEmail(result) {
  const isDrill = result?.drill === true;
  const code = isDrill
    ? 'expected-test-alert'
    : result?.errorCode === 'github-api-unavailable'
      ? 'github-api-unavailable'
      : 'backup-missing';
  const subject = isDrill
    ? "[MedData staging] Test d'alerte - Sauvegarde absente"
    : '[MedData staging] Incident détecté - Sauvegarde absente';
  const explanation = code === 'github-api-unavailable'
    ? "Pipedream n'a pas pu vérifier les sauvegardes dans GitHub."
    : code === 'backup-missing'
      ? `Aucune sauvegarde staging réussie depuis plus de ${MAX_AGE_HOURS} heures.`
      : "Ceci est un test attendu du détecteur externe d'absence de sauvegarde.";

  return {
    subject,
    text: [
      'MedData staging',
      '',
      'Contrôle : continuity-backup',
      `Code : ${code}`,
      explanation,
      '',
      'Action : vérifier le workflow GitHub Continuity backup et la dernière sauvegarde staging.',
      'Aucune donnée médicale ni aucun secret ne sont inclus dans cette alerte.',
    ].join('\n'),
  };
}

export const pipedreamComponent = {
  props: {
    github: {
      type: 'app',
      app: 'github',
      label: 'Compte GitHub MedData',
    },
    forceTestAlert: {
      type: 'boolean',
      label: "Forcer l'alerte de test",
      description: 'Activer uniquement pour le test manuel, puis remettre à false avant déploiement.',
      default: false,
    },
  },
  async run({ $ }) {
    const result = await checkBackupFreshness({
      token: this.github?.$auth?.oauth_access_token,
      forceTestAlert: this.forceTestAlert === true,
    });

    if (result.ok) {
      $.export('$summary', 'Sauvegarde staging récente : contrôle externe vert.');
      return result;
    }

    $.send.email(buildWatchdogEmail(result));
    $.export(
      '$summary',
      result.drill
        ? "Alerte de test d'absence de sauvegarde envoyée."
        : `Incident de sauvegarde signalé (${result.errorCode}).`,
    );
    return { ...result, emailQueued: true };
  },
};

export default asComponent(pipedreamComponent);
