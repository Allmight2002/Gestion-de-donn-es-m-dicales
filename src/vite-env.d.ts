/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Version applicative injectee au build (define) — affichee sur l'ecran « etat du systeme ».
declare const __APP_VERSION__: string;
declare const __GIT_COMMIT__: string;
declare const __GIT_BRANCH__: string;
declare const __BUILD_TIME__: string;
