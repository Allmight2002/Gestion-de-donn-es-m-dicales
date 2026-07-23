# MedData après le MVP — pertinence stratégique et feuille de route

**Date de l’étude :** 16 juillet 2026

**Périmètre :** Cameroun et Tchad, avec extension éventuelle à l’Afrique francophone subsaharienne

**Audience :** fondateur, responsable produit, direction hospitalière ou partenaire de recherche

**Nature de l’étude :** analyse documentaire interne, recherche externe et recommandation provisoire ; aucune donnée patient réelle n’a été utilisée

**Décision recommandée :** **poursuivre en réduisant le périmètre à un segment précis**, avec un budget d’apprentissage borné et sans expansion avant preuve terrain

> **Légende des preuves**
>
> **Fait vérifié** : soutenu par une source interne explicite ou une source externe primaire/faisant autorité.
>
> **Inférence raisonnable** : conclusion cohérente avec plusieurs faits, mais non observée directement sur le marché cible.
>
> **Hypothèse à tester** : proposition qui doit être confirmée par entretiens, observation, pilote ou engagement financier.
>
> **Information manquante** : donnée nécessaire à une décision plus ferme et non trouvée dans les sources accessibles.

## Résumé exécutif

- **Le problème général est réel, mais l’insuffisance du marché n’est pas démontrée.** Les équipes de santé et de recherche doivent structurer, corriger, suivre et exporter des données longitudinales dans des environnements où les ressources, l’infrastructure et les compétences sont inégales. Le plan camerounais de santé numérique 2020-2024 décrit historiquement des systèmes papier bien ancrés, des outils fragmentés et des contraintes d’équipement, de connectivité et de compétences. Les données 2024 de la Banque mondiale indiquent toutefois des situations nationales très différentes : environ 46 % de la population utilisait Internet au Cameroun contre 13 % au Tchad. Ces données nationales ne prouvent pas la situation d’un hôpital donné. **Elles rendent le besoin plausible, pas l’adoption de MedData certaine.**

- **Un premier signal de demande existe désormais.** Un chef de service de neurochirurgie souhaite travailler avec trois assistants et des étudiants en médecine préparant leurs thèses d’exercice. C’est une preuve plus forte qu’une idée de fondateur, car elle nomme un décideur, une équipe et un workflow potentiel. Elle reste toutefois **un signal dans une seule organisation**, pas encore une preuve d’usage, de budget ni de répétabilité du marché. Elle justifie un pilote de design partnership ; elle ne justifie pas encore un lancement large.

- **Le marché est déjà densément servi.** REDCap couvre la recherche académique, le multi-site, l’audit, les exports et la collecte mobile hors ligne ; DHIS2 Tracker couvre les dossiers individuels longitudinaux, le mobile hors ligne et les programmes de santé à grande échelle ; CommCare, ODK et KoboToolbox sont mûrs pour la collecte mobile ou la gestion de cas en contexte contraint ; OpenClinica, Castor et Medidata servent les essais plus réglementés ; OpenMRS/Bahmni servent le soin et le dossier patient. Le concurrent le plus difficile reste néanmoins souvent **le statu quo Excel/papier**, car il est connu, déjà payé et ne nécessite ni procurement ni changement d’habitudes. **MedData n’a donc pas encore prouvé qu’il est suffisamment meilleur sur un travail critique pour provoquer un changement.**

- **Le meilleur angle provisoire est étroit.** MedData paraît le plus pertinent pour un **service hospitalier universitaire ou centre de recherche qui tient déjà un registre spécialisé mono-site, longitudinal et actif, aujourd’hui géré avec Excel/papier, et qui doit produire régulièrement une cohorte ou un export de recherche traçable**. Les utilisateurs prioritaires sont le data manager ou assistant de recherche et les médecins investigateurs ; le décideur est le responsable de service ou investigateur principal avec la direction de la recherche ; le payeur probable est un budget de projet, une subvention, l’établissement ou un sponsor institutionnel. L’étude clinique réglementée, la surveillance nationale, le programme ONG mobile à grande échelle et le remplacement d’un dossier médical hospitalier ne sont pas des segments d’entrée adaptés.

- **La différenciation la plus crédible est face à Excel, pas face aux EDC établis.** Le modèle patient/registre, la séparation identité–analytique–documents, la correction tracée, les cohortes figées et les exports reproductibles forment une proposition cohérente. Mais beaucoup d’éléments sont une exigence minimale ou peuvent être configurés dans des plateformes existantes. Le hors-ligne de MedData est limité à un instantané analytique et à certaines corrections de rencontres ; il ne couvre pas la création hors ligne du patient, l’identité ou les documents. Le support local francophone et un coût total faible pourraient différencier le produit, mais **ils ne sont pas encore démontrés**.

- **L’état du produit interdit de confondre MVP riche et service prêt à exploiter.** Les documents internes déclarent de nombreuses fonctions implémentées. Un ancien candidat a franchi des contrôles automatisés et neuf parcours navigateur critiques en staging, mais le rapport LOT 13 a conclu « staging non validé ». La matrice de readiness du 16 juillet 2026 indique que le candidat exact n’a pas été déployé en staging, que la production est incohérente entre frontend et backend, et que sauvegardes, supervision, inspection de fichiers, gouvernance, droits privilégiés et validations juridiques/éthiques restent bloquants pour des données réelles. La checklist fonctionnelle est un plan de test, pas une preuve d’exécution.

- **Recommandation principale : poursuivre, mais comme programme de validation de 90 jours, pas comme lancement commercial large.** Recruter des équipes à partir de projets réellement menés, observer six workflows, faire un test comparatif MedData–Excel–REDCap/DHIS2/CommCare sur un même cas, obtenir au moins deux engagements institutionnels précis, puis conduire trois pilotes à données fictives. Un pilote avec données réelles ne peut commencer qu’après un GO juridique, éthique, technique et organisationnel formalisé. L’investissement produit au-delà de ces pilotes doit dépendre de l’activation, de la rétention, de la qualité des données, du coût de support et d’une preuve de budget — pas de déclarations d’intérêt.

- **Choix géographique : le meilleur design partner prime sur un pays choisi sur dossier.** Si le service de neurochirurgie est au Cameroun et satisfait les critères d’engagement, il devient le premier site logique ; s’il est au Tchad, le même raisonnement s’applique. Ne pas lancer deux pays à la fois. La connectivité doit être mesurée au niveau du site. Cette recommandation est opérationnelle, non juridique ; toute interprétation réglementaire doit être validée localement.

## 1. Recommandation principale

### Décision

**Poursuivre en réduisant le périmètre à un segment précis.**

MedData ne doit pas être lancé comme une plateforme générique pour « la recherche clinique en Afrique francophone ». Il doit être testé comme une **solution de registre clinique spécialisé pour équipes hospitalières universitaires**, avec les limites suivantes :

- un seul pays pendant la première validation ;
- un seul cas d’usage d’entrée ;
- trois sites pilotes au maximum ;
- données fictives pendant la phase de preuve produit et opérationnelle ;
- données pseudonymisées/réelles uniquement après toutes les autorisations et preuves requises ;
- aucun investissement d’expansion ou de fonctionnalités avancées avant franchissement des critères de passage.

### Segment et cas d’usage d’entrée

**Segment prioritaire :** service hospitalier universitaire, unité de recherche clinique ou centre de recherche qui tient un registre mono-spécialité longitudinal, avec un investigateur principal et une petite équipe stable. Le premier design partner candidat est le service de neurochirurgie composé d’un chef de service, de trois assistants et d’étudiants en thèse.

**Cas d’usage d’entrée :** construire un registre longitudinal pérenne du service, puis permettre à chaque projet de thèse autorisé d’utiliser une cohorte et un dictionnaire bornés, sans dupliquer le registre ni ouvrir l’identité à tous. Reprendre un registre Excel/papier existant reste le geste d’entrée lorsqu’il existe.

**Ne pas inclure dans le premier pilote :** collecte communautaire massive, surveillance nationale, essai interventionnel réglementé, remplacement du dossier médical de soins, documents bruts complexes, création complète hors ligne, IA d’extraction, déploiement multi-pays.

### Pourquoi cette recommandation

1. **Fait vérifié — adéquation fonctionnelle interne.** Le modèle documenté de MedData couvre le patient longitudinal, les rencontres, les modèles de variables, les imports, les corrections, les cohortes et les exports. C’est une chaîne cohérente pour un registre de recherche.

2. **Fait vérifié — insuffisance de readiness.** Le produit n’est pas démontré prêt pour des données réelles ni pour une exploitation clinique soutenue. L’expansion commerciale serait prématurée.

3. **Fait vérifié — substituts forts.** Plusieurs alternatives disposent déjà d’un hors-ligne plus large, d’un réseau de support, d’une maturité réglementaire ou d’une implantation nationale/régionale.

4. **Inférence raisonnable — fenêtre de différenciation.** Une équipe trop petite pour exploiter REDCap/DHIS2 et trop exigeante pour rester sur Excel peut valoriser un produit plus guidé, centré registre, avec identité séparée, curation et exports reproductibles.

5. **Hypothèse à tester — changement et paiement.** Rien ne prouve encore que cette fenêtre représente assez d’équipes, que leur douleur est prioritaire, qu’elles changeront d’outil ou qu’un payeur financera logiciel, configuration, formation et support.

### Ce qui ferait changer la recommandation

- **Vers une poursuite plus ambitieuse :** au moins trois pilotes activés, deux retenus à 12 semaines, deux engagements budgétaires durables, un temps d’onboarding reproductible et un coût de support compatible avec le prix accepté.
- **Vers un positionnement de service géré :** les équipes paient surtout pour la configuration, la migration et la curation, mais utilisent peu le logiciel en autonomie.
- **Vers une couche au-dessus de REDCap ou DHIS2 :** les établissements refusent une nouvelle plateforme mais demandent le modèle de registre, la gouvernance ou les exports de MedData dans leur socle existant.
- **Vers un pivot de pays :** aucun site camerounais ne satisfait les critères de design partner, tandis qu’un site tchadien apporte engagement, budget, connectivité et gouvernance.
- **Vers l’arrêt :** les équipes cibles jugent leur solution actuelle suffisante, aucun payeur n’engage de budget, ou le coût de support/compliance dépasse durablement la valeur économique obtenue.

## 2. Problème, utilisateurs et décision d’achat

### Problème précis à résoudre

Le problème n’est pas simplement « collecter des données ». Les outils génériques le font déjà. Le problème candidat est :

> **Transformer de façon répétable un registre clinique longitudinal dispersé ou peu gouverné en données de recherche structurées, corrigibles, traçables et exportables, tout en limitant l’exposition de l’identité.**

Cette formulation implique cinq douleurs observables :

- reconstituer l’historique d’un patient à travers plusieurs visites ;
- maintenir un dictionnaire de variables cohérent dans le temps ;
- identifier et corriger les erreurs sans perdre la provenance ;
- donner des accès différents sans dupliquer des fichiers ;
- produire une cohorte et un export dont le contenu et la date sont explicables.

**Information manquante — intensité et fréquence.** Les sources accessibles ne mesurent pas le nombre d’équipes camerounaises ou tchadiennes confrontées à ces douleurs, leur fréquence, le temps perdu, le coût des erreurs, ni les projets retardés. Cette absence empêche toute conclusion de product-market fit ou de taille de marché.

### Utilisateur, bénéficiaire, prescripteur, décideur et payeur

| Rôle économique | Profil prioritaire | Travail ou intérêt | Signal de qualification |
|---|---|---|---|
| Utilisateur quotidien | Data manager, assistant de recherche, résident chargé du registre | Configurer, importer, saisir, corriger, contrôler, exporter | A déjà traité un registre actif dans les 12 derniers mois et peut montrer son workflow |
| Utilisateur expert | Médecin investigateur, responsable scientifique | Définir les variables, valider la cohorte, interpréter l’export | A produit ou prévoit une analyse/publication avec des données longitudinales |
| Bénéficiaire | Équipe de recherche, service, partenaire scientifique ; patients indirectement | Données plus fiables, moins d’exposition inutile, recherche plus reproductible | La valeur est exprimée en délai, qualité ou risque réduit, pas en intérêt abstrait |
| Prescripteur | Chef de service, investigateur principal, directeur de projet | Choisir la méthode et mobiliser l’équipe | Peut imposer un standard de registre au sein du projet |
| Décideur | Direction de la recherche, direction hospitalière, université/centre, parfois DSI et juridique | Autoriser l’outil, l’hébergement et le processus | Accepte de consacrer du personnel et d’ouvrir le circuit de validation |
| Payeur | Budget de recherche, subvention, établissement, université, ONG ou sponsor | Financer onboarding, hébergement, support, formation et conformité | Ligne budgétaire, enveloppe ou procédure d’achat identifiée |

