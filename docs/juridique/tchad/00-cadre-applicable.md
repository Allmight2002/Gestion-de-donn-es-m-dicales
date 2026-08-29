# 00 — Étude du cadre juridique applicable à MedData au Tchad

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider par conseil juridique tchadien** |
| Rédaction | Équipe projet MedData (assistance automatisée, sources citées §8) |
| Validations requises | Conseil juridique ; porteur du projet ; établissement de rattachement |

---

## 1. Objet et méthode

Ce document identifie les textes applicables au lancement du registre clinique MedData
au **Tchad**, qualifie juridiquement le produit et ses acteurs, et en déduit la
stratégie de mise en conformité. Il fonde tous les autres documents du volet. Méthode :
lecture croisée du produit tel que réellement construit
([architecture.md](../../architecture.md),
[cahier-des-charges-metier.md](../../cahier-des-charges-metier.md)) et des textes
tchadiens et internationaux recensés §3, complétée par les référentiels des
sous-traitants (Supabase, Vercel).

**Limite assumée.** Le texte intégral de la loi n° 007/PR/2015 et du décret
n° 075/PR/2019 n'est pas librement accessible en ligne : les régimes exacts
(déclaration vs autorisation, transferts, délais de notification) cités ici proviennent
de sources secondaires et **doivent être vérifiés sur les textes officiels** — se les
procurer auprès de l'ANSICE ou du Journal officiel est la **première tâche** de la
revue juridique (étape 2 du circuit).

## 2. Qualification juridique de MedData

### 2.1 Nature du traitement

MedData est une plateforme de **registre de recherche clinique**. Trois qualifications
cumulatives :

1. **Traitement de données à caractère personnel** au sens de la loi n° 007/PR/2015
   (toute information relative à une personne identifiée ou identifiable). La
   **pseudonymisation n'est pas une anonymisation** : la zone analytique reste liée à
   la zone identité par la paire `(base_id, patient_code)` et demeure des données
   personnelles, comme la zone identité elle-même.
2. **Traitement de données sensibles** : données de santé (antécédents, diagnostics,
   variables cliniques, images). L'ANSICE est habilitée à préciser par règlement les
   catégories de données sensibles et leurs garanties ; le régime le plus exigeant
   (autorisation préalable) doit être présumé pour un registre de santé
   `[à confirmer sur le texte et auprès de l'ANSICE]`.
