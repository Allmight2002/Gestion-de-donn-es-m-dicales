import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTheme } from './lib/theme';
import './index.css';

initTheme(); // theme clair/sombre applique AVANT le rendu (pas d'eclair de mauvais theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
