import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { App } from './App';
import { initTheme } from './lib/theme';
import './index.css';

initTheme(); // theme clair/sombre applique AVANT le rendu (pas d'eclair de mauvais theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {/* Vercel Analytics : pages vues anonymes (routes SPA suivies automatiquement).
        Inactif en dev ; n'emet que sur le deploiement Vercel. Aucune donnee applicative. */}
    <Analytics />
  </StrictMode>,
);
