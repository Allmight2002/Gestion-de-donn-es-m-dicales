# Supervision opérationnelle

## Portée

Le workflow `.github/workflows/operations-monitor.yml` fournit un contrôle
synthétique toutes les quinze minutes pour `staging` et `production`. Il vérifie :

- le frontend en HTTPS ;
- la santé Supabase Auth ;
- une lecture REST vide soumise aux grants/RLS, sans lire de ligne ;
- la santé Supabase Storage ;
- la santé de `clamd` ;
- la version du moteur, l'âge de la base de signatures et la capacité disponible ;
- un scan de texte fictif sain ;
- la détection de la signature EICAR fictive.

Le moniteur n'utilise jamais `service_role`, ne charge aucune donnée médicale et
n'écrit pas dans l'application. Les preuves JSON masquent les URL, les noms
d'objets, les clés et les réponses brutes.

## Configuration GitHub obligatoire

Créer les environnements GitHub `staging` et `production`. Dans chacun :

- variable `APP_URL` : URL HTTPS canonique du frontend ;
- secrets `SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` ;
- secrets `CLAMAV_SCAN_URL` et `CLAMAV_SCAN_TOKEN`.
- secret `MONITOR_ALERT_WEBHOOK_URL` : destination HTTPS d'alerte, distincte de
  GitHub et gérée par l'exploitation.

L'environnement `staging` exige aussi `VERCEL_TOKEN`, `VERCEL_ORG_ID` et
`VERCEL_PROJECT_ID`. Le workflow les utilise uniquement pour obtenir un cookie
éphémère, HttpOnly et limité au déploiement `APP_URL` exact. La valeur du cookie
n'est ni journalisée ni conservée dans l'artefact ; elle est supprimée même si la
sonde échoue. `APP_URL` doit alors être une URL HTTPS `*.vercel.app`.

`CLAMAV_SCAN_URL` doit se terminer par `/scan`. Le moniteur exige le mode strict
et refuse une clé serveur à la place de la clé publique. Il refuse aussi une base
de signatures de plus de 48 heures, une date future incohérente, une réponse
`VERSION` non interprétable ou un scanner sans emplacement disponible. La limite
est fixée par `MONITOR_MAX_SIGNATURE_AGE_HOURS` dans le workflow et ne doit pas être
augmentée sans acceptation RSSI documentée.

Avant ouverture à des données réelles, lancer manuellement **Operations monitor**,
vérifier les deux jobs et conserver les artefacts. Un environnement non configuré
doit échouer ; il ne faut pas neutraliser le job pour obtenir artificiellement un
statut vert.

## Alertes et réponse

Le script effectue deux tentatives bornées. Après deux échecs, le job GitHub est
rouge et l'artefact identifie le composant, le statut HTTP éventuel et la durée,
sans détail sensible.

Le workflow envoie alors un événement JSON expurgé au webhook obligatoire. Il
ne transmet que l'environnement, la date, le run et les noms/codes bornés des
sondes en échec ; les URL, corps de réponse, clés et détails internes sont exclus.
La livraison de l'alerte ne transforme jamais la sonde en succès. Pour tester le
circuit sans provoquer une panne réelle, lancer manuellement le workflow avec
`alert_test=true` et conserver l'accusé du système destinataire.

| Échec | Réponse immédiate | Condition de reprise |
|---|---|---|
| ClamAV santé, sain ou EICAR | suspendre les nouveaux uploads ; conserver l'inspection stricte | santé, fichier sain et EICAR de nouveau verts |
| Auth ou REST/RLS | suspendre connexions et écritures cliniques | service stable et contrôles d'accès ciblés verts |
| Storage | suspendre uploads et téléchargements | santé Storage et objet fictif de contrôle vérifiés |
| Frontend | annoncer l'indisponibilité, vérifier Vercel et le dernier SHA | frontend et parcours critique verts |

Ne jamais désactiver `require_server_inspection` pour contourner une panne du
scanner. Toute panne pendant une utilisation médicale suit la procédure d'incident
et doit être corrélée aux journaux Supabase/Vercel/ClamAV sans y copier de donnée
patient.

## Limites bloquantes

GitHub Actions n'est pas un service d'uptime garanti : les exécutions planifiées
peuvent être retardées et les notifications dépendent des réglages du compte.
Avant usage clinique, il faut donc encore :

1. désigner un responsable d'astreinte et un suppléant ;
2. configurer une destination d'alerte testée hors GitHub ;
3. définir les heures de couverture et les délais d'accusé/résolution ;
4. centraliser les métriques et journaux avec rétention et accès approuvés ;
5. tester un exercice d'alerte, d'escalade et de suspension ;
6. surveiller l'âge des signatures ClamAV, la capacité et les sauvegardes.

Tant que ces six points ne sont pas prouvés, ce workflow est un contrôle
compensatoire de staging, pas une supervision clinique complète.
