# Preuve de gouvernance d'une release clinique

Le code ne peut ni produire ni remplacer une décision juridique, clinique,
scientifique, éthique, opérationnelle ou de sécurité. Le workflow production
exige donc un manifeste externe dans le secret d'environnement GitHub
`GOVERNANCE_EVIDENCE_JSON`. Il est contrôlé avant toute sauvegarde ou écriture
cloud et doit correspondre exactement au SHA promu.

Le manifeste ne contient pas les documents signés. Il contient uniquement leurs
références, leurs empreintes SHA-256, leurs dates et les décisions `approved`.
Il couvre les huit autorités attendues, les DPA/contrats Supabase, Vercel,
antivirus et messagerie, l'AIPD/DPIA, la résidence, l'incident et la décision sur
les risques résiduels. Les documents originaux restent dans le système documentaire
approuvé avec ses contrôles d'accès et sa rétention.

Contrôle local de forme :

```text
node scripts/validate-governance-evidence.mjs \
  --file=<manifest.json> \
  --commit=<SHA40> \
  --scope=production-complete
```

Le validateur refuse les mentions `projet`, `draft`, `pending`, `TODO` ou
`placeholder`, un manifeste expiré, un autre SHA, un contrat non signé ou une
acceptation de risque autre que `accepted-low-only`.

L'absence actuelle de ce secret est volontairement bloquante. La présence d'un
JSON techniquement valide n'atteste pas l'authenticité des signatures : celle-ci
doit être vérifiée par les autorités compétentes et par les reviewers protégés de
l'environnement `production`.