3. **Recherche en santé sur données humaines**. À la différence du Cameroun (loi
   n° 2022/008), il n'a pas été identifié de loi tchadienne spécifique encadrant la
   recherche médicale `[existence d'un texte à vérifier par le conseil]` :
   l'encadrement repose sur l'évaluation éthique du **Comité National de Bioéthique du
   Tchad (CNBT)**, l'autorisation du ministère en charge de la santé publique, et les
   standards internationaux (Déclaration d'Helsinki rév. 2024, CIOMS 2016), que le
   présent dossier applique intégralement.

### 2.2 Cartographie des données par zone (état réel du produit)

| Zone | Contenu | Qualification | Particularités |
|---|---|---|---|
| Identité | Nom, date de naissance exacte, téléphone, adresse, images cliniques | Données directement identifiantes + données de santé (images) | Jamais exportée ; accès restreint `can_view_identity` ; journalisée |
| Analytique | Variables cliniques structurées, âge calculé (jamais la date de naissance) | Données de santé **pseudonymisées** | Exportable sans identité (liste blanche serveur) |
| Documents bruts | Documents source dé-identifiés en attente de structuration | Données de santé pseudonymisées ; risque résiduel de ré-identification par le contenu | Jamais exportés ; accès limité au curateur affecté |
| Comptes & journaux | Identité professionnelle des utilisateurs, `audit_log`, `field_change_log`, `export_log` | Données personnelles des professionnels | Nécessaires à la sécurité et à l'imputabilité |

### 2.3 Acteurs et responsabilités

| Acteur | Rôle juridique | Observations |
|---|---|---|
| `[À COMPLÉTER : établissement tchadien de rattachement ou, à défaut, Dr Raymond Mbassi]` | **Responsable du traitement** | Détermine finalités et moyens. Recommandation §6 : adosser le registre à un établissement tchadien |
| Médecins utilisateurs (propriétaires ou invités d'une base) | Personnes habilitées agissant sous l'autorité du responsable du traitement | Chartées et soumises au secret professionnel (Code pénal tchadien de 2017, déontologie médicale) |
| Curateurs | Personnes habilitées, accès limité aux documents bruts dé-identifiés | Jamais d'accès à l'identité (garanti par RLS) |
| Administrateur système | Personne habilitée, aucune donnée patient | Gère gabarits et comptes uniquement |
| Supabase Inc. (et AWS en sous-traitance ultérieure) | **Sous-traitant** (hébergement base, auth, stockage, fonctions) | DPA à signer ; données en région `eu-west-3` (Paris) |
| Vercel Inc. | Sous-traitant (hébergement du frontend statique ; journaux techniques) | Ne stocke pas de données patients |
| Fournisseur SMTP `[À COMPLÉTER]` | Sous-traitant (e-mails de service aux professionnels) | Aucune donnée patient dans les e-mails |
| Hébergeur du scanner ClamAV `[À COMPLÉTER]` | Sous-traitant (analyse antivirale des fichiers téléversés) | Voit transiter les documents bruts : engagement requis |
| Patients | **Personnes concernées** | Droits : voir [07-droits-personnes.md](07-droits-personnes.md) |

## 3. Corpus de textes applicables

### 3.1 Textes tchadiens contraignants

| Texte | Objet | Ce qu'il impose à MedData |
|---|---|---|
| **Loi n° 007/PR/2015 du 10 février 2015** portant protection des données à caractère personnel | Régime général : licéité, loyauté, finalités explicites et légitimes, conservation limitée ; droits (information, accès, rectification, effacement, opposition) ; formalités préalables ; transferts ; sanctions | Tout le dossier : registre (01), AIPD (02), information/consentement (03-04), sécurité (06), droits (07), violations (08), formalités et transferts (10) |
| **Décret n° 075/PR/2019 du 21 janvier 2019** portant application de la loi n° 007/PR/2015 | Modalités des formalités : régimes de **déclaration** ou d'**autorisation préalable** ; l'ANSICE statue **dans un délai d'un mois** à compter de la réception | Détermine la formalité applicable au registre (données de santé → autorisation préalable présumée `[à confirmer]`) |
| **ANSICE** — Agence Nationale de Sécurité Informatique et de Certification Électronique | Autorité de contrôle **opérationnelle** : reçoit déclarations et demandes d'autorisation, prononce avertissements, mises en demeure, interdictions de traitement, amendes (1 à 10 M FCFA) | Interlocuteur unique des formalités (traitement + transfert) et des notifications de violation — https://ansice.td |
| **Loi n° 009/PR/2015** portant sur la cybersécurité et la lutte contre la cybercriminalité ; **loi n° 008/PR/2015** sur les transactions électroniques | Sécurité des systèmes d'information ; incrimination des accès frauduleux | PSSI (06), gestion des violations (08) |
| **Code pénal tchadien (loi n° 2017-01 du 8 mai 2017)** — secret professionnel `[article à préciser]` | Sanction pénale de la révélation d'un fait confidentiel connu dans l'exercice de la profession | Rappelé dans la charte (11) et l'engagement de confidentialité |
| **Code de déontologie médicale / Ordre National des Médecins du Tchad** `[référence du texte à confirmer]` | Secret médical, dignité des patients | Charte utilisateurs (11) ; règles d'accès |
| **Comité National de Bioéthique du Tchad (CNBT)** — créé en 2010, N'Djamena | Évaluation éthique des recherches en santé (ses avis sont cités dans les protocoles publiés sur le Tchad ; membre du réseau régional CAMBIN) ; complété par l'**autorisation de recherche du ministère en charge de la santé publique** `[texte fondateur et modalités à confirmer]` | Circuit de soumission décrit en (12) |

### 3.2 Textes continentaux et internationaux (référence et bonnes pratiques)

| Texte | Portée pour MedData |
|---|---|
| **Convention de Malabo** (UA, 2014, en vigueur depuis le 8 juin 2023) | Le Tchad est **signataire** ; ratification non confirmée à la date de rédaction `[À VÉRIFIER au dépôt]` ; référence d'harmonisation continentale |
| **Déclaration d'Helsinki** (AMM, révision d'octobre 2024) | S'applique à la recherche sur **données humaines identifiables** : consentement pour la collecte, le stockage et l'usage secondaire ; bases de données de recherche **approuvées et suivies par un comité d'éthique** — d'autant plus structurante ici qu'il n'y a pas de loi tchadienne spécifique à la recherche identifiée |
| **Lignes directrices CIOMS/OMS 2016** (not. lignes 11 et 12) | Collecte et usage secondaire de données de santé ; **consentement élargi** (« broad consent ») pour un registre, sous gouvernance et supervision éthique — modèle retenu en (04) |
| **RGPD (UE) 2016/679** | Non directement applicable au responsable tchadien, mais : (i) les sous-traitants (Supabase, Vercel) y sont soumis (DPA, clauses contractuelles types) ; (ii) données hébergées en France (`eu-west-3`) : niveau de protection élevé du pays d'accueil — argument clé du dossier de transfert ; (iii) standard attendu pour collaborations et publications internationales |

### 3.3 Référentiels des sous-traitants

- **Supabase** : DPA à contresigner ; SOC 2 Type 2 ; option HIPAA/BAA (plans
  Team/Enterprise) ; résidence des données par région choisie (production :
  `[À CONFIRMER — eu-west-3, Paris]`). Voir [10-sous-traitants-transferts.md](10-sous-traitants-transferts.md).
- **Vercel** : DPA disponible ; héberge uniquement le build statique du frontend.

## 4. Matrice des obligations et état de MedData

| Obligation (source) | État actuel du produit | Action requise |
|---|---|---|
| Base de licéité : consentement de la personne (loi 007/PR/2015 ; Helsinki 2024) | Aucun patient réel ; pas de champ de traçage du consentement | Consentement écrit (04) ; registre des consentements ; champ `consent_ref` en zone identité (migration additive) |
| Formalités préalables ANSICE (déclaration/autorisation — décret 075/PR/2019) | Non réalisées ; **l'autorité est opérationnelle et statue sous un mois** | Déposer **avant toute inclusion** — préalable bloquant réel (pas de régime d'attente comme au Cameroun) |
| Information des personnes | Néant | Notice (03) remise et expliquée avant inclusion |
| Droits des personnes (information, accès, rectification, effacement, opposition) | Techniquement possibles (zones, `field_change_log`, soft delete) mais sans procédure | Procédure (07) + registre des demandes |
| Sécurité et confidentialité (lois 007 et 009/PR/2015) | Fort socle : RLS 3 zones, âge calculé serveur, exports en liste blanche, `audit_log`, RPC-only, ClamAV, hors-ligne désactivé | PSSI (06) ; compléter : MFA, sauvegardes testées, monitoring ([deploiement.md §8](../../deploiement.md)) |
| Notification des violations | Aucune procédure | Procédure (08) + registre des violations ; notification à l'ANSICE |
| Documentation des traitements | Néant | Registre (01), tenu à jour |
| Encadrement des sous-traitants | Aucun contrat signé | DPA Supabase + engagements SMTP/ClamAV/Vercel (10) |
| Transfert international (hébergement UE) | Données (fictives) déjà hébergées en UE | Formalité de transfert ANSICE + consentement explicite (04) + garanties contractuelles (10) `[articles exacts à confirmer]` |
| Référent protection des données | Personne non désignée | Désigner un référent `[À COMPLÉTER]` `[vérifier si la loi tchadienne impose un correspondant/DPO]` |
| Avis éthique + autorisation ministérielle | Non réalisés | Dossier (12) : CNBT puis ministère |
| Secret professionnel (Code pénal 2017 ; déontologie) | Implicite | Charte + engagement signé (11) |
| Sanctions encourues | — | Administratives ANSICE : avertissement, mise en demeure, interdiction de traitement, amendes 1–10 M FCFA ; pénales : 3 mois à 1 an d'emprisonnement `[barème complet à confirmer]` : justifie la règle « données fictives tant que non validé » |