**Inférence raisonnable — l’utilisateur n’est pas le client.** Le médecin peut désirer un meilleur outil sans pouvoir signer ni payer. Toute validation qui ne rencontre que des utilisateurs finaux surestimera la demande.

Dans le design partner de neurochirurgie, les rôles se précisent : le chef de service est propriétaire scientifique et prescripteur ; les trois assistants sont superviseurs, réviseurs ou responsables de sous-cohortes ; les étudiants sont des utilisateurs temporaires dont l’accès doit être limité à leur thèse, avec date d’expiration. Le client à rechercher reste le service, l’hôpital ou l’université. Un modèle vendu étudiant par étudiant créerait beaucoup de support, une faible rétention et une gouvernance fragile.

### Jobs-to-be-done prioritaires

| Job | Résultat recherché | Preuve que le job est critique | Alternative actuelle probable |
|---|---|---|---|
| Créer rapidement un registre | Dictionnaire et formulaire utilisables sans projet informatique long | Dernier projet retardé par le paramétrage ou la coordination | Excel, REDCap, formulaire générique, développement interne |
| Harmoniser et faire évoluer les variables | Même sens et mêmes règles au fil du temps | Incohérences de colonnes, unités ou versions réellement constatées | Dictionnaire Excel, conventions manuelles, EDC |
| Suivre un patient dans le temps | Rattacher les visites au bon sujet sans reconstruction manuelle | Doublons, pertes de suivi ou jointures manuelles lors du dernier export | Excel multi-feuilles, EMR, DHIS2/CommCare/ODK Entities |
| Corriger et curer | Savoir qui a changé quoi, pourquoi et quand | Nettoyage long, erreurs répétées, incapacité à expliquer une valeur | E-mails, commentaires Excel, queries EDC |
| Collaborer sans surexposer l’identité | Limiter les données visibles selon le rôle | Copie de fichiers nominatifs ou accès trop larges observés | Partages de fichiers, droits EDC/EMR configurés |
| Produire une cohorte et un export exploitable | Dataset reproductible, documenté et sans identifiants non prévus | Dernière analyse retardée ou non reproductible | Scripts/Excel, exports EDC, data warehouse |
| Travailler avec une connexion irrégulière | Continuer le travail essentiel puis synchroniser proprement | Dernière coupure ayant interrompu une collecte réelle | Papier, REDCap Mobile, DHIS2 Android, CommCare, ODK/Kobo |
| Démontrer la traçabilité | Répondre à une revue interne, scientifique ou réglementaire | Demande d’audit, de justification ou de correction déjà survenue | Audit EDC, procédures papier, historique de fichiers |

## 3. Hypothèses stratégiques importantes

| # | Hypothèse | État après étude | Preuve disponible | Test décisif |
|---|---|---|---|---|
| H1 | Les registres spécialisés sont un besoin fréquent dans les services hospitaliers cibles | **Premier signal, répétabilité à tester** | Demande exprimée par un chef de service de neurochirurgie avec équipe et thésards ; aucune fréquence inter-services mesurée | Deux autres services indépendants décrivent un workflow comparable et acceptent un test |
| H2 | Excel/papier est l’incumbent dominant | **Hypothèse plausible, non quantifiée** | Le plan camerounais décrit historiquement le poids du papier ; aucune enquête représentative 2026 | Inventaire des outils réellement utilisés sur les 20 derniers projets recrutés |
| H3 | La douleur est suffisante pour changer | **Signal de demande, changement non démontré** | Un décideur a formulé le besoin ; ni ressources réservées, ni budget, ni usage n’ont encore été documentés | Workflow montré, temps d’équipe réservé et lettre d’intention avec conditions de pilote |
| H4 | La séparation identité–analytique–documents est valorisée commercialement | **Hypothèse à tester** | Différenciation interne forte ; les concurrents peuvent aussi configurer des droits et séparations | Choix forcé lors d’un test comparatif et acceptation de la complexité induite |
| H5 | La curation dédiée résout un problème courant | **Hypothèse à tester** | Workflow implémenté ; aucun volume réel ni organisation de curateurs | Trois sites apportent un flux récurrent de documents à structurer et un responsable de curation |
| H6 | Le hors-ligne actuel suffit au segment | **Hypothèse fragile** | Périmètre limité ; concurrence plus complète ; connectivité très faible au Tchad | Observation sur site et scénario de coupure couvrant les tâches critiques |
| H7 | Le français et le support local différencient MedData | **Non démontré** | Interface fr/en ; aucun dispositif de support local, SLA ou réseau de partenaires prouvé | SLA pilote, temps de réponse mesuré et préférence exprimée face au support concurrent |
| H8 | MedData peut être moins coûteux au total | **Information manquante** | Aucun tarif, coût complet, support ou modèle économique interne | Modèle de coût par site puis test de deux offres réelles auprès de payeurs |
| H9 | Cameroun et Tchad peuvent être lancés ensemble | **Hypothèse rejetée pour le post-MVP immédiat** | Contraintes, écosystèmes et circuits juridiques différents ; ressources limitées | Ne reconsidérer qu’après un pilote reproductible dans un pays |
| H10 | L’Afrique francophone est une extension naturelle | **Hypothèse prématurée** | Langue commune partielle ; réglementations, hébergement, budgets et systèmes nationaux varient | Deuxième pays seulement après critères Horizon 2 et partenaire institutionnel local |

## 4. Ce que le produit est réellement aujourd’hui

La présente étude n’a pas relu le code ni refait les validations techniques. Le tableau ci-dessous reflète les documents internes, en donnant priorité au rapport de readiness le plus récent lorsqu’il contredit une présentation plus ancienne.

| Domaine | Fonction envisagée | Déclarée implémentée | Déployée | Réellement validée | Dépendance humaine ou opérationnelle |
|---|---|---|---|---|---|
| Registre patient longitudinal | Patient, données permanentes, rencontres, statuts | Oui, selon cahiers des charges | Anciennes versions en staging ; production présente mais incohérente au 16/07 | Tests locaux/CI et parcours partiels ; candidat exact non validé en staging | Définition clinique, gouvernance du registre, saisie et contrôle |
| Modèles et versions de variables | Types, règles, champs requis, versions publiées | Oui | Partiellement sur les environnements antérieurs | Validation locale documentée ; preuve fonctionnelle complète du candidat absente | Arbitrages scientifiques ; l’édition libre d’une version draft déjà utilisée réduit la reproductibilité stricte |
| Import CSV/XLSX | Mapping, aperçu, conflits, lots, idempotence | Oui | Ancien staging | Scénarios critiques partiels ; pertes de réponse, concurrence et reprise historique à revalider | Préparation/nettoyage du fichier, décision sur doublons et conflits |
| Curation de documents | Soumission, réservation, clarification, finalisation | Oui | Ancien staging | Parcours critiques partiels ; matrice complète non exécutée | Dé-identification, disponibilité et compétence du curateur ; pas de validation indépendante séparée |
| Cohortes et exports | Cohortes dynamiques/figées, CSV/XLSX, dictionnaire, empreinte | Oui | Ancien staging | CSV antérieur ; preuve multi-version/XLSX du candidat absente | Définition de cohorte, revue scientifique, conservation sûre du fichier |
| Séparation et traçabilité | Identité/analytique/documents, permissions, audit | Oui | Déploiements avec drift ; correctifs locaux non déployés | Tests locaux importants ; droits privilégiés distants non conformes au 16/07 | Attribution/revue des accès, réponse aux incidents, administrateur d’infrastructure toujours puissant |
| Hors ligne | Instantané analytique, corrections de rencontres et reprise | Oui, périmètre restreint | État exact du candidat non déployé | Tests locaux ; matrice appareil/staging non prouvée | Appareil de confiance, purge, formation, gestion de conflits ; aucune création patient/identité/document hors ligne |
| Documents et inspection | Upload, URLs signées, quarantaine et antivirus | Oui/partiel selon version documentaire | Scanner staging non pérenne ; production non stricte | Scénarios antérieurs ; readiness non conforme | Hébergement du scanner, supervision, secrets, réponse aux incidents |
| Exploitation et conformité | Comptes, sauvegarde, monitoring, support, dossiers pays | Procédures et modèles présents | Production technique existante mais non cohérente | Readiness production non démontrée ; dossiers juridiques non validés | Responsables nommés, contrats, support, astreinte, formation, autorisations, DPA, éthique |

### Points de vigilance documentaires

- **Fait vérifié — la checklist fonctionnelle n’est pas un résultat.** Elle définit les statuts `OK`, `KO`, `BLOQUE` et `NON TESTE`, mais ne contient pas une exécution complète.
- **Fait vérifié — le rapport LOT 13 n’autorise pas la promotion.** Il conclut « staging non validé » malgré un socle automatisé vert et neuf parcours navigateur critiques réussis sur une version antérieure.
- **Fait vérifié — la readiness du 16 juillet est négative.** Le candidat exact n’est pas déployé en staging et la production mélange un frontend plus récent avec un backend plus ancien.
- **Information manquante — documentation contradictoire.** Les documents internes ne donnent pas tous la même durée d’expiration hors ligne et divergent sur au moins une validation serveur. Le comportement du candidat exact et sa preuve doivent prévaloir avant toute promesse commerciale.
- **Fait vérifié — aucune donnée réelle.** Les dossiers juridiques Cameroun et Tchad sont des projets non validés ; le produit doit rester sur des données fictives tant que chaque gate n’est pas soldé.

## 5. Contexte de marché et réalité régionale

### Le besoin de structuration est crédible

