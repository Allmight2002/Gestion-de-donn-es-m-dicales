import { expect, test } from 'vitest';
import { assessContinuityJobs } from '../scripts/send-continuity-alert.mjs';

test('isole chaque cible et separe sauvegarde, copie et livraison', () => {
  const jobs = [
    { name: 'backup (production)', status: 'completed', conclusion: 'success' },
    { name: 'preserve-copy (production)', status: 'completed', conclusion: 'success' },
    { name: 'backup (staging)', status: 'completed', conclusion: 'failure' },
    { name: 'alert (production)', status: 'in_progress' },
  ];
  expect(assessContinuityJobs(jobs, 'production').every((check) => check.ok)).toBe(true);
  expect(assessContinuityJobs(jobs, 'staging').every((check) => !check.ok)).toBe(true);
  expect(assessContinuityJobs([jobs[0]], 'production')[1]).toMatchObject({ ok: false, errorCode: 'durable-copy-failed' });
  expect(assessContinuityJobs([...jobs, jobs[0]], 'production')[0].ok).toBe(false);
});
