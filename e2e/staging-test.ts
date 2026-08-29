// Point d'import unique pour les parcours staging. L'acces Vercel est prepare dans le workflow
// sous forme d'un cookie HttpOnly/Secure limite au domaine exact, avant le lancement de Playwright.
export { expect, test } from '@playwright/test';
