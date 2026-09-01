import { describe, expect, test, vi } from 'vitest';
import {
  buildOperationsAlert,
  deliverOperationsAlert,
  validateAlertConfiguration,
} from '../scripts/send-operations-alert.mjs';

const configEnvironment = {
  MONITOR_TARGET: 'staging',
  MONITOR_ALERT_WEBHOOK_URL: 'https://alerts.example.test/hooks/secret-path',
};

describe('alerte operationnelle expurgee', () => {
  test('exige un webhook HTTPS sans identifiants', () => {
    expect(validateAlertConfiguration(configEnvironment)).toMatchObject({ target: 'staging' });
    expect(() => validateAlertConfiguration({
      ...configEnvironment,
      MONITOR_ALERT_WEBHOOK_URL: 'http://alerts.example.test/hook',
    })).toThrow(/HTTPS/);
    expect(() => validateAlertConfiguration({
      ...configEnvironment,
      MONITOR_ALERT_WEBHOOK_URL: 'https://user:password@alerts.example.test/hook',
    })).toThrow(/sans identifiants/);
  });

  test('ne transmet ni URL de service, ni reponse brute, ni code interne libre', () => {
    const alert = buildOperationsAlert({
      format: 'meddata-operations-monitor/v1',
      target: 'staging',
      observedAt: '2026-07-19T04:00:00.000Z',
      appOriginSha256: 'a'.repeat(64),
      secret: 'must-not-leak',
      checks: [
        { name: 'clamav-health', ok: false, errorCode: 'network', raw: 'internal-host' },
        { name: '../../forged', ok: false, errorCode: 'SQL detail: patient row' },
      ],
    }, { target: 'staging', runId: '1234', repository: 'owner/repo' });
    expect(alert).toMatchObject({
      event: 'monitor-failure',
      target: 'staging',
      failedChecks: [
        { name: 'clamav-health', errorCode: 'network' },
        { name: 'unknown-check', errorCode: 'probe-failed' },
      ],
    });
    expect(JSON.stringify(alert)).not.toMatch(/must-not-leak|internal-host|patient row|appOrigin/i);
  });

  test('livre le JSON borne et masque tout detail reseau en cas d echec', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(null, { status: 204 })
    ));
    await deliverOperationsAlert(validateAlertConfiguration(configEnvironment), { format: 'test' }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error' });

    await expect(deliverOperationsAlert(
      validateAlertConfiguration(configEnvironment),
      { format: 'test' },
      { fetchImpl: vi.fn(async () => { throw new Error('secret internal network'); }) },
    )).rejects.toThrow('detail masque');
  });
});