## 5. Points d'attention spécifiques

1. **Ré-identification** — identique au constat général : champs libres et documents
   bruts peuvent contenir des identifiants saisis par erreur. Réponse : interdictions
   chartées (11), dé-identification avant téléversement, contrôle par échantillonnage.
2. **Administrateur d'infrastructure** — la RLS protège l'accès applicatif, pas
   l'opérateur de la base ([architecture.md §5](../../architecture.md)). Réponse : DPA
   et garanties Supabase, MFA et restriction du tableau de bord, à terme chiffrement
   applicatif de la zone identité (AIPD, action A5).
3. **Transfert hors du Tchad** — l'hébergement UE est un choix assumé (qualité des
   garanties) mais constitue un transfert international : formalité ANSICE +
   information/consentement explicites + garanties contractuelles. Aucune donnée réelle
   avant ces trois éléments.
4. **Autorité opérationnelle** — contrairement au Cameroun, l'ANSICE fonctionne et
   répond sous un mois : la formalité est un **préalable de calendrier réel**, à
   intégrer dans la planification du lancement (déposer tôt, en parallèle du circuit
   éthique).
5. **Absence de loi recherche identifiée** — le dossier compense en appliquant
   volontairement les standards les plus exigeants (Helsinki 2024, CIOMS 2016) et en
   faisant du CNBT le pivot de la gouvernance ; si la revue juridique identifie un
   texte tchadien spécifique, l'intégrer ici et dans (12).
