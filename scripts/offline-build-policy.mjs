const clean = (value) => value?.trim() ?? '';

export function assertOfflineBuildPolicy(env, buildMode = 'production') {
  if (buildMode !== 'production') return;

  const offlineMode = clean(env.VITE_OFFLINE_MODE) || 'disabled';
  const adminAck = clean(env.VITE_OFFLINE_ADMIN_ACK) || 'false';
  const isolatedDemo = clean(env.ALLOW_OFFLINE_DEMO_BUILD) === 'true';

  if (!['disabled', 'demo'].includes(offlineMode) || !['false', 'true'].includes(adminAck)) {
    throw new Error('Configuration hors-ligne invalide : valeurs attendues disabled/false ou demo/true.');
  }
  if (offlineMode === 'disabled' && adminAck === 'false') return;
  if (offlineMode === 'demo' && adminAck === 'true' && isolatedDemo) return;

  throw new Error(
    'Build de production refuse : le hors-ligne doit rester disabled/false. ' +
      'Seul le preview LOT 13 isole peut utiliser demo/true avec ALLOW_OFFLINE_DEMO_BUILD=true.',
  );
}