Le [Plan stratégique national de santé numérique du Cameroun 2020-2024](https://files.aho.afro.who.int/afahobckpcontainer/production/files/CIS_PLAN_STRATEGIQUE_DE_SANTE___NUMERIQUE.pdf) documente historiquement des systèmes papier ancrés, un écosystème fragmenté, des outils cliniques verticaux, des limites d’interopérabilité et des contraintes d’équipement, d’électricité, de connectivité et de compétences. Il recensait notamment DHIS2, DAMA, CommCare et des projets OpenMRS/Bahmni. Ce document est utile pour comprendre la structure du problème, mais son inventaire et ses chiffres reposent en partie sur des données plus anciennes ; ils ne décrivent pas à eux seuls le marché 2026.

Au Tchad, le [déploiement national de DHIS2](https://dhis2.org/chad-hmis-transition/) montre qu’une organisation de santé peut déjà disposer d’un socle institutionnel important pour la remontée et le suivi des données. Cela réduit l’hypothèse d’un « désert logiciel » et augmente l’importance de l’intégration ou du positionnement complémentaire.

L’[OMS rappelle](https://www.who.int/publications/i/item/9789241550505/) qu’un outil numérique ne remplace pas un système de santé fonctionnel et que l’acceptabilité, la faisabilité, les ressources et l’équité doivent guider l’investissement. **Implication :** MedData ne doit pas être vendu comme solution à un manque de personnel, de gouvernance, de financement ou de processus scientifique.

### La connectivité impose un choix de site, pas seulement de pays

Selon l’indicateur de la [Banque mondiale/UIT](https://data.worldbank.org/indicator/IT.NET.USER.ZS?locations=CM-TD), la part de la population utilisant Internet en 2024 était d’environ **46 % au Cameroun** et **13 % au Tchad**. Ce sont des valeurs nationales, non des mesures de disponibilité, de prix, de latence ou de fiabilité dans les sites hospitaliers visés.

**Inférence raisonnable :** le Tchad présente un risque de connectivité plus élevé pour une PWA dont le hors-ligne ne couvre pas toutes les tâches. **Hypothèse à tester :** un établissement urbain précis peut néanmoins disposer d’une connectivité et d’une organisation suffisantes. Le recrutement pilote doit donc mesurer le site réel : coupures, débit, électricité, appareils, partage d’appareils, coût de données et règles de sécurité.

### La géographie initiale doit être corrigée

- Le contexte de mission suppose Cameroun et Tchad comme marchés initiaux.
- Le dossier juridique interne désigne le **Tchad comme pays de lancement** et le Cameroun comme ouverture ultérieure.
- Les preuves de demande, de payeur et de design partner sont absentes pour les deux pays.

**Recommandation :** ne pas lancer les deux. Choisir le premier pays par la qualité du design partner. À égalité, privilégier provisoirement le Cameroun pour la première preuve d’usage ; conserver le Tchad comme option conditionnelle à un engagement institutionnel supérieur.

## 6. Paysage des solutions existantes

### Matrice synthétique — 12 alternatives représentatives

Les mentions de coût sont uniquement des prix publics ou des constats « devis/non public ». Les coûts de configuration, migration, hébergement, conformité, formation et support restent à ajouter. « Inconnu » signifie qu’aucune information publique suffisamment précise n’a été trouvée ; cela ne signifie pas que la capacité est absente.

| Solution | Segment principal | Forces | Limites | Hors ligne | Personnalisation | Registre longitudinal | Coût connu | Support régional | Pertinence face à MedData |
|---|---|---|---|---|---|---|---|---|---|
| Papier + Excel | Petites équipes, registres locaux, projets ad hoc | Immédiat, familier, flexible, fonctionne sans réseau, coût marginal souvent déjà absorbé | Versions concurrentes, gouvernance manuelle, erreurs, audit scientifique et droits fins difficiles, exports/cohortes manuels | Oui, sans synchronisation gouvernée | Très forte mais fragile | Possible manuellement | Pas de prix logiciel additionnel si déjà équipé ; TCO humain inconnu | Compétences locales largement disponibles | **Incumbent principal.** MedData doit prouver un gain de temps/qualité supérieur au coût de changement |
| Microsoft/Google Forms, Airtable et bases génériques | Formulaires, enquêtes, petites bases collaboratives | Mise en route rapide, interfaces connues, intégrations bureautiques | Longitudinal, curation, séparation des zones, reproductibilité et conformité dépendent d’assemblages/processus | Variable selon produit et configuration | Forte | Possible mais non toujours native | Tarifs variables et publics selon suite ; non consolidés ici | Support éditeur/partenaires, présence locale variable | Alternative suffisante si le besoin reste un formulaire simple |
| REDCap | Recherche académique et bases/études institutionnelles | Multi-site, audit, exports, logique, personnalisation, français, app mobile hors ligne, large réseau | Licence institutionnelle non open source ; infrastructure et support internes exigés pour l’auto-hébergement ; accès individuel impossible | Oui via app compagnon | Forte | Oui, configurable | Licence et support consortium : 0 USD pour organismes non lucratifs éligibles ; infrastructure/support non gratuits | La carte officielle consultée par le porteur affiche **15 partenaires institutionnels au Cameroun** ; présence au Tchad non établie | **Concurrent direct**, mais 15 partenaires ne signifient ni saturation nationale, ni accès effectif pour chaque service |
| OpenClinica | Études cliniques académiques et réglementées | EDC validé, audit, sites, queries, eConsent/ePRO selon modules, support professionnel | Plus orienté étude/protocole ; complexité et coût potentiellement élevés | Oui pour formulaires configurés via Participate selon documentation actuelle ; périmètre à vérifier | Forte | Oui dans le cadre d’une étude | Devis selon périmètre ; tarif non public | Support 24/5 annoncé ; capacité pays spécifique non vérifiée | Plus pertinent que MedData pour essais réglementés ou sponsorisés |
| Castor EDC | Essais, recherche académique, registres/RWE | EDC validé, audit, rôles, régions d’hébergement, ePRO/eConsent, services | SaaS commercial ; coût et support local non publics ; peut être surdimensionné | Capacité annoncée selon modules/usages ; détail des workflows staff à vérifier | Forte | Oui | Démo/devis ; pas de tarif public fiable trouvé | Couverture mondiale annoncée ; support local Cameroun/Tchad non vérifié | Plus crédible pour conformité réglementaire ; MedData doit gagner sur simplicité/TCO/local |
| Medidata Rave EDC | Essais pharmaceutiques multi-pays | Très mature, audit, changements en cours d’étude, intégration eClinical, échelle | Complexité, procurement et coût probablement disproportionnés pour un petit registre ; prix non public | Information publique insuffisante pour le cas visé | Très forte avec services | Oui | Modèle par site évoqué ; montant non public | Vendor global ; support pays spécifique non vérifié | Peu pertinent au segment d’entrée, mais référence des exigences hautes |
| DHIS2 Tracker | Programmes de santé, registres nationaux/régionaux, surveillance | Open source, longitudinal, Android hors ligne, règles, analyses, API, français, écosystème HISP | Implémentation et gouvernance lourdes ; démarrage sur base vide ; recherche/cohortes scientifiques non centrales par défaut | Oui, Android | Très forte | Oui, natif | Licence 0 ; hébergement/implémentation/formation/support à chiffrer | **Fort** : réseau HISP et déploiements Cameroun/Tchad | Meilleur pour programme institutionnel/national ; MedData doit rester plus simple et spécialisé |
| CommCare | ONG, programmes de terrain, gestion de cas/frontline | Offline-first, cas longitudinaux, multilingue, rôles, synchronisation, provider network | Moins centré sur cohortes scientifiques, versions de dictionnaire et séparation identité/analytique ; fonctions avancées selon plan | Oui, fort | Forte, no-code | Oui, cas | Standard affiché à 100 USD/mois facturé annuellement pour 50 utilisateurs ; autres plans publics | Réseau de prestataires ; usages documentés au Cameroun | Meilleur pour collecte terrain et suivi opérationnel ; concurrent sérieux si le registre est mobile |
| ODK Central + Collect | Recherche de terrain, enquêtes, longitudinal léger à avancé | Open source, Android/web hors ligne, XLSForm, rôles, exports, Entities longitudinales | Form-centric ; curation/cohortes scientifiques à construire ; toutes les Entities peuvent être téléchargées sur les appareils, risque de confidentialité à gérer | Oui, fort | Forte | Oui via Entities | Cloud : 199 USD/mois Standard, 499 USD/mois Professional ; self-host logiciel gratuit + exploitation | Support officiel à distance ; partenaire local non vérifié | Meilleur pour collecte mobile ; MedData meilleur seulement si gouvernance registre/export apporte une valeur prouvée |
| KoboToolbox | Humanitaire, enquêtes, collecte distribuée | Gratuit pour nonprofit sous quota, multilingue, offline, XLSForm, API, options d’hébergement | Principalement projet/formulaire ; longitudinal et curation de registre moins centraux | Oui | Forte | Partiel/assemblage | Nonprofit Community gratuit, 5 000 soumissions/mois et 1 Go ; plans publics payants | Support communautaire/pro ; partenaire local non vérifié | Très forte pression prix pour les besoins simples |
| OpenMRS / Bahmni | Dossier médical et opérations hospitalières | Patient longitudinal de soins, formulaires, modules cliniques ; Bahmni peut être hébergé sur site sans Internet | Déploiement/maintenance lourds ; finalité de soins, pas EDC scientifique ; export/cohorte/curation à adapter | Site local possible ; synchronisation multisite à concevoir | Très forte | Oui | Logiciel open source gratuit ; mise en œuvre/support sur devis | Présence historique documentée au Cameroun ; support à confirmer | Meilleur si le besoin primaire est le soin ou l’intégration hospitalière |
| Développement interne / conservation du processus actuel | Établissement avec équipe IT ou forte inertie | Ajustement exact, contrôle local, aucune migration immédiate | Dette, dépendance aux personnes, maintenance, conformité et pérennité ; le statu quo conserve ses défauts | Dépend du design ; papier toujours disponible | Maximale | Dépend du design | Aucun tarif public ; coût complet souvent non mesuré | Local par définition, capacité variable | Alternative rationnelle si le besoin est rare, le budget nul ou la souveraineté prime |

### Lecture stratégique du paysage

- **Registre académique institutionnel :** REDCap est le benchmark à battre. Sa présence camerounaise est réelle mais ne doit pas être confondue avec une couverture universelle : un partenaire institutionnel peut desservir plusieurs équipes, ou au contraire rester peu accessible hors de son périmètre.
- **Programme de santé et reporting national :** DHIS2 Tracker est souvent le choix naturel, notamment parce que DHIS2 est déjà présent au Cameroun et au Tchad.
- **Collecte terrain et gestion de cas :** CommCare et ODK sont plus crédibles que MedData aujourd’hui sur le hors-ligne complet.
- **Questionnaire/enquête simple :** KoboToolbox et les formulaires génériques sont moins chers et plus rapides.
- **Essai réglementé :** OpenClinica, Castor ou Medidata sont plus adaptés ; REDCap peut aussi être exploité dans un environnement institutionnel validé.
- **Soin clinique :** OpenMRS/Bahmni ou un SIH existant doivent rester la source primaire ; créer une seconde saisie MedData risque d’augmenter la charge.
- **Petit registre spécialisé sans infrastructure de recherche :** c’est la fenêtre plausible de MedData, à condition de démontrer une migration simple, un support concret et un coût acceptable.

## 7. Comparaison approfondie sur les critères de décision

Les évaluations sont qualitatives. Aucun score chiffré n’est attribué, car MedData n’a pas de données d’usage réel, les TCO ne sont pas comparables et plusieurs capacités concurrentes dépendent de la configuration ou du contrat.

| Critère de décision | Importance | MedData | Excel/papier | REDCap | DHIS2 Tracker | CommCare | OpenClinica | Niveau de preuve |
|---|---:|---|---|---|---|---|---|---|
| Délai de création d’un registre mono-site | Élevée | Promesse favorable, non mesurée ; modèles/imports prévus | Immédiat mais fragile | Fort, création rapide annoncée et largement pratiquée | Variable ; configuration et gouvernance plus lourdes | Fort pour app/cas avec builder | Fort avec templates/onboarding, mais processus étude | Moyen : docs officielles ; aucune mesure comparative terrain |
| Modèle patient longitudinal | Élevée | Natif, registre-centré | Manuel, risques de doublons/jointures | Oui, configurable par événements/instruments | Natif Tracker | Natif par cas | Natif par participant/événements d’étude | Élevé pour capacité ; faible pour facilité comparative |
| Versionnement et reproductibilité des variables | Élevée | Versions publiées immuables, mais édition libre d’un draft déjà utilisé = compromis | Très faible sans discipline externe | Fort avec dictionnaire et gouvernance projet | Configurable ; gestion de métadonnées exigeante | Release management à partir du plan Pro ; logique scientifique à organiser | Fort, changements de protocole tracés | Moyen à élevé, surtout sources officielles |
| Séparation identité / analytique / documents | Élevée | Conception explicite et rare ; validation production absente | Manuelle, souvent faible | Configurable par projets/droits ; séparation exacte à concevoir | Configurable par programme/attributs/droits | Dé-identification disponible dans plans avancés ; séparation exacte à concevoir | Données de contact et rôles protégés ; architecture exacte selon configuration | Moyen : très fort en interne pour le design, comparabilité concurrente partielle |
| Curation et provenance des corrections | Élevée si documents sources | Workflow dédié, motif et audit ; curateur finalise seul | E-mails/commentaires/version de fichier | Audit et queries ; workflow configurable | Audit/règles, workflow différent | Data cleaning à partir du plan Pro ; workflow différent | Queries, SDV, audit et rôles de data management | Moyen ; valeur utilisateur MedData non testée |
| Cohorte figée et export scientifique | Élevée | Point fort conceptuel ; preuve candidat XLSX/multi-version absente | Manuel et scripté | Exports vers outils statistiques ; snapshots à gouverner | Analyse/reporting forts ; cohorte scientifique à configurer | Exports/intégrations ; cohorte scientifique non centrale | Exports d’étude et verrouillage robustes | Moyen ; exactitude MedData à revalider |
| Imports depuis Excel existant | Élevée | Mapping, aperçu, conflits et lots documentés ; scénarios réseau incomplets | N/A | Data import possible ; adaptation nécessaire | Import/API possibles ; configuration | Imports/API selon plan | Imports et migration avec services | Moyen ; coûts de migration non connus |
| Hors ligne sur le travail critique | Élevée au Tchad, moyenne/élevée selon site au Cameroun | **Partiel** : lecture analytique et corrections de rencontres ; pas identité/patient/docs | Oui localement, sans sync gouvernée | App mobile hors ligne ; projet préparé sur serveur | Android Tracker hors ligne complet | Offline-first, cas et historique | Formulaires offline conditionnels via Participate ; périmètre à vérifier | Élevé pour le périmètre officiel ; faible sur les tests site-à-site |
| Multi-site et montée en charge | Moyenne au départ, élevée ensuite | Partage par base ; modèle juridique interne prévoit une base par site et des exports entre sites | Faible | Fort, multi-site documenté | Très fort, jusqu’au national | Fort, programmes distribués | Fort, conçu pour sites d’étude | Élevé pour capacités concurrentes ; MedData non testé |
| Rôles, permissions et audit | Élevée | Modèle granulaire ; environnement distant actuel non prêt | Faible à moyen selon suite et discipline | Fort | Fort, configuration complexe | Fort selon plan/configuration | Fort et réglementaire | Élevé sur capacité ; readiness MedData négative |
| Interopérabilité avec SIH/DHIS2/analytique | Moyenne maintenant, élevée ensuite | Imports/exports ; standard FHIR ou intégration nationale non démontrés | Fichiers universels mais sémantique faible | API/FHIR selon environnement | API et intégration native dans l’écosystème | API/OData selon plan | API, EHR-to-EDC selon offre | Moyen ; besoin exact non observé |
| Adéquation essai réglementé | Faible pour le segment d’entrée, décisive si essai | **Non démontrée ; ne pas positionner** | Faible sans système qualité lourd | Possible selon environnement institutionnel validé, pas automatique | Non central | Non central | **Forte**, produit orienté conformité et audit | Élevé : sources officielles et cadre FDA/ICH |
| Support francophone et régional | Élevée | Potentiel, mais aucune organisation/SLA prouvé | Informel/local | Institution/consortium ; présence locale non confirmée | Réseau HISP régional et documentation française | Interface FR, providers mondiaux ; profondeur locale à vérifier | Support vendor 24/5 annoncé ; localité à vérifier | Moyen ; information locale souvent manquante |
| Coût total et prévisibilité | Élevée | **Inconnu** : aucune offre, coût d’exploitation/support/compliance non calculé | Coût apparent bas, coût humain caché | Licence 0 pour nonprofit éligible, mais IT/support local | Licence 0, implémentation potentiellement lourde | Prix public, services additionnels | Devis | Faible à moyen ; aucun TCO comparable |
| Maturité et pérennité | Élevée | Petite équipe et exploitation non structurée | Pérenne comme format/processus, fragile comme système | Très forte communauté institutionnelle | Global public good et réseau HISP | Vendor et base d’usage internationale | Vendor EDC établi | Élevé pour concurrents ; risque MedData interne clair |

**Conclusion comparative :** MedData peut être plus pertinent que les alternatives lorsque l’équipe n’a ni REDCap institutionnel ni programme DHIS2 adapté, que son problème est bien un registre de recherche longitudinal, que la séparation d’identité et les cohortes figées sont prioritaires, et qu’un accompagnement francophone réduit réellement le temps de mise en œuvre. Dans tous les autres cas, un outil existant est probablement plus rationnel.

## 8. Segments et cas d’usage prioritaires

Les appréciations ci-dessous sont des **inférences raisonnables** issues de l’adéquation documentée, de la maturité des alternatives et de la complexité d’achat. Elles devront être remplacées par des preuves terrain.

| Segment | Importance et fréquence du besoin | Solution actuelle probable | Capacité / volonté de payer | Acquisition et cycle | Exigences / support | Adéquation MVP | Potentiel | Décision |
|---|---|---|---|---|---|---|---|---|
| Registre spécialisé mono-site d’un service hospitalier universitaire | Élevées si registre actif et consultations répétées | Excel, papier, base artisanale, parfois REDCap | Moyenne, via projet, subvention ou établissement ; non prouvée | Accès par investigateur ; cycle estimé 2–6 mois | Gouvernance locale, migration, formation, support rapproché | **La plus forte** | Réplication par spécialité et site si onboarding répétable | **Priorité 1** |
| Recherche académique monocentrique à durée limitée | Réelle mais épisodique | REDCap, Kobo/ODK, tableur | Faible à moyenne ; budget lié à l’étude | Cycle 1–4 mois, mais rétention post-étude faible | Éthique, dictionnaire, gel/export | Bonne, mais REDCap est très fort | Faible si chaque étude repart de zéro | Secondaire |
| Réseau de recherche multicentrique | Élevée et récurrente | REDCap, OpenClinica, Castor, DHIS2, développement dédié | Potentiellement élevée | Cycle long, appels d’offres, gouvernance 6–18 mois | Conformité, contrats, support, interopérabilité, administration multi-site | Insuffisamment validée | Élevé mais prématuré | Ensuite, après preuve mono-site |
| Registre de pathologie | Élevée si programme durable | SIH/laboratoire, tableur, registre national, REDCap | Institutionnelle ou programme | Cycle long, multiples directions | Terminologies, biologie, doublons, intégration laboratoire | Partielle | Élevé si une spécialité répétable émerge | Plus tard |
| Projet universitaire sans data manager dédié | Besoin réel mais capacité d’exécution faible | Excel/Kobo, assistance ad hoc | Faible | Achat court ou inexistant | Support et configuration très intensifs | Fonctionnellement possible, économiquement risqué | Faible sans offre mutualisée | Ne pas cibler seul |
| Programme d’ONG / collecte communautaire | Souvent élevé | CommCare, DHIS2, ODK, Kobo | Budget programme possible | Procurement et bailleur, 4–12 mois | Offline-first, flotte mobile, localisation, support terrain | Faible à moyenne | Élevé, mais alternatives mieux placées | Ne pas cibler maintenant |
| Étude clinique réglementée | Critique et financé | OpenClinica, Castor, Medidata, environnement REDCap validé | Élevée | Très long, qualification fournisseur | Système qualité, validation, conformité ICH/FDA et sponsor | **Non démontrée** | Théorique mais coûteux | Exclure |
| Surveillance épidémiologique / programme national | Critique et récurrent | DHIS2 Tracker, outils ministériels | Institutionnelle / bailleurs | Très long, politique et partenarial | Échelle, intégration nationale, support décentralisé | Faible | Important mais hors avantage actuel | Exclure |
| Dossier de soins hospitalier | Quotidien | SIH, OpenMRS/Bahmni, papier | Institutionnelle | Très long, intégration forte | Disponibilité clinique, pharmacie/labo/facturation | **Hors catégorie** | Important mais divergent | Exclure |

### Segment prioritaire et critères d’éligibilité

Un design partner prioritaire doit réunir **tous** les critères suivants :

1. registre longitudinal réellement actif au cours des douze derniers mois ;
2. au moins une centaine de dossiers ou un flux régulier justifiant la structuration ;
3. corrections, rapprochements ou exports effectués plusieurs fois par an ;
4. investigateur ou chef de service disponible pour décider ;
5. data manager, assistant de recherche ou personne explicitement responsable des données ;
6. possibilité de montrer le workflow et des exemples strictement fictifs ou vidés de toute donnée sensible ;
7. budget, ligne de financement ou procédure d’achat identifiable ;
8. accord pour mesurer le temps, les erreurs, le support et l’usage pendant le pilote.

La spécialité médicale ne doit pas être choisie par intuition. Elle doit émerger des entretiens selon la récurrence des visites, la fréquence des exports, la stabilité du dictionnaire, le nombre de sites comparables et la présence d’un champion.

### Cas d’entrée désormais disponible : neurochirurgie et thèses d’exercice

Le service de neurochirurgie répond déjà à trois conditions rares : un décideur médical identifié, trois assistants capables d’encadrer la qualité et un flux renouvelé d’étudiants ayant un projet de recherche concret. Ce cas permet de tester une proposition plus précise que « faire un registre » :

> **Maintenir une mémoire longitudinale commune du service, puis ouvrir à chaque thèse une vue de recherche bornée, reproductible et supervisée.**

Cette organisation peut produire un effet cumulatif : les données ne disparaissent pas à la soutenance, les variables communes sont réutilisées et le chef de service garde le contrôle scientifique. Elle introduit aussi un risque majeur : les étudiants sont temporaires et n’ont pas tous besoin de l’identité, des documents ou de l’ensemble du registre. Le modèle d’accès actuel par base doit donc être testé avec attention ; un accès trop large rendrait le pilote inacceptable, tandis qu’une base séparée par étudiant recréerait la fragmentation d’Excel.

Le premier pilote doit être considéré comme **un design partnership**, non comme une preuve de marché. Pour démontrer la répétabilité, il faudra ensuite trouver deux autres services ayant une structure comparable — chef de service, petite équipe de superviseurs, thèses ou publications récurrentes — sans exiger qu’ils soient en neurochirurgie.

### Jobs-to-be-done prioritaires

| Travail à accomplir | Résultat recherché | Alternative habituelle | Critère de supériorité à démontrer |
|---|---|---|---|
| Créer ou reprendre rapidement un registre | Dictionnaire commun et première version utilisable | Excel, REDCap, Kobo/ODK | Moins de jours calendaires et moins d’assistance sans perdre le contrôle |
| Harmoniser les variables et leurs versions | Données comparables dans le temps | Dictionnaire Excel, formulaire figé | Changement compréhensible, migration explicite, export reproductible |
| Enregistrer et corriger les visites | Données complètes et erreurs résolues | Papier puis double saisie, tableur | Moins d’erreurs et de temps de correction |
| Collaborer sans exposer inutilement l’identité | Chaque rôle voit le minimum nécessaire | Fichier partagé, droits génériques | Séparation réellement comprise et respectée dans les tâches courantes |
| Constituer une cohorte | Population explicite, figée et réutilisable | Filtres Excel ou script ponctuel | Cohorte plus rapide à produire et à reproduire |
| Exporter pour l’analyse | Fichier correct et documenté au premier essai | Nettoyage manuel | Taux de réussite et temps de préparation supérieurs |
| Continuer malgré une coupure | Travail critique non perdu et reprise sûre | Papier/local, outils offline-first | Périmètre hors ligne suffisant pour le workflow réel — non établi aujourd’hui |
| Démontrer la traçabilité | Savoir qui a changé quoi et pourquoi | E-mails, versions de fichiers | Preuve accessible sans effort administratif disproportionné |

## 9. Proposition de valeur et positionnement

### Fonctionnalités à ajouter ou compléter pour le service de neurochirurgie

La demande ne justifie pas une longue liste de fonctions de neurochirurgie codées en dur. Elle justifie surtout une **couche de projets supervisés au-dessus d’un registre longitudinal commun**. Plusieurs briques sont déjà documentées comme présentes — registre patient/rencontres, rôles nommés, import Excel, gabarit Neuro, complétude, cohortes, exports, journal d’activité. Il faut d’abord les éprouver, puis combler les écarts suivants.

| Classement | Fonctionnalité / résultat utilisateur | État documentaire | Pourquoi pour ce cas | Preuve avant généralisation |
|---|---|---|---|---|
| **Maintenant** | **Espace de thèse ou sous-projet** rattaché au registre : titre, question, promoteur, étudiant, dates, protocole, variables autorisées, critères d’inclusion/exclusion, statut | Nouvelle couche produit | Évite une base par étudiant tout en bornant chaque travail | Le chef et deux assistants arrivent à créer trois projets fictifs sans ambiguïté |
| **Maintenant** | **Accès étudiant limité et expirant** : uniquement le sous-projet/la cohorte autorisée ; identité et documents exclus par défaut ; révocation automatique après soutenance ou départ | Les rôles nommés existent, mais le périmètre fin par sous-projet et l’expiration ne sont pas démontrés | Condition de confiance et de gouvernance ; réduit le risque lié à la rotation des étudiants | Test de tâches montrant que l’étudiant ne voit que ce qui est nécessaire et que le chef comprend les droits |
| **Maintenant** | **Cohorte demandée puis approuvée** par un superviseur, figée pour la thèse, avec motif, version et journal | Cohortes/exports existent ; workflow d’approbation à compléter | Rend la population d’étude explicable et empêche un export improvisé du registre entier | Trois cohortes fictives reproduites à l’identique par deux personnes |
| **Maintenant** | **Export pseudonymisé “prêt pour la thèse”** avec données, codebook, version de cohorte, date et règles de codage ; autorisation de téléchargement distincte | Export et dictionnaire partiellement documentés ; exactitude du candidat à valider | C’est le livrable concret attendu par l’étudiant et le superviseur | Export contrôlé sur un jeu fictif, sans identifiant inattendu et utilisable dans R/SPSS/Stata via CSV correctement typé |
| **Maintenant** | **Affectation des dossiers à compléter et demandes de correction** à un assistant ou étudiant, avec superviseur et échéance | File “à compléter” v1 présente ; affectation et notification non livrées | Transforme la qualité en travail d’équipe mesurable | Délai de correction inférieur au processus actuel et moins de relances hors outil |
| **Ensuite** | **Plan de suivi longitudinal** : prochaine visite attendue, retard, perdu de vue, motif de clôture | Rappels de suivi dans la réserve d’idées, non livrés | La valeur d’un registre de service vient du suivi, pas seulement de l’inclusion | Le workflow réel montre que les assistants organisent effectivement les rappels et peuvent agir dessus |
| **Ensuite** | **Cycle de vie des étudiants** : invitation en lot, charte/formation, date d’expiration, transfert du projet au superviseur, archivage après soutenance | Non documenté comme complet | Réduit l’administration annuelle et évite les comptes orphelins | Une promotion fictive est onboardée et clôturée sans intervention technique |
| **Ensuite** | **Tableau de bord chef de service** : inclusions, suivis dus, complétude, corrections, avancement par thèse, exports récents | Plusieurs métriques existent séparément | Le décideur doit voir la valeur sans saisir tous les jours | Utilisation spontanée lors d’une réunion de service et décisions prises à partir du tableau |
| **Ensuite** | **Duplication contrôlée d’une rencontre antérieure** et champs calculés configurables pour scores validés | Idées A1/A3 non livrées | Peut accélérer les suivis et réduire les erreurs répétitives | Gain de temps mesuré ; validation scientifique des formules et droits d’usage des échelles |
| **Plus tard** | Bibliothèque de modèles de registre et de thèse par spécialité, validés localement | Bibliothèque/gabarit Neuro déjà livrés en première version | Accélère le deuxième et troisième service | Au moins deux sites demandent le même noyau de variables |
| **À ne pas faire sans preuve** | Création complète hors ligne, mode tournée, interopérabilité SIH, flowchart STROBE, IA documentaire | Certaines briques envisagées seulement | Effort important et risques supplémentaires | Besoin observé dans au moins deux sites, budget ou gain critique documenté |

Les éléments cliniques de neurochirurgie — diagnostic, intervention, imagerie, complications, réinterventions, suivi fonctionnel et scores — doivent être **des variables configurables dans un gabarit validé par le service**, pas des fonctions rigides du logiciel. Les échelles cliniques et classifications éventuelles doivent être validées quant à leur pertinence, leur version et leurs droits d’utilisation avant diffusion.

### Positionnement de catégorie : élargir sans dissimuler l’usage

Présenter le socle comme une « plateforme de gestion de données longitudinales » peut être cohérent sur le plan produit, car le modèle registre–entité–événements est réutilisable. Ce changement ne doit toutefois pas être utilisé pour contourner les règles applicables aux données de santé. **Le contenu réellement traité et la finalité réelle prévalent sur le nom du produit.** Une base de neurochirurgie reste une base de données de santé, même si le logiciel est générique. Toute interprétation doit être validée par un professionnel compétent dans le pays concerné.

La stratégie recommandée est à deux niveaux :

- **catégorie de socle :** plateforme configurable de registres longitudinaux ;
- **offre d’entrée explicite :** registres de service et projets de recherche clinique supervisés.

Le périmètre contractuel et l’interface doivent indiquer clairement : outil de recherche et de registre, **pas** dossier médical de soins, diagnostic, recommandation thérapeutique ni dispositif d’aide à la décision. Cette limitation peut clarifier l’usage prévu ; elle ne supprime ni la protection des données personnelles, ni l’éthique de la recherche, ni les responsabilités d’hébergement et d’accès.

Un repositionnement immédiatement “tous secteurs” n’est pas recommandé. Il placerait MedData face à Airtable, Salesforce, ODK et d’innombrables bases génériques, tout en diluant son avantage actuel. Valider d’abord la verticale hospitalo-universitaire ; décider d’une marque ou d’un socle non médical seulement après qu’un second domaine non médical a exprimé un besoin et un budget comparables.

### Phrase à tester — non validée

> « Pour les services hospitaliers universitaires francophones qui construisent des registres et supervisent des projets de recherche ou des thèses, MedData est une plateforme de registre longitudinal qui maintient une base commune, ouvre à chaque projet une cohorte bornée et produit des exports reproductibles. Contrairement à des fichiers séparés par étudiant, MedData conserve la mémoire du service, limite les accès et trace les corrections et les exports. »

Cette phrase est une **hypothèse à tester**, pas une promesse validée. Elle évite de prétendre que MedData est meilleur que REDCap ou DHIS2 avant mesure comparative.

### Quand MedData peut gagner — et quand il doit céder la place

| Situation | Choix probablement rationnel | Pourquoi |
|---|---|---|
| Registre spécialisé actif, Excel fragile, visites répétées, data manager, exports scientifiques réguliers | **MedData à tester** | Chaîne registre–curation–cohorte–export cohérente et séparation d’identité explicite |
| Université disposant déjà d’une équipe REDCap réactive | REDCap | Coût de changement inutile, maturité et communauté institutionnelle |
| Programme national ou reporting sanitaire multi-niveaux | DHIS2 Tracker | Échelle, écosystème, gouvernance et intégration programme |
| Collecte communautaire hors ligne ou flotte Android | CommCare ou ODK | Hors-ligne plus complet et expérience terrain mature |
| Questionnaire ponctuel à faible budget | KoboToolbox ou formulaire générique | Rapidité, gratuité ou coût faible |
| Essai réglementé ou sponsor international | OpenClinica, Castor, Medidata ou socle qualifié par le sponsor | Validation, conformité et processus sponsor |
| Besoin primaire de soin et de dossier patient | SIH, OpenMRS/Bahmni | Continuité clinique et intégrations hospitalières |
| Registre rare, simple et sans conséquence notable | Rester sur le processus actuel | Le coût du changement dépasse probablement le bénéfice |

## 10. Forces, faiblesses et défendabilité de MedData

| Élément | Valeur potentielle | Qualification stratégique | Preuve disponible / manque |
|---|---|---|---|
| Modèle centré registre et patient longitudinal | Bonne lisibilité pour une équipe de registre | Avantage utile, facilement copiable | Conception interne vérifiée ; facilité non testée |
| Séparation identité, analytique et documents | Réduit l’exposition et clarifie les responsabilités | Potentiellement forte face à Excel ; configurable chez certains concurrents | Architecture documentée ; exploitation réelle et valeur d’achat non prouvées |
| Curation avec motifs et provenance | Peut réduire les corrections informelles | Différenciation de workflow, mais ajoute une charge | Fonction décrite ; temps gagné ou qualité améliorée inconnus |
| Modèles et versions de variables | Favorise la comparabilité | Avantage utile ; parité fréquente avec les EDC | Implémenté selon les documents ; compromis sur les brouillons à observer |
| Cohortes figées et exports scientifiques | Travail directement utile au chercheur | Fort face à Excel ; parité avec des EDC matures | Concept cohérent ; exactitude du candidat et gain de temps à démontrer |
| Imports avec aperçu et conflits | Réduit le coût de migration | Avantage d’entrée si fiable | Parcours documenté ; cas réseau et diversité des fichiers non validés |
| Hors-ligne | Important dans les sites contraints | **Faiblesse actuelle**, pas différenciation | Périmètre partiel et preuves staging incomplètes |
| Simplicité d’usage | Pourrait réduire la formation | Hypothèse marketing | Aucun benchmark ni usage réel |
| Coût total | Pourrait être inférieur aux services EDC | Hypothèse économique | Prix, marge, support et TCO absents |
| Accompagnement local et francophone | Pourrait être décisif | Potentiellement défendable par l’exécution, non par le logiciel | Équipe, couverture, SLA et capacité non établis |
| Permissions, audit, chiffrement, sauvegarde | Nécessaires à la confiance | **Exigences minimales**, pas avantage commercial en soi | Plusieurs éléments existent ; readiness opérationnelle non acquise |
| Petite équipe produit | Décisions rapides | Risque de dépendance et de pérennité | Organisation de support et continuité manquantes |

### Diagnostic SWOT condensé

- **Forces :** cohérence du parcours registre longitudinal ; cloisonnement explicite ; curation, cohortes et exports conçus ensemble ; interface bilingue documentée.
- **Faiblesses :** readiness non démontrée ; hors-ligne incomplet ; modèle économique, support et conformité opérationnelle non structurés ; aucune preuve d’usage ni de paiement.
- **Opportunités :** équipes de registres trop petites pour administrer une plateforme complexe ; services hospitaliers sans REDCap institutionnel ; besoin d’accompagnement francophone de proximité.
- **Menaces :** gratuité apparente d’Excel/Kobo/REDCap/DHIS2 ; maturité de CommCare/ODK ; procurement hospitalier long ; intégration au travail clinique ; financement par projet ; dépendance à une petite équipe.

**Conclusion :** la défendabilité ne viendra probablement pas d’une fonction isolée. Elle devrait venir d’un système d’exécution : configuration rapide d’un type de registre précis, migration maîtrisée, support francophone, gouvernance prête à l’emploi et preuves d’amélioration mesurable. Ce système n’existe pas encore comme capacité reproductible.

## 11. Frictions et risques d’adoption

| Risque | Impact / probabilité | Signal dans les preuves | Réduction ou test |
|---|---|---|---|
| Paramétrage initial plus long que prévu | Élevé / élevée | Large éventail de fonctions et gouvernance | Chronométrer dictionnaire, rôles, import et publication sur trois cas réels fictivisés |
| Migration depuis Excel/papier | Élevé / élevée | Formats hétérogènes, doublons, champs libres probables | Profilage de fichiers fictivisés, offre de migration bornée, journal des exceptions |
| Double saisie avec le dossier de soins | Élevé / élevée | MedData n’est pas un SIH | Observer le parcours complet ; arrêter si aucune source fiable n’évite la double saisie |
| Résistance et retour à Excel | Élevé / élevée | Statu quo familier et immédiat | Mesurer l’usage sans rappels et la rétention à 8/12 semaines |
| Formation et compréhension des rôles | Élevé / moyenne | Modèle riche de permissions/curation | Test de tâches par rôle ; onboarding court ; vérification de compréhension |
| Support trop intensif | Élevé / élevée | Aucun dispositif de support éprouvé | Journaler chaque minute ; seuil de 2 h/site/semaine à la semaine 8 |
| Administrateur local absent | Élevé / moyenne | Gouvernance des accès et modèles nécessaire | Exiger un propriétaire de registre et un suppléant dans la lettre d’intention |
| Connectivité insuffisante | Élevé / variable | Écart national Cameroun/Tchad ; hors-ligne MedData partiel | Mesure sur site, scénario de coupure et critères minimum avant pilote |
| Méfiance envers l’hébergement ou résidence | Élevé / moyenne | Documents juridiques encore non validés | Cartographie des données, options d’hébergement et validation juridique locale |
| Non-conformité ou gouvernance incomplète | Critique / élevée avant GO | Checklists pays ouvertes | Données fictives par défaut ; gate formel juridique, éthique, technique et organisationnel |
| Maintenance et dépendance à l’équipe | Élevé / moyenne | Produit jeune, exploitation non industrialisée | Plan de continuité, documentation, SLA réaliste, coût complet |
| Budget par projet et procurement long | Élevé / élevée | Payeur et prix inconnus | Identifier ligne budgétaire, signataire, calendrier et offre testable avant pilote |
| Mauvaise qualité malgré le logiciel | Élevé / moyenne | La curation suppose du temps humain | Mesurer complétude, erreurs critiques et délai de résolution face au baseline |
| Intégration insuffisante | Moyen à élevé / moyenne | FHIR/SIH/DHIS2 non démontrés | Ne construire qu’une intégration demandée par au moins deux pilotes qualifiés |

## 12. Programme de validation terrain

### Échantillon et recrutement

Conduire **16 à 18 entretiens en deux vagues**, volume soutenable pour une petite équipe mais suffisamment contradictoire :

- dans le service de neurochirurgie : le chef, les 3 assistants, 3 à 5 étudiants ou jeunes médecins ayant récemment soutenu, plus le responsable institutionnel qui autorise ou finance l’outil ;
- hors du service : 2 à 3 chefs de service ou responsables de registre comparables, 2 personnes chargées des données, 2 payeurs/décideurs, et au moins 2 contradicteurs ;
- parmi les contradicteurs : au moins un utilisateur camerounais de REDCap et une équipe satisfaite de son processus actuel.

La première vague qualifie le service de neurochirurgie et les principaux contre-exemples. La seconde cible les questions ambiguës apparues. Recruter sur la base d’un projet mené dans les douze derniers mois, pas sur un intérêt déclaré pour l’innovation. Le chef et ses collaborateurs comptent comme **une seule organisation** : leur nombre ne doit pas être présenté comme autant de preuves de marché indépendantes.

### Guide d’entretien non orienté

1. « Racontez-moi le dernier registre ou projet de données cliniques que vous avez réellement mené, du premier formulaire au dernier export. »
2. « Montrez-moi, avec un exemple fictif ou nettoyé, les outils, fichiers et passages de relais réellement utilisés. »
3. « Quelle a été la dernière erreur importante, donnée manquante ou correction ? Comment l’avez-vous découverte et résolue ? »
4. « Lors du dernier changement de variable ou formulaire, qu’avez-vous dû modifier et qui a décidé ? »
5. « Combien de temps a pris le dernier import, nettoyage ou export ? Qui y a travaillé ? »
6. « Que s’est-il passé lors de la dernière coupure de réseau ou indisponibilité d’un outil ? »
7. « Qui peut voir l’identité, les données de recherche et les documents ? Comment ces droits sont-ils revus ? »
8. « Quel outil avez-vous déjà évalué ou rejeté ? Pour quelle raison concrète ? »
9. « Quel budget a été dépensé la dernière fois : logiciel, personnel, consultant, hébergement, formation et support ? »
10. « Qui initie, approuve, finance, signe et administre un nouvel outil ? Quel a été le délai du dernier achat comparable ? »
11. « Qu’est-ce qui vous ferait conserver le processus actuel malgré ses défauts ? »
12. « Si ce problème devait rester inchangé un an, quelle conséquence mesurable aurait-il ? »
13. « Pour la dernière thèse encadrée, comment le sujet, les variables, les dossiers accessibles et la population analysée ont-ils été décidés ? »
14. « Après la soutenance, qu’est-il arrivé au fichier, aux corrections et aux données qui auraient pu servir à un autre travail ? »
15. « Montrez-moi comment un étudiant obtient aujourd’hui l’autorisation d’accéder aux dossiers et comment cet accès est retiré. »

Ne pas demander « utiliseriez-vous MedData ? ». Demander à la fin si l’organisation accepte une étape coûteuse : fournir un workflow fictivisé, nommer un champion, réserver du temps, identifier un budget ou signer une lettre d’intention conditionnelle.

### Observation et test comparatif

Observer au moins **six workflows complets** : création du dictionnaire, premier dossier, visite suivante, correction, attribution d’un projet de thèse, cohorte, export et clôture de l’accès étudiant. Utiliser le même mini-registre fictif sur MedData et sur l’alternative réelle du site — Excel, REDCap, DHIS2 ou CommCare — puis mesurer :

- temps actif et temps calendaire ;
- nombre d’interventions de support ;
- erreurs, champs manquants et ambiguïtés ;
- compréhension des droits et de la provenance ;
- réussite de l’export au premier essai ;
- comportement pendant une coupure simulée ;
- intention de continuer matérialisée par un engagement, non une opinion.

Une supériorité utile signifie **au moins 30 % d’amélioration sur un résultat critique choisi avant le test**, sans dégrader la qualité, la confidentialité ni le coût total. Ce seuil est provisoire : il sert à éviter d’investir pour un gain marginal.

### Pilote par étapes

1. **Découverte** — entretiens et observation, aucune donnée réelle.
2. **Configuration assistée** — registre et import entièrement fictifs ; comparaison avec l’outil en place.
3. **Pilote fantôme de 6 à 8 semaines** — données fictives générées, ou données rendues non personnelles selon validation compétente ; trois sites maximum.
4. **Pilote opérationnel limité** — seulement après autorisations juridiques/éthiques, candidat technique cohérent, restauration testée, supervision, support et responsabilités documentés.

### Volonté de payer et engagements

Calculer d’abord un **coût plancher complet** : infrastructure, onboarding, migration, formation, support, exploitation, conformité, déplacement et acquisition. Présenter ensuite deux offres concrètes — coût plancher et coût plus marge/risque — avec périmètre et SLA explicites. Demander au payeur quelle ligne budgétaire, quel signataire et quelle procédure permettraient un bon de commande, puis proposer un acompte remboursable ou un engagement budgétaire conditionnel lorsque le cadre le permet.

Une lettre d’intention utile doit nommer : site, cas d’usage, champion, data manager, date cible, ressources réservées, fourchette budgétaire, autorisations requises, KPI, conditions de conversion et motifs de retrait. Une lettre vague sans temps, budget ou décisionnaire ne constitue pas une preuve de marché.

### Critères de falsification avant investissement supplémentaire

| Hypothèse | Preuve minimale provisoire | Modifier, pivoter ou arrêter si… |
|---|---|---|
| Le problème est fréquent et coûteux | 8 équipes qualifiées sur 12 décrivent un incident ou coût récurrent et fournissent un exemple | Moins de 8/12 ont une douleur récurrente, ou moins de 4 montrent un workflow/artifact fictivisé |
| Le segment veut changer | 3 design partners réservent du temps et nomment les responsables | L’intérêt ne produit aucun engagement opérationnel |
| Un payeur existe | 2 organisations identifient budget, signataire et calendrier | Aucun payeur ne peut nommer une ligne ou procédure réaliste |
| La proposition est supérieure | Gain ≥30 % sur au moins un travail critique, sans recul de qualité | MedData est seulement équivalent ou exige plus de support que l’alternative |
| Le pilote s’active | ≥75 % des sites atteignent la définition d’activation à J14 | Activation <75 % malgré accompagnement |
| L’usage persiste | Au moins 2 sites sur 3 actifs à S8 et S12 | 0 ou 1 site retenu, ou usage maintenu uniquement par relances |
| Le support est soutenable | ≤2 h/site/semaine à S8 hors incident majeur | Charge reste >2 h et ne diminue pas |
| La voie vers les données réelles existe | Gate juridique, éthique, technique et opérationnel documenté | Aucun chemin crédible vers un GO dans le pays choisi |

## 13. KPI post-MVP

Les cibles sont des **seuils provisoires de pilote**, pas des benchmarks sectoriels. Elles doivent être figées avant le test puis révisées avec le baseline du service. Les événements produit ne suffisent pas : le journal d’onboarding, le support, les contrôles d’exports et les décisions institutionnelles sont aussi des sources.

| KPI | Définition et calcul | Source future | Fréquence | Cible provisoire | Limite d’interprétation | Décision éclairée |
|---|---|---|---|---|---|---|
| Sites/équipes pilotes actifs | Site ayant réalisé une action de valeur dans les 28 derniers jours : saisie/correction, revue, cohorte ou export | Journal d’activité + registre pilotes | Hebdo | 3 lancés, ≥2 actifs à S8 et S12 | Petit nombre ; cadence clinique variable | Continuer ou arrêter le pilote |
| Délai de création du premier registre | Médiane entre réception des entrées complètes et publication d’une version utilisable | Journal onboarding | Par site | ≤5 jours ouvrés ; sous-test accompagné ≤1 h à partir d’un fichier propre | Dépend du nettoyage et des arbitrages scientifiques | Productiser l’onboarding |
| Délai au premier dossier correct | Temps de travail actif entre accès utilisateur et premier dossier fictif valide, contrôlé | Événements + observation | Par utilisateur/site | Médiane ≤2 h de travail actif | Un dossier simple ne prédit pas la maîtrise | Repérer la friction d’entrée |
| Taux d’activation site | Sites ayant sous 14 j : registre publié, ≥2 rôles actifs, ≥10 dossiers fictifs ou un import, et un export contrôlé / sites lancés | Produit + checklist pilote | Hebdo à J14 | ≥75 % | Seuil favorisé par l’accompagnement | Qualité du ciblage et de l’onboarding |
| Utilisateurs actifs par rôle | Utilisateurs ayant accompli une action de valeur / utilisateurs éligibles, ventilés chef, assistant, étudiant | Journal d’activité | Hebdo/mensuel | ≥1 assistant actif/semaine/site ; ≥50 % des utilisateurs éligibles actifs/mois | Étudiants et chefs n’ont pas la même cadence | Ajuster rôles et formation |
| Rétention des équipes | Sites activés ayant encore une action de valeur à S8 et S12 / sites activés | Produit + registre pilote | S8, S12 | ≥2 sites sur 3 | Le projet de thèse peut être saisonnier | Décider de productiser |
| Fréquence d’utilisation | Semaines avec action de valeur / semaines où le workflow devait avoir lieu | Produit + calendrier du service | Hebdo | ≥75 % des semaines éligibles | Ne pas pénaliser un service sans activité prévue | Ancrage dans le travail réel |
| Complétude et qualité | Champs requis correctement renseignés / champs attendus ; erreurs critiques par contrôle d’échantillon | Vue de complétude + revue manuelle | Hebdo/mensuel | ≥95 % requis ; 0 fuite d’identité ou erreur critique d’export | La complétude ne mesure pas la véracité | Valeur scientifique et sécurité du workflow |
| Temps de correction/curation | Médiane ouverture d’une demande → résolution validée | Journal de changement/curation | Hebdo | ≥30 % plus rapide que le baseline ou ≤2 jours ouvrés pour cas courant | Complexité des corrections hétérogène | Valeur du workflow d’équipe |
| Réussite imports/exports | Opérations terminées sans intervention technique / tentatives ; plus contrôle du contenu | Journaux + fiche de contrôle | Par opération/mensuel | ≥95 % de réussite ; 100 % des exports échantillonnés corrects | Un succès technique n’assure pas la bonne interprétation | Fiabilité et support |
| Projets de thèse correctement bornés | Projets avec promoteur, variables/cohorte, autorisation et date d’expiration / projets créés | Espace de thèse + revue | Mensuel | 100 % | Peut devenir une formalité mal comprise | Gouvernance du cas d’usage |
| Volume de support par site | Heures onboarding + tickets + appels / site actif / semaine | Journal de support | Hebdo | ≤2 h/site/semaine à S8, puis trajectoire vers <4 h/mois à M3 | Le fondateur peut sous-déclarer son temps | Soutenabilité et prix |
| Satisfaction / recommandation vérifiée | Score d’effort de tâche 1–5 + acceptation d’être référent auprès d’un pair | Enquête de tâche + entretien | Après tâche/fin pilote | Médiane ≥4/5 et ≥2 recommandations vérifiables | Biais de complaisance fort | Qualité perçue et bouche-à-oreille |
| Conversion pilote → engagement | Pilotes avec contrat, renouvellement ou LOI budgétée sous 30 j / pilotes éligibles | Documents commerciaux | Fin pilote | ≥2 sur 3, dont ≥1 engagement financier | Une LOI n’est pas un revenu | Preuve de payeur |
| Coût d’acquisition et d’accompagnement | Temps et dépenses entièrement chargés jusqu’au site actif puis par mois de support | Journal temps + comptabilité | Mensuel/cohorte | Mesurer d’abord ; aucune cible ferme avant 5 clients | Forte volatilité au démarrage | Fixer prix, canal et capacité |

### Instrumentation minimale avant le pilote

Définir un dictionnaire des événements de valeur, exclure les comptes de démonstration, enregistrer les rôles sans données sensibles, horodater onboarding/support et tenir une fiche de contrôle pour chaque import/export. Le tableau de bord KPI doit permettre de revenir à la source ; aucun chiffre agrégé ne doit être accepté sans pouvoir expliquer son numérateur, son dénominateur et ses exclusions.

## 14. Feuille de route post-MVP par résultats

L’effort est indicatif : **S** = quelques jours, **M** = plusieurs semaines de produit et d’opérations, **L** = initiative pluridisciplinaire ou calendrier externe. Il ne remplace pas une estimation technique. L’ordre est piloté par la preuve recherchée, pas par la richesse fonctionnelle.

### Horizon 0 — Décider et préparer le pilote — maintenant

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| Design partner qualifié | Neurochirurgie | Formaliser le problème, les rôles, les thèses passées, le workflow et les ressources du service | Artefacts fictivisés, temps réservé, décideur et payeur identifiés | Entretiens, engagement | Maintenant P0 | S | Disponibilité de l’équipe | Demande de politesse | Lettre d’intention détaillée signée |
| Pays et site d’entrée décidés | Premier service | Mesurer connectivité, équipements, circuit d’autorisation et budget du site ; choisir un seul pays | Site viable, pas une moyenne nationale | Gate site | Maintenant P0 | S | Accès au site | Débat géographique abstrait | Décision écrite à J30 |
| Cas thèse correctement modélisé | Neurochirurgie | Cartographier chef, assistants, étudiants, cohortes, exports et fin d’accès ; prototype papier des écrans | Les cinq rôles comprennent la même règle d’accès | Réussite tâches | Maintenant P0 | M | Entretiens et données fictives | Complexité excessive | 80 % des tâches critiques réussies sans explication du concepteur |
| Backlog minimal figé | Neurochirurgie | Séparer configuration, fonctions existantes à valider et quatre lacunes essentielles du §9 | Aucun développement hors hypothèse critique | Délai/effort | Maintenant P0 | S | Cartographie | Réouverture d’une roadmap générique | Charte de périmètre approuvée |
| Alternatives testées honnêtement | Neurochirurgie + contradicteurs | Comparer le même registre fictif sur MedData, Excel et REDCap accessible ou autre outil du site | Gain mesuré sur tâche critique | Temps, erreurs, support | Maintenant P0 | M | Accès alternative | Benchmark défavorable ignoré | Rapport comparatif avec décision explicite |
| Gates de pilote fictif fermées | Produit/opérations | Préparer release cohérente, sauvegarde/restauration, supervision, support, responsabilités et règles de données | Pilote exploitable sans donnée réelle | Checklist gate | Maintenant P0 | M–L | Budget et responsables | Confondre staging et service | Gate fictif signé ; sinon pas de pilote |
| Prix testable défini | Payeurs | Calculer coût plancher complet et deux offres avec périmètre/SLA | Réaction à une décision budgétaire réelle | Payeurs nommés | Maintenant P1 | S | Journal de coûts | Prix arbitraire | Deux payeurs instruisent l’offre |

### Horizon 1 — Valider l’usage réel — ensuite

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| Registre fictif utilisé en équipe | Neurochirurgie | Pilote fantôme 6–8 semaines : chef, assistants, étudiants, registre commun et trois thèses fictives | Usage sans relances permanentes | Activation, fréquence, rétention | Ensuite P0 | M | H0 au vert | Démo sans routine | Activation ≥75 %, puis site actif à S8 |
| Accès étudiants démontré sûr et compréhensible | Neurochirurgie | Livrer/tester espace de thèse, cohorte bornée, expiration et exclusion d’identité par défaut | Aucun accès excessif ; révocation comprise | Projets bornés, incidents | Ensuite P0 | M | Prototype validé | Modèle de permission trop complexe | 100 % des scénarios d’accès réussis |
| Valeur scientifique tangible | Neurochirurgie | Produire une cohorte fictive figée, un codebook et un export par projet | Superviseur peut reproduire l’export | Qualité export, temps | Ensuite P0 | M | Données fictives cohérentes | Export techniquement correct mais inutilisable | Trois packs de thèse contrôlés et reproductibles |
| Travail de qualité réparti | Neurochirurgie | Affecter complétude/corrections, observer les délais et supprimer les contournements WhatsApp/Excel | Délai et charge inférieurs au baseline | Correction, support | Ensuite P1 | M | Affectation/notifications minimales | L’outil ajoute une file sans supprimer l’ancienne | ≥30 % de gain sans double processus |
| Répétabilité inter-services testée | 2 autres services | Refaire découverte et mini-prototype sans copier les variables neuro | Même besoin structurel dans un autre contexte | Entretiens, activation | Ensuite P0 | M | Accès partenaires | Cas unique au champion initial | Deuxième service qualifié et un troisième intéressé |
| Volonté de payer objectivée | Direction/université/projets | Présenter offre et demander circuit de commande/engagement | Budget, signataire, calendrier | Conversion | Ensuite P0 | S–M | Coût connu | Service enthousiaste sans payeur | ≥2 payeurs identifiés, ≥1 LOI budgétée |
| Voie vers données réelles clarifiée | Pays choisi | Faire valider professionnellement cadre, responsabilités, hébergement, éthique et procédures | Chemin de GO réaliste | Gate juridique | Ensuite P0 | L externe | Conseil/autorités/établissement | Nom générique utilisé comme contournement | Avis écrit et plan de conformité finançable |

### Horizon 2 — Productiser — plus tard

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| Onboarding répétable | Services universitaires | Kit d’import, modèle de registre/service, modèle de thèse, formation chef/assistant/étudiant | Un relais local onboarde sans fondateur | Délai, support | Plus tard P0 | M | 2 pilotes réussis | Service déguisé non scalable | Un site autonome et support <4 h/mois |
| Offre économique soutenable | Établissements/projets | Contrat site annuel ou projet, niveaux de support, coût étudiant marginal inclus | Marge après support/compliance | Conversion, CAC/TCO | Plus tard P0 | M | Coûts sur 3 pilotes | Prix trop élevé ou sous-tarifé | Premier engagement payé et marge plausible |
| Exploitation reproductible | Sites autorisés | Procédures, continuité, sauvegardes, supervision, support, formation et revue d’accès | Service stable et responsabilités non dépendantes d’une personne | Incidents, RPO/RTO, support | Plus tard P0 | L | Budget/équipe | Dépendance au fondateur | Readiness prouvée et suppléance testée |
| Noyau de spécialité réutilisable | Services comparables | Productiser seulement les variables et workflows communs observés | Temps de configuration diminue | Délai registre | Plus tard P1 | M | ≥2 sites comparables | Modèle trop local | ≥60 % du gabarit réutilisé sans forcer le site |
| Une intégration justifiée | Institutions | Construire une passerelle SIH/DHIS2 ou export statistique seulement si deux sites demandent la même | Double saisie ou travail manuel réduit | Temps, erreurs | Plus tard P2 | L | Partenaires techniques | Projet d’intégration absorbant | Deux engagements et propriétaire de l’intégration |

### Horizon 3 — Étendre — à ne pas faire sans preuve supplémentaire

| Résultat attendu | Segment | Initiative | Preuve recherchée | KPI | Priorité | Effort | Dépendances | Risque | Critère de passage |
|---|---|---|---|---|---|---|---|---|---|
| 5–10 sites du même segment | Pays initial | Répliquer le playbook par réseaux universitaires/sociétés savantes | Acquisition et onboarding reproductibles | CAC, activation, rétention | À prouver | L | H2 validé | Expansion masque faible rétention | Cohorte de 5 sites avec économie soutenable |
| Deuxième pays | Même segment | Partenaire local, validation juridique, hébergement et support adaptés | Résultats du premier pays reproduits | KPI H1/H2 | À prouver | L | PMF pays 1 | Multi-pays prématuré | Deux design partners et budget local |
| Marque/socle non médical | Domaine longitudinal non santé | Étude séparée de besoin, concurrence et conformité ; aucun simple renommage | Un cas non médical paie pour le même noyau | Conversion/TCO | À prouver | L | Demande externe réelle | Dilution face aux outils génériques | Deux clients non médicaux indépendants |
| Fonctionnalités avancées | Sites actifs | Offline étendu, mode tournée, IA, analytics avancée uniquement sur preuve répétée | Valeur mesurée, budget | Usage feature | À prouver | M–L | Besoin ≥2 sites | Parité concurrentielle sans valeur | Seuil et sponsor définis avant construction |

### Ce qui est explicitement hors roadmap sans preuve

- certification pour essais réglementés ;
- remplacement d’un SIH ou usage pour le soin direct ;
- surveillance nationale ou collecte communautaire de masse ;
- création hors ligne de l’identité et des documents uniquement pour afficher une parité ;
- IA d’extraction ou de recommandation ;
- expansion multi-pays simultanée ;
- généralisation non médicale destinée à éviter le régime des données réellement traitées.

## 15. Décisions et actions dans les 30 prochains jours

Le déploiement n’est pas rayé : il est **requalifié en déploiement pilote borné**, d’abord avec données fictives et mesures explicites. Le but des 30 jours est de transformer la demande orale du service en engagement et en protocole de preuve.

| Échéance | Action | Livrable de décision | Responsable pressenti | Go si… |
|---|---|---|---|---|
| J1–J7 | Atelier séparé avec chef, assistants et 2–3 étudiants sur les deux dernières thèses et le registre souhaité | Carte du workflow, rôles, données nécessaires, alternatives et douleurs quantifiées | Fondateur + chef de service | Exemples concrets et temps réservé |
| J1–J10 | Formaliser la lettre d’intention design partner | Cas, personnes, calendrier, ressources, budget, KPI, données fictives, conditions de retrait | Chef + établissement | Champion, assistants et décideur institutionnel nommés |
| J7–J14 | Prototyper sans développement l’espace de thèse, la cohorte bornée et la fin d’accès | Prototype testé sur cinq tâches | Produit + équipe du service | ≥80 % des tâches comprises sans guidage du concepteur |
| J10–J21 | Monter le même mini-registre fictif dans Excel et, si accessible, REDCap | Mesure comparative temps/erreurs/support | Produit + utilisateur contradicteur | Critère critique et seuil définis avant test |
| J14–J25 | Calculer coût plancher et identifier payeur/procurement | Deux offres pilote et circuit de décision | Fondateur + direction/projet | Budget ou procédure réaliste nommé |
| J1–J25 | Établir le gate pays/site et la voie juridique avec conseil compétent | Décision pays, hébergement et limites d’usage | Établissement + professionnel compétent | Aucun contournement par simple renommage ; chemin finançable |
| J26–J30 | Revue go/no-go | Décision : pilote, reconfiguration, pivot ou pause | Fondateur + design partner | Seuils H0 atteints et périmètre signé |

### Cinq décisions à prendre

1. **Accepter le service de neurochirurgie comme design partner prioritaire**, sous réserve d’une lettre d’intention détaillée, et non comme preuve suffisante de marché.
2. **Adopter “registre de service + projets de recherche/thèses supervisés” comme cas d’entrée**, avec vente au site et accès étudiant délégué.
3. **Limiter le premier lot fonctionnel** à l’espace de thèse, l’accès borné/expirant, l’approbation de cohorte/export et l’affectation qualité ; configurer les variables neurochirurgicales plutôt que les coder.
4. **Choisir le pays par le site engagé** et conserver un pilotage à données fictives jusqu’au GO complet.
5. **Garder la catégorie “données longitudinales” comme architecture de socle**, sans la vendre comme moyen d’échapper aux obligations liées aux données de santé.

## 16. Éléments qui justifieraient un pivot ou un arrêt

### Pivots possibles

| Signal terrain | Pivot recommandé | Ce qui ne doit pas être conclu trop vite |
|---|---|---|
| Le service valorise surtout la construction du dictionnaire, la migration et la préparation des cohortes | Offre de **service géré** appuyée sur MedData | Ne pas prétendre que le SaaS est autonome |
| Le site dispose d’un REDCap utilisable mais manque d’accompagnement, de modèle de thèse ou de gouvernance | Couche de service/méthode au-dessus de REDCap, ou abandon du remplacement | Ne pas reconstruire REDCap par principe |
| Les étudiants adorent l’outil mais aucun site ne paie | Offre institutionnelle/universitaire subventionnée, pas vente individuelle | L’usage étudiant ne prouve pas un modèle économique |
| La résidence locale est exigée et financée | Hébergement local/partenaire, après étude distincte de coût et d’exploitation | Un hébergement local n’est pas automatiquement sûr ou soutenable |
| La tâche dominante se passe au lit du malade sans réseau | Reprioriser le vrai offline et le mode tournée, si au moins deux sites le confirment | Ne pas détourner MedData en dossier de soins |
| Un domaine non médical apporte deux demandes et budgets indépendants | Étude de verticalisation et éventuellement marque de socle séparée | Ne pas généraliser sur une seule opportunité |

### Seuils d’arrêt ou de suspension

Suspendre l’investissement au-delà du pilote si l’un des constats suivants persiste après une itération corrective bornée :

- le chef de service ne réserve ni temps d’équipe, ni responsable, ni accès au workflow ;
- aucun deuxième service ne présente un problème comparable ;
- aucun payeur ne nomme budget, signataire et calendrier ;
- MedData n’améliore pas d’au moins 30 % un résultat critique face au processus réellement utilisé ;
- les étudiants nécessitent un accès à toute la base ou à l’identité pour accomplir leur travail, sans justification et gouvernance acceptables ;
- l’activation reste sous 75 %, la rétention sous 2 sites sur 3, ou le support au-dessus de 2 h/site/semaine à S8 ;
- aucun chemin juridique, éthique, d’hébergement et d’exploitation finançable ne permet un usage réel ;
- le coût complet par site dépasse durablement le prix accepté, sans modèle de financement tiers crédible.

Arrêter le produit — et non seulement un pays ou un segment — si deux cycles de validation indépendants ne trouvent ni douleur prioritaire, ni usage répété, ni payeur, et si les pivots de service ou de couche sur outil existant ne produisent pas non plus d’engagement.

## 17. Incertitudes et informations manquantes

| Information manquante | Pourquoi elle compte | Comment la lever |
|---|---|---|
| Pays et établissement exacts du service demandeur | Détermine connectivité, cadre, payeur et alternative accessible | Qualification du design partner à J7 |
| Registre neurochirurgical existant, volume et cadence | Distingue besoin actif d’une intention | Observer les deux derniers projets et un fichier fictivisé |
| Nombre annuel de thèses et chevauchement des sujets | Détermine la valeur du modèle de sous-projet | Historique 3 ans du service |
| Accès réel des équipes aux 15 partenaires REDCap du Cameroun | Présence institutionnelle ≠ disponibilité pour le service | Entretien avec un utilisateur/admin local et test d’éligibilité du site |
| Sens exact du chiffre REDCap “15” | La carte compte des partenaires institutionnels actifs, pas nécessairement installations ou sites utilisateurs | Capturer la carte officielle datée et, si nécessaire, demander confirmation avant publication externe |
| Temps perdu et erreurs avec Excel/papier | Base du ROI | Chronométrage, incidents passés, coût humain |
| Budget et procédure d’achat | Condition de marché | Entretien avec payeur et offre testable |
| Valeur perçue de l’espace de thèse et des accès bornés | Cœur du nouveau positionnement | Prototype et choix forcé face à une base par étudiant |
| Charge de support liée aux étudiants | Peut rendre le modèle non soutenable | Journal du pilote par rôle |
| Exigences de résidence, éthique et autorisations | Peut invalider l’exploitation | Avis officiel/professionnel dans le pays choisi |
| Coût complet d’exploitation et continuité d’équipe | Détermine prix et confiance | Modèle de coût, plan de suppléance et pilote |
| Répétabilité hors neurochirurgie | Distingue verticalité viable et projet sur mesure | Deux services indépendants avec même structure de besoin |

## 18. Sources, méthode et qualité des preuves

**Date de consultation des sources externes : 16 juillet 2026.** Les pages éditeurs décrivent les capacités et prix annoncés ; elles sont potentiellement biaisées et ne démontrent pas l’efficacité sur le terrain. Les prix peuvent évoluer. Les sources juridiques servent à identifier le corpus, pas à fournir un avis de droit : toute interprétation doit être validée par un professionnel compétent et, selon le cas, par l’établissement, le comité d’éthique et l’autorité concernée.

### Sources internes principales

- [README du projet](../README.md) — présentation fonctionnelle ; les rapports de validation plus récents prévalent en cas de conflit.
- [Cahier des charges métier](cahier-des-charges-metier.md), [cahier des charges technique](cahier-des-charges-technique.md) et [architecture](architecture.md) — produit envisagé et modèle documenté.
- [Checklist fonctionnelle](checklist-fonctionnalites-site.md) — plan de test, non preuve d’exécution.
- [Readiness production du 16 juillet 2026](readiness-production-2026-07-16.md), [validation staging LOT 13](validation-staging-lot-13-2026-07-13.md) et [validation de restauration staging](validation-restauration-staging-2026-07-14.md) — état de preuve le plus récent.
- [Déploiement](deploiement.md), documents juridiques et checklists GO/NO-GO Cameroun/Tchad — procédures projet, non avis validés.
- [Réserve d’idées fonctionnelles](idees-fonctionnalites-futures.md) — utilisée pour distinguer ce qui existe, ce qui est partiel et ce qui reste une idée.
- Les deux autres versions de travail, [étude Claude](strategie-produit-post-mvp-claude.md) et [synthèse d’arbitrage](strategie-produit-post-mvp-synthese.md), ont été lues intégralement. Le présent document reprend leurs convergences, corrige leurs divergences avec le nouveau signal terrain et ne conserve pas leurs affirmations externes non suffisamment vérifiées.

### Contexte régional et institutionnel

- [Banque mondiale/UIT — individus utilisant Internet, Cameroun et Tchad](https://data.worldbank.org/indicator/IT.NET.USER.ZS?locations=CM-TD) — données 2024 ; ne mesure pas la connectivité d’un hôpital.
- [Plan stratégique national de santé numérique du Cameroun 2020–2024](https://files.aho.afro.who.int/afahobckpcontainer/production/files/CIS_PLAN_STRATEGIQUE_DE_SANTE___NUMERIQUE.pdf) — source officielle historique, inventaire non supposé actuel en 2026.
- [OMS — recommandations sur les interventions numériques pour le renforcement des systèmes de santé](https://www.who.int/publications/i/item/9789241550505/) — cadre institutionnel.
- [Revue systématique des obstacles à l’adoption des dossiers électroniques en Afrique](https://pubmed.ncbi.nlm.nih.gov/37308185/) et [revue des systèmes de données de santé en Afrique subsaharienne](https://pubmed.ncbi.nlm.nih.gov/32602368/) — preuves générales, non spécifiques au segment MedData.

### REDCap

- [Site officiel et carte du consortium](https://projectredcap.org/) — la carte interactive a été consultée par le porteur et affichait 15 partenaires institutionnels au Cameroun ; ce détail n’est pas exposé dans le texte indexé. Le site affichait par ailleurs environ 8 350 partenaires dans 166 pays au moment de la recherche.
- [Fonctions REDCap](https://projectredcap.org/software/), [application mobile hors ligne](https://projectredcap.org/software/mobile-app/), [conditions d’adhésion](https://projectredcap.org/join/) et [FAQ officielle](https://projectredcap.org/about/faq/) — sources éditeur ; licence gratuite pour organismes non lucratifs éligibles, mais infrastructure et support à la charge de l’institution pour l’auto-hébergement.
- [REDCap Consortium, article de référence](https://pmc.ncbi.nlm.nih.gov/articles/PMC7254481/) — quatre partenaires camerounais en décembre 2018, chiffre historique et non contradictoire avec la carte actuelle.
- [Implémentation de REDCap au Cameroun](https://pmc.ncbi.nlm.nih.gov/articles/PMC6790220/) — preuve d’usage longitudinal local et de contraintes de réseau/hébergement ; un projet ne représente pas tout le pays.
- [REDCap dans les pays à revenu faible ou intermédiaire, revue 2025](https://pubmed.ncbi.nlm.nih.gov/40499167/) — source indépendante sur opportunités et limites.

### Plateformes de programmes, collecte et cas longitudinaux

- DHIS2 : [Tracker](https://dhis2.org/fr/tracker/), [Android hors ligne](https://dhis2.org/fr/android/), [licence/téléchargement](https://dhis2.org/downloads/), [hébergement](https://dhis2.org/hosting/), [support HISP](https://dhis2.org/support/) et [transition du Tchad](https://dhis2.org/chad-hmis-transition/) — sources officielles/éditeur.
- ODK : [site et prix](https://getodk.org/), [démarrage/hors ligne](https://docs.getodk.org/getting-started/), [Entities longitudinales](https://docs.getodk.org/central-entities/) et [auto-hébergement](https://docs.getodk.org/central-install/) — sources éditeur.
- KoboToolbox : [tarifs et capacités](https://www.kobotoolbox.org/pricing/) — source éditeur, offres à revérifier lors de l’achat.
- CommCare : [présentation](https://dimagi.com/commcare/), [usage recherche](https://dimagi.com/commcare/use-cases/research/) et [tarifs](https://dimagi.com/commcare-pricing/) — source éditeur, support local à vérifier.

### EDC, registres et systèmes hospitaliers

- OpenClinica : [tarification sur devis](https://www.openclinica.com/pricing/) et [collecte hors ligne documentée](https://docs.openclinica.com/oc4/participate/using-offline-data-capture/) — source éditeur ; disponibilité de modules à confirmer contractuellement.
- Castor : [EDC et hébergement](https://www.castoredc.com/electronic-data-capture-system/) et [présentation de l’entreprise](https://www.castoredc.com/about-castor/) — source éditeur, tarif public fiable non trouvé.
- Medidata Rave : [fiche officielle Rave EDC](https://www.medidata.com/wp-content/uploads/2021/10/Rave-EDC-Fact-sheet-211020.pdf) — source éditeur, référence essais multi-sites ; prix non public.
- [Bahmni](https://www.bahmni.org/), [installation Bahmni](https://www.bahmni.org/install) et [OpenMRS](https://openmrs.org/) — sources officielles open source ; coûts de mise en œuvre/support non inclus.

### Corpus juridique et recherche réglementée

- [Cameroun — loi n° 2024/017 du 23 décembre 2024, PDF officiel](https://www.prc.cm/files/2b/9f/21/1055fa3c2251b4c4248fd301f584daaf.pdf).
- [Tchad — décret officiel ANSICE citant la loi n° 007/PR/2015](https://ansice.td/assets/documents/DECRET_079.pdf).
- [ICH E6(R3), version finale](https://database.ich.org/sites/default/files/ICH_E6%28R3%29_Step4_FinalGuideline_2025_0106.pdf) et [FDA — systèmes électroniques dans les investigations cliniques](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/electronic-systems-electronic-records-and-electronic-signatures-clinical-investigations-questions) — sources faisant autorité pour expliquer pourquoi les essais réglementés ne sont pas un segment d’entrée.

### Évaluation de la qualité des preuves

- **Élevée :** état interne le plus récent, fonctions officielles des solutions, prix publics, nombre historique de partenaires REDCap, corpus officiel.
- **Moyenne :** comparaison d’adéquation entre outils, car elle dépend fortement de la configuration, du contrat et du support local.
- **Faible à ce stade :** taille du segment, intensité de la douleur, volonté de payer, TCO de MedData, préférence pays et valeur des nouvelles fonctions.
- **Signal primaire nouveau :** demande du chef de service de neurochirurgie et composition de l’équipe, rapportées par le porteur le 16 juillet 2026. Ce signal doit être documenté par entretien et engagement ; il n’est pas encore une observation d’usage.

## Ce que nous savons

- MedData documente déjà un registre longitudinal, des rôles, un import Excel, des gabarits, la complétude, des cohortes et des exports ; il ne part donc pas d’une page blanche pour le cas neurochirurgie.
- Un chef de service de neurochirurgie a exprimé une demande impliquant trois assistants et des étudiants en thèse. Cela établit un **design partner candidat**, pas encore un marché ni un revenu.
- Les trois études convergent sur le même segment d’entrée : registre spécialisé mono-site d’un service hospitalier/universitaire, face d’abord à Excel/papier.
- REDCap est réellement présent au Cameroun. La carte officielle afficherait 15 partenaires institutionnels au moment de la consultation ; ce chiffre ne signifie ni quinze installations accessibles à tous, ni une saturation du pays.
- La meilleure fonction nouvelle pour ce cas est une couche de thèses/projets supervisés au-dessus d’un registre commun, avec accès borné et export reproductible ; créer une base indépendante par étudiant reproduirait la fragmentation actuelle.
- Renommer la catégorie ne change pas la nature des données traitées. Une plateforme générique utilisée pour des données de neurochirurgie reste soumise au cadre applicable à cet usage.
- La readiness pour données réelles n’est pas démontrée ; le déploiement immédiat raisonnable est un pilote fictif borné, pas une mise en production clinique ouverte.

## Ce que nous supposons encore

- Que le service montrera un workflow actif, réservera du temps et obtiendra un accord institutionnel plutôt que de rester au stade de l’intérêt verbal.
- Que les assistants et étudiants accepteront un registre commun et des accès plus disciplinés que leurs fichiers actuels.
- Que l’espace de thèse, la cohorte approuvée et l’export versionné apporteront un gain assez important pour changer les pratiques.
- Qu’au moins deux autres services présentent une structure de besoin comparable, condition d’un produit répétable plutôt que d’un développement sur mesure.
- Qu’un payeur institutionnel, universitaire ou de projet financera l’onboarding, l’exploitation et le support ; la vente individuelle aux étudiants n’est pas supposée viable.
- Que le site choisi dispose d’une connectivité suffisante pour le périmètre hors ligne actuel, ou que le workflow peut attendre une connexion.
- Que l’hébergement, la gouvernance et les autorisations nécessaires pourront être rendus acceptables et finançables sans utiliser un positionnement générique comme contournement.

## Ce que nous devons décider maintenant

| Décision | Recommandation | Conséquence d’un report |
|---|---|---|
| Faire du service de neurochirurgie le design partner n°1 | **Oui, sous lettre d’intention détaillée et pilote fictif mesuré** | La demande concrète reste une anecdote et le développement continue sans preuve |
| Adopter le cas “registre de service + thèses supervisées” | **Oui ; vendre au service, pas à l’étudiant** | Le ciblage reste générique et les rôles temporaires ne sont pas correctement conçus |
| Prioriser quatre écarts produit | **Espace de thèse, accès borné/expirant, approbation cohorte-export, affectation qualité** | Risque de construire des fonctions cliniques spécialisées alors que le principal problème est la gouvernance de collaboration |
| Maintenir le déploiement sous forme de pilote borné | **Oui, données fictives d’abord ; pays choisi par la qualité du site** | Soit l’équipe s’immobilise inutilement, soit elle expose trop tôt des données réelles |
| Positionner le socle comme longitudinal sans chercher à éluder le cadre santé | **Oui à l’architecture générique, non au contournement réglementaire ; conserver une offre d’entrée hospitalo-universitaire explicite** | Dilution face aux outils génériques, perte de confiance et risque juridique découvert trop tard |
