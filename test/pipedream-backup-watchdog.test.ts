import { describe, expect, test, vi } from 'vitest';
import {
  buildWatchdogEmail,
  checkBackupFreshness,
} from '../scripts/pipedream-backup-watchdog.mjs';

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } },
);

const run = {
  id: 30005845353,
  status: 'completed',
  conclusion: 'failure',
  head_branch: 'develop',
  created_at: '2026-07-23T12:09:05.000Z',
};

describe("détecteur Pipedream d'absence de sauvegarde staging", () => {
  test("accepte le job staging réussi même si le run global échoue", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/Allmight2002/Gestion-de-donn-es-m-dicales')) {
        return jsonResponse({ default_branch: 'develop' });
      }
      if (url.includes('/actions/workflows/continuity-backup.yml/runs')) {
        return jsonResponse({ workflow_runs: [run] });
      }
      if (url.includes('/actions/runs/30005845353/jobs')) {
        return jsonResponse({
          jobs: [
            {
              name: 'backup (production)',
              status: 'completed',
              conclusion: 'failure',
              completed_at: '2026-07-23T12:10:00.000Z',
            },
            {
              name: 'backup (staging)',
              status: 'completed',
              conclusion: 'success',
              completed_at: '2026-07-23T12:13:13.000Z',
            },
          ],
        });
      }
      return jsonResponse({}, 404);
    });

    const result = await checkBackupFreshness({
      token: 'secret-token',
      now: new Date('2026-07-24T08:00:00.000Z'),
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: true,
      target: 'staging',
      check: 'continuity-backup',
      runId: '30005845353',
      latestSuccessAt: '2026-07-23T12:13:13.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('branch=develop');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  test("signale une sauvegarde absente après 30 heures", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/Allmight2002/Gestion-de-donn-es-m-dicales')) {
        return jsonResponse({ default_branch: 'develop' });
      }
      if (url.includes('/actions/workflows/continuity-backup.yml/runs')) {
        return jsonResponse({
          workflow_runs: [{
            ...run,
            created_at: '2026-07-22T01:00:00.000Z',
          }],
        });
      }
      return jsonResponse({}, 404);
    });

    await expect(checkBackupFreshness({
      token: 'secret-token',
      now: new Date('2026-07-24T08:00:00.000Z'),
      fetchImpl,
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'backup-missing',
      maxAgeHours: 30,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("signale une API GitHub indisponible sans exposer sa réponse", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      message: 'private repository detail and token secret-token',
    }, 403));

    const result = await checkBackupFreshness({
      token: 'secret-token',
      now: new Date('2026-07-24T08:00:00.000Z'),
      fetchImpl,
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'github-api-unavailable',
    });
    expect(JSON.stringify(result)).not.toMatch(/private repository|secret-token/);
  });

  test("le mode test envoie un message borné sans appeler GitHub", async () => {
    const fetchImpl = vi.fn();
    const result = await checkBackupFreshness({
      token: '',
      now: new Date('2026-07-24T08:00:00.000Z'),
      fetchImpl,
      forceTestAlert: true,
    });
    const email = buildWatchdogEmail(result);

    expect(result).toMatchObject({
      ok: false,
      drill: true,
      errorCode: 'expected-test-alert',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(email.subject).toContain("Test d'alerte");
    expect(email.text).toContain('continuity-backup');
    expect(email.text).toContain('expected-test-alert');
    expect(email.text).not.toMatch(/token|patient/i);
  });
});
