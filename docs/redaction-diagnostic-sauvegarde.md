# Expurger un diagnostic de sauvegarde avant de le journaliser

> **Objet** : conserver une pièce réutilisable issue d'une branche d'instrumentation supprimée.
> **Origine** : `codex/backup-host-network-diagnostic`, commit `d549bcb` du 2026-07-16, jamais
> fusionnée. Archivée sous l'étiquette `archive/backup-diagnostics-2026-07-16`.
> **Statut** : **non intégré au code**. Ce document est une référence, pas une fonctionnalité.

---

## Pourquoi ce document existe

En juillet 2026, la sauvegarde chiffrée pré-release échouait sans qu'on sache pourquoi. Deux
branches de sondes ont été ouvertes pour le diagnostiquer. Elles ont fait leur travail : la cause
a été traitée par trois correctifs (`13cf51e` échec sûr, `963fb92` préchargement de l'image
épinglée, `a0d2023` alignement sur PostgreSQL 17), et les releases coordonnées du 2026-08-01 et
du 2026-08-09 sont passées, sauvegarde comprise.

Les sondes elles-mêmes sont donc périmées — et **dangereuses à fusionner en l'état** : elles
posaient `BACKUP_DIAGNOSTIC_ONLY: 'true'` dans le workflow, ce qui fait volontairement échouer la
sauvegarde avant écriture. Les branches ont été supprimées le 2026-08-10.

Ce qu'elles contenaient de durable a été conservé de deux façons :

- `dumpFailureSignals` et l'élargissement de `classifyDumpFailure` sont **déjà dans `develop`** ;
- `safeDumpDiagnosticSummary`, reproduite ci-dessous, ne l'est pas — d'où ce document.

## Le problème qu'elle résout

Aujourd'hui, `classifyDumpFailure` ne renvoie qu'une **catégorie** (`timeout`, `docker`,
`auth`…) et le détail brut est masqué. C'est sûr : rien ne fuit. Mais quand une sauvegarde échoue
en CI pour une raison inédite, la catégorie seule ne suffit pas à comprendre, et il faut rejouer
à la main.

La tentation est alors de journaliser `error.stderr`. **C'est exactement ce qu'il ne faut pas
faire** : la sortie de `pg_dump` contient l'URL de connexion complète — hôte, utilisateur,
référence de projet, mot de passe.

`safeDumpDiagnosticSummary` est le compromis : elle rend le message lisible **après avoir retiré
tout ce qui identifie ou authentifie**.

## La fonction

Elle procède en deux temps, et l'ordre compte : d'abord le retrait des **littéraux connus**
(l'URL fournie et ses composantes décodées, du plus long au plus court), puis des **motifs
génériques** pour ce qui aurait échappé. Elle borne enfin la sortie à 600 caractères.

```js
export function safeDumpDiagnosticSummary(error, databaseUrl) {
  let diagnostic = [error?.stderr, error?.stdout]
    .filter(Boolean)
    .map((value) => Buffer.isBuffer(value) ? value.toString('utf8') : String(value))
    .join('\n')
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), ' ');
  const literals = new Set([clean(databaseUrl)]);
  try {
    const url = new URL(clean(databaseUrl));
    for (const value of [url.hostname, url.username, url.password]) {
      if (!value) continue;
      literals.add(value);
      try { literals.add(decodeURIComponent(value)); } catch { /* valeur deja opaque */ }
    }
  } catch { /* URL deja refusee par les gates */ }
  for (const literal of [...literals].filter((value) => value.length >= 4).sort((a, b) => b.length - a.length)) {
    diagnostic = diagnostic.split(literal).join('[redacted]');
  }
  return diagnostic
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[db-url]')
    .replace(/(?:PGPASSWORD|password)\s*[=:]\s*[^\s]+/gi, 'password=[redacted]')
    .replace(/\b(host|user)=[^\s`]+/gi, (_match, name) => `${name}=[redacted]`)
    .replace(/\b[a-z0-9]{20}\b/gi, '[project-ref]')
    .replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g, '[opaque-value]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600) || 'aucun-detail-disponible';
}
```

Quelques détails qui ne se devinent pas :

- **Les séquences ANSI sont neutralisées en premier.** Sans cela, un `\e[31m` inséré au milieu
  d'un mot de passe coloré par l'outil empêcherait la correspondance littérale.
- **Les littéraux sont retirés du plus long au plus court.** L'inverse laisserait des fragments :
  retirer d'abord un nom d'utilisateur court contenu dans l'URL casserait le retrait de l'URL
  entière.
- **Le seuil de 4 caractères** évite de massacrer le message avec des remplacements parasites.
- **Le repli `'aucun-detail-disponible'`** garantit qu'on ne journalise jamais une chaîne vide,
  qui serait indiscernable d'une absence d'erreur.

## Son test

```ts
test('expurge toutes les composantes sensibles du diagnostic temporaire', () => {
  const databaseUrl = 'postgresql://postgres.projectref12345678:mot-de-passe@pooler.example.test:5432/postgres';
  const summary = safeDumpDiagnosticSummary({
    stderr: `failed host=pooler.example.test user=postgres.projectref12345678 `
      + `password=mot-de-passe ${databaseUrl} eyJhbGciOiJIUzI1NiJ9.opaque.signature`,
  }, databaseUrl);

  expect(summary).toContain('failed');
  expect(summary).not.toContain('pooler.example.test');
  expect(summary).not.toContain('postgres.projectref12345678');
  expect(summary).not.toContain('mot-de-passe');
  expect(summary).not.toContain('eyJhbGciOiJIUzI1NiJ9');
});
```

Le test est construit correctement : il vérifie à la fois que **le message reste informatif**
(`toContain('failed')`) et que **chaque composante sensible a disparu**. Un test qui ne
vérifierait que le second point laisserait passer une fonction qui renvoie la chaîne vide.

## Si vous l'intégrez un jour

- La replacer dans `scripts/coordinated-backup.mjs`, ajouter sa signature à
  `scripts/coordinated-backup.d.mts`, et son test à `test/coordinated-backup.test.ts`.
- **Ne pas reprendre le reste des branches archivées** : les interrupteurs
  `BACKUP_DIAGNOSTIC_ONLY`, `BACKUP_SAFE_DIAGNOSTIC` et `BACKUP_DOCKER_NETWORK` interrompent la
  sauvegarde par conception.
- Décider explicitement **où** le résultat atterrit. Un journal de CI est public sur un dépôt
  public : l'expurgation est une réduction du risque, pas une garantie. Le plus prudent reste de
  ne journaliser que la catégorie, et de n'activer le détail que le temps d'une investigation.
- Vérifier que la fonction `clean` qu'elle utilise existe toujours dans le module.

## Références

- Étiquettes d'archive : `archive/backup-diagnostics-2026-07-16` (cette fonction),
  `archive/backup-runner-diagnostic-2026-07-16` (classification des échecs, déjà intégrée)
- [`pipeline-release-coordonnee.md`](pipeline-release-coordonnee.md) — la chaîne de release
- [`operations-readiness.md`](operations-readiness.md) — exigences d'exploitation
