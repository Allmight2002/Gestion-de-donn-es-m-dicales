import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = 'https://api.github.com';
const REQUIRED_CHECKS = ['build-test', 'scanner-image'];
const BRANCHES = ['main', 'develop'];
const ENVIRONMENTS = { staging: ['develop', 'main'], production: ['main'] };
const clean = (value) => value?.trim() ?? '';

// DEROGATION MONO-PERSONNE (GITHUB_CONTROLS_SOLO=true).
// Trois exigences de ce controle supposent une SECONDE personne : une review approuvee, une
// approbation distincte apres le dernier push, et l'interdiction de s'auto-approuver sur un
// environnement. GitHub interdisant d'approuver sa propre pull request, les activer sur un depot
// tenu par une seule personne ne renforce rien : elles rendent toute fusion et tout deploiement
// impossibles. La derogation les suspend, et RIEN d'autre : checks CI obligatoires, regles
// applicables aux administrateurs, interdiction du force-push et de la suppression de branche,
// resolution des conversations et politique de branche par environnement restent exiges.
// A LEVER des qu'un second relecteur existe : remettre GITHUB_CONTROLS_SOLO a false.
export function validateGitHubControlsConfiguration(env = process.env) {
  const repository = clean(env.GITHUB_REPOSITORY);
  const token = clean(env.GITHUB_CONTROLS_TOKEN);
  const solo = clean(env.GITHUB_CONTROLS_SOLO) === 'true';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY doit etre au format owner/repository.');
  }
  if (token.length < 20) throw new Error('GITHUB_CONTROLS_TOKEN lecture administration est absent.');
  return { repository, token, solo };
}

async function fetchJson(path, config, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${API_ROOT}${path}`, {
      redirect: 'error',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${config.token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('API GitHub inaccessible (detail masque).');
  }
  if (response.status !== 200) {
    await response.arrayBuffer();
    throw new Error(`API GitHub refuse le controle (HTTP ${response.status}).`);
  }
  return await response.json();
}

function inspectBranch(branch, protection, solo = false) {
  const errors = [];
  const contexts = protection?.required_status_checks?.contexts ?? [];
  for (const check of REQUIRED_CHECKS) {
    if (!contexts.includes(check)) errors.push(`${branch}: check ${check} non obligatoire.`);
  }
  const reviews = protection?.required_pull_request_reviews;
  // La pull request reste OBLIGATOIRE en mode mono-personne : seule l'approbation par un tiers
  // est suspendue. L'objet absent signifie une fusion directe possible -> toujours refuse.
  if (!reviews) errors.push(`${branch}: pull request non obligatoire.`);
  if (!solo) {
    if (!reviews || reviews.required_approving_review_count < 1) errors.push(`${branch}: review obligatoire absente.`);
    if (reviews?.dismiss_stale_reviews !== true) errors.push(`${branch}: reviews obsoletes non invalidees.`);
    if (reviews?.require_last_push_approval !== true) errors.push(`${branch}: dernier push sans approbation distincte.`);
  }
  if (protection?.enforce_admins?.enabled !== true) errors.push(`${branch}: administrateurs non soumis aux regles.`);
  if (protection?.allow_force_pushes?.enabled !== false) errors.push(`${branch}: force-push non interdit.`);
  if (protection?.allow_deletions?.enabled !== false) errors.push(`${branch}: suppression de branche non interdite.`);
  if (protection?.required_conversation_resolution?.enabled !== true) {
    errors.push(`${branch}: conversations non resolues autorisees.`);
  }
  return errors;
}

function inspectEnvironment(name, expectedBranches, environment, policies, solo = false) {
  const errors = [];
  const reviewerRule = environment?.protection_rules?.find((rule) => rule.type === 'required_reviewers');
  // Le reviewer d'environnement reste EXIGE meme en mode mono-personne : il impose une action
  // deliberee avant tout deploiement. Seule l'interdiction de s'auto-approuver est suspendue,
  // faute de quoi le seul reviewer possible ne pourrait jamais approuver.
  if (!reviewerRule || !Array.isArray(reviewerRule.reviewers) || reviewerRule.reviewers.length < 1) {
    errors.push(`${name}: reviewer d environnement absent.`);
  }
  if (!solo && reviewerRule?.prevent_self_review !== true) errors.push(`${name}: auto-approbation non interdite.`);
  if (environment?.deployment_branch_policy?.protected_branches !== false
      || environment?.deployment_branch_policy?.custom_branch_policies !== true) {
    errors.push(`${name}: politique de branche personnalisee stricte absente.`);
  }
  const names = Array.isArray(policies?.branch_policies)
    ? policies.branch_policies.map((policy) => policy?.name).filter(Boolean).sort()
    : [];
  const expected = [...expectedBranches].sort();
  if (names.length !== expected.length || names.some((branch, index) => branch !== expected[index])) {
    const qualifier = expected.length === 1 ? 'seule la branche' : 'seules les branches';
    errors.push(`${name}: ${qualifier} ${expected.join(' et ')} doivent etre autorisees.`);
  }
  return errors;
}

export async function inspectGitHubControls(config, { fetchImpl = fetch } = {}) {
  const errors = [];
  for (const branch of BRANCHES) {
    const protection = await fetchJson(
      `/repos/${config.repository}/branches/${encodeURIComponent(branch)}/protection`,
      config,
      fetchImpl,
    );
    errors.push(...inspectBranch(branch, protection, config.solo));
  }
  for (const [environmentName, expectedBranches] of Object.entries(ENVIRONMENTS)) {
    const encoded = encodeURIComponent(environmentName);
    const environment = await fetchJson(
      `/repos/${config.repository}/environments/${encoded}`,
      config,
      fetchImpl,
    );
    const policies = await fetchJson(
      `/repos/${config.repository}/environments/${encoded}/deployment-branch-policies?per_page=100`,
      config,
      fetchImpl,
    );
    errors.push(...inspectEnvironment(environmentName, expectedBranches, environment, policies, config.solo));
  }
  return errors;
}

async function main() {
  const config = validateGitHubControlsConfiguration();
  const errors = await inspectGitHubControls(config);
  if (errors.length) throw new Error(`Controles GitHub non conformes:\n- ${errors.join('\n- ')}`);
  if (config.solo) {
    // Trace volontairement dans le journal de release : la derogation doit etre visible dans la
    // preuve, pas seulement dans le code.
    console.log(
      'Controles GitHub: OK en mode MONO-PERSONNE. Derogation active: review approuvee, '
        + 'approbation apres dernier push et interdiction d auto-approbation sont suspendues '
        + '(GitHub interdit d approuver sa propre pull request). Tout le reste est verifie. '
        + 'A LEVER des qu un second relecteur existe.',
    );
    return;
  }
  console.log('Controles GitHub: OK (branches, checks, reviews et environnements; identites masquees).');
}

const isMain = process.argv[1]
  && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Controle GitHub impossible.');
    process.exitCode = 1;
  });
}
