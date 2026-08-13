import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { App } from './App';
import { initTheme } from './lib/theme';
import { reportClientError } from './lib/reportError';
import './index.css';

initTheme(); // theme clair/sombre applique AVANT le rendu (pas d'eclair de mauvais theme)

window.addEventListener('error', (event) => reportClientError(event.error, undefined, 'window-error'));
window.addEventListener('unhandledrejection', () => reportClientError(new Error('Unhandled rejection'), undefined, 'unhandled-rejection'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Vercel Analytics : pages vues anonymes (routes SPA suivies automatiquement).
        Inactif en dev ; n'emet que sur le deploiement Vercel. Aucune donnee applicative. */}
    <Analytics />
    {/* Vercel Speed Insights : Core Web Vitals collectes uniquement sur deploiement Vercel. */}
    <SpeedInsights />
  </StrictMode>,
);