6. **Comptes professionnels** — les utilisateurs sont aussi des personnes concernées
   pour leurs données de compte et de journalisation : couvert par la politique (05).
7. **Mode hors-ligne** — désactivé par défaut pour toute donnée réelle
   ([securite-mode-hors-ligne.md](../../securite-mode-hors-ligne.md)) ; toute
   réactivation = mise à jour de l'AIPD + information des personnes. Point sensible au
   Tchad où la connectivité peut inciter à le demander : la règle ne cède qu'avec
   chiffrement + TTL + MDM + revue documentée (PSSI §8).

## 6. Stratégie de conformité recommandée

1. **Ancrage institutionnel tchadien** : désigner comme responsable du traitement un
   établissement (hôpital, université, institut) plutôt qu'une personne physique. Le
   porteur scientifique (`[Dr Raymond Mbassi]`) reste investigateur principal et point
   de contact.
2. **Périmètre initial restreint** : registre mono-spécialité, mono-site, à
   consentement prospectif écrit. L'import rétrospectif fera l'objet d'une demande
   spécifique au CNBT (consentement ou dispense motivée).
3. **Consentement élargi gouverné** (CIOMS 11) : inclusion + usages futurs supervisés
   par le CNBT, consentements distincts pour transfert international et images.
4. **Formalités en parallèle** : déposer le dossier ANSICE (traitement + transfert)
   pendant l'instruction éthique — l'ANSICE statuant sous un mois, ce n'est pas le
   chemin critique si c'est anticipé.
5. **Jalonnement strict** : aucune donnée réelle avant exécution complète de la
   [checklist (13)](13-checklist-donnees-reelles.md).

## 7. Décisions à acter par le porteur du projet

| # | Décision | Options |
|---|---|---|
| D1 | Responsable du traitement | Établissement tchadien `[nom]` (recommandé) / personne physique |
| D2 | Référent protection des données | `[nom, qualité, contact]` |
| D3 | Site(s) d'inclusion et spécialité du registre pilote | `[à définir]` |
| D4 | Périmètre du pilote réel | Effectif cible, prospectif seul ou + rétrospectif |
| D5 | Région Supabase de production | Confirmer `eu-west-3` (Paris) et la figer dans (10) |
| D6 | Plan Supabase | Passage à un plan avec DPA signé et support (Team recommandé) |

## 8. Sources

- Loi n° 007/PR/2015 (fiche AFAPDP) : https://www.afapdp.org/archives/download-view/tchad-loi-007-pr-2015
- Décret n° 075/PR/2019 et effectivité du régime : https://www.labase-lextenso.fr/lessentiel-droits-africains-des-affaires/DAA112x7 ; https://www.vda.pt/en/media/news-and-media/application-of-the-personal-data-protection-law-in-chad/21818/
- Synthèse de la loi et sanctions : https://caseguard.com/articles/personal-data-protection-and-privacy-for-citizens-of-chad/
- ANSICE : https://ansice.td/publications
- CNBT (rôle effectif, réseau CAMBIN) : https://cambin.org/partners/ ; avis CNBT cités dans des protocoles publiés (medRxiv, clinicaltrials.gov)
- Convention de Malabo (signataires/ratifications) : https://au.int/fr/node/29560 ; https://en.wikipedia.org/wiki/Malabo_Convention
- Déclaration d'Helsinki, révision 2024 : https://www.wma.net/what-we-do/medical-ethics/declaration-of-helsinki/
- Supabase : DPA https://supabase.com/downloads/docs/Supabase+DPA+250314.pdf ; sécurité https://supabase.com/security ; SOC 2 https://supabase.com/docs/guides/security/soc-2-compliance
- Panorama des lois africaines : https://blog.africadataprotection.org/legislations-africa-data-protection/
