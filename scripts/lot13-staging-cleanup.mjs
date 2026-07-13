import { cleanupLot13, safeMessage } from './lot13-staging-support.mjs';

const prefix = process.env.LOT13_RUN_PREFIX;
if (!prefix) {
  console.error('LOT13_RUN_PREFIX manquant');
  process.exit(1);
}

try {
  const result = await cleanupLot13(prefix);
  console.log(
    `Nettoyage LOT 13 termine: ${result.bases} base(s), ${result.templates} modele(s), `
    + `${result.storageObjects} objet(s) Storage, ${result.authUsers} compte(s) ephemere(s).`,
  );
} catch (error) {
  console.error(`Nettoyage LOT 13 incomplet: ${safeMessage(error)}`);
  process.exit(1);
}
