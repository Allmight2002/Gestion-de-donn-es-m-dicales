# Preuve de responsabilités et d'exploitation

Le déploiement de production échoue fermé sans le secret d'environnement GitHub
`OPERATIONS_EVIDENCE_JSON`. Le validateur exige une preuve JSON actuelle, valable
au maximum 90 jours et liée au SHA exact du candidat.

La preuve doit référencer, sans stocker de noms ni de coordonnées dans le dépôt :

- un titulaire et un suppléant distincts pour la release, la base, la sécurité,
  la protection des données, la QA clinique, la QA scientifique, le support et
  la direction d'incident ;
- les décisions d'affectation, formations et acceptations de runbooks ;
- une astreinte 24/7, son annuaire protégé, ses autorités de notification, ses
  délais et une simulation réussie datant de moins de 93 jours ;
- la capacité support, le système de tickets, les SLA et l'escalade ;
- une session QA clinique manuelle et une revue scientifique réussies, sans
  constat critique ou élevé ouvert ;
- une revue MFA et moindre privilège datant de moins de 93 jours, sans compte
  privilégié obsolète ni compte sans MFA ;
- les empreintes acceptées des runbooks incident, monitoring, backup,
  restauration, rollback et release.

Contrôle local d'une preuve fournie par les responsables :

```text
npm run operations:evidence:verify -- --file=<preuve.json> --commit=<SHA40>
```

Le validateur contrôle la cohérence et les empreintes, mais ne nomme personne,
ne crée pas l'astreinte et n'approuve pas la QA. Une checklist vide, un document
en projet ou une simulation déclarative ne constitue pas une preuve. B10 reste
donc ouvert jusqu'à production et archivage des affectations, de la simulation,
des revues d'accès et du procès-verbal QA réels.
