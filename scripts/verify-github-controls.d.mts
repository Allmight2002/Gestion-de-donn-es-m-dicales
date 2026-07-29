export type GitHubControlsConfiguration = { repository: string; token: string; solo: boolean };
export function validateGitHubControlsConfiguration(
  env?: Record<string, string | undefined>,
): GitHubControlsConfiguration;
export function inspectGitHubControls(
  config: GitHubControlsConfiguration,
  options?: { fetchImpl?: typeof fetch },
): Promise<string[]>;
