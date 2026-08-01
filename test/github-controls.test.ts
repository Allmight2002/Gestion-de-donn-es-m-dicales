import { describe, expect, test, vi } from 'vitest';
import {
  inspectGitHubControls,
  validateGitHubControlsConfiguration,
} from '../scripts/verify-github-controls.mjs';

const config = validateGitHubControlsConfiguration({
  GITHUB_REPOSITORY: 'owner/repository',
  GITHUB_CONTROLS_TOKEN: 'github-read-admin-token-long-enough',
});

const protection = () => ({
  required_status_checks: { contexts: ['build-test', 'scanner-image'] },
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_last_push_approval: true,
  },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_conversation_resolution: { enabled: true },
});

// Protection telle qu'un depot mono-personne peut reellement la poser : pull request obligatoire,
// mais aucune approbation exigee (GitHub interdit d'approuver sa propre pull request).
const soloProtection = () => ({
  ...protection(),
  required_pull_request_reviews: {
    required_approving_review_count: 0,
    dismiss_stale_reviews: false,
    require_last_push_approval: false,
  },
});

function githubApi(
  overrides: {
    unprotectedMain?: boolean;
    selfReview?: boolean;
    solo?: boolean;
    noPullRequest?: boolean;
    stagingBranches?: string[];
  } = {},
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/branches/')) {
      const value = overrides.solo ? soloProtection() : protection();
      if (overrides.unprotectedMain && url.includes('/branches/main/')) value.enforce_admins.enabled = false;
      if (overrides.noPullRequest) delete (value as { required_pull_request_reviews?: unknown }).required_pull_request_reviews;
      return Response.json(value);
    }
    if (url.includes('/deployment-branch-policies')) {
      const branches = url.includes('/production/')
        ? ['main']
        : (overrides.stagingBranches ?? ['develop', 'main']);
      return Response.json({ branch_policies: branches.map((name) => ({ name })) });
    }
    if (url.includes('/environments/')) {
      return Response.json({
        protection_rules: [{
          type: 'required_reviewers',
          prevent_self_review: !overrides.selfReview,
          reviewers: [{ type: 'Team', reviewer: { id: 42 } }],
        }],
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      });
    }
    return new Response(null, { status: 404 });
  });
}

describe('controles GitHub avant production', () => {
  test('accepte branches, checks, reviews et environnements stricts', async () => {
    await expect(inspectGitHubControls(config, { fetchImpl: githubApi() })).resolves.toEqual([]);
  });

  test('refuse un bypass admin et l auto-approbation environnement', async () => {
    const errors = await inspectGitHubControls(config, {
      fetchImpl: githubApi({ unprotectedMain: true, selfReview: true }),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'main: administrateurs non soumis aux regles.',
      'staging: auto-approbation non interdite.',
      'production: auto-approbation non interdite.',
    ]));
  });

  test('refuse une politique staging qui ne permet pas le SHA main exact ou autorise une branche en trop', async () => {
    const missingMain = await inspectGitHubControls(config, {
      fetchImpl: githubApi({ stagingBranches: ['develop'] }),
    });
    const extraBranch = await inspectGitHubControls(config, {
      fetchImpl: githubApi({ stagingBranches: ['develop', 'main', 'feature'] }),
    });

    expect(missingMain).toContain('staging: seules les branches develop et main doivent etre autorisees.');
    expect(extraBranch).toContain('staging: seules les branches develop et main doivent etre autorisees.');
  });

  test('echoue ferme si le plan ou le jeton refuse la protection', async () => {
    await expect(inspectGitHubControls(config, {
      fetchImpl: vi.fn(async () => Response.json({ message: 'forbidden detail' }, { status: 403 })),
    })).rejects.toThrow('HTTP 403');
  });
});

describe('derogation mono-personne', () => {
  const soloConfig = validateGitHubControlsConfiguration({
    GITHUB_REPOSITORY: 'owner/repository',
    GITHUB_CONTROLS_TOKEN: 'github-read-admin-token-long-enough',
    GITHUB_CONTROLS_SOLO: 'true',
  });

  test('accepte une protection sans approbation par un tiers', async () => {
    await expect(
      inspectGitHubControls(soloConfig, { fetchImpl: githubApi({ solo: true, selfReview: true }) }),
    ).resolves.toEqual([]);
  });

  test('cette meme protection reste REFUSEE hors derogation', async () => {
    const errors = await inspectGitHubControls(config, { fetchImpl: githubApi({ solo: true, selfReview: true }) });
    expect(errors).toEqual(expect.arrayContaining([
      'main: review obligatoire absente.',
      'main: reviews obsoletes non invalidees.',
      'main: dernier push sans approbation distincte.',
      'production: auto-approbation non interdite.',
    ]));
  });

  test('la derogation ne relache RIEN d autre : bypass admin toujours refuse', async () => {
    const errors = await inspectGitHubControls(soloConfig, {
      fetchImpl: githubApi({ solo: true, selfReview: true, unprotectedMain: true }),
    });
    expect(errors).toEqual(['main: administrateurs non soumis aux regles.']);
  });

  test('la pull request reste obligatoire meme en derogation', async () => {
    const errors = await inspectGitHubControls(soloConfig, {
      fetchImpl: githubApi({ solo: true, selfReview: true, noPullRequest: true }),
    });
    expect(errors).toEqual(expect.arrayContaining([
      'main: pull request non obligatoire.',
      'develop: pull request non obligatoire.',
    ]));
  });
});
