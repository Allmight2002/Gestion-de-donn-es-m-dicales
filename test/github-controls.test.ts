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

function githubApi(overrides: { unprotectedMain?: boolean; selfReview?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/branches/')) {
      const value = protection();
      if (overrides.unprotectedMain && url.includes('/branches/main/')) value.enforce_admins.enabled = false;
      return Response.json(value);
    }
    if (url.includes('/deployment-branch-policies')) {
      return Response.json({ branch_policies: [{ name: url.includes('/production/') ? 'main' : 'develop' }] });
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

  test('echoue ferme si le plan ou le jeton refuse la protection', async () => {
    await expect(inspectGitHubControls(config, {
      fetchImpl: vi.fn(async () => Response.json({ message: 'forbidden detail' }, { status: 403 })),
    })).rejects.toThrow('HTTP 403');
  });
});
