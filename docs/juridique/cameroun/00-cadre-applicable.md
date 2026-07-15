# 00 — Étude du cadre juridique applicable à MedData

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider par conseil juridique camerounais** |
| Rédaction | Équipe projet MedData (assistance automatisée, sources citées §8) |
| Validations requises | Conseil juridique ; porteur du projet ; établissement de rattachement |

---

## 1. Objet et méthode

Ce document identifie les textes applicables au registre clinique MedData, qualifie
juridiquement le produit et ses acteurs, et en déduit la stratégie de mise en conformité.
Il fonde tous les autres documents du dossier. Méthode : lecture croisée du produit tel
que réellement construit ([architecture.md](../../architecture.md),
[cahier-des-charges-metier.md](../../cahier-des-charges-metier.md)) et des textes camerounais,
continentaux et internationaux recensés §3, complétée par les référentiels des
sous-traitants (Supabase, Vercel). Les numéros d'articles de la loi n° 2024/017 cités ici
proviennent de sources secondaires et **doivent être vérifiés sur le texte officiel**
(publié sur le site de la Présidence de la République) lors de la revue juridique.

## 2. Qualification juridique de MedData

### 2.1 Nature du traitement

MedData est une plateforme de **registre de recherche clinique** : constitution de bases
de patients et de rencontres cliniques structurées, à des fins de recherche en santé.
Trois qualifications en découlent cumulativement :

1. **Traitement de données à caractère personnel** au sens de la loi n° 2024/017 (art. 5 :
   toute information se rapportant à une personne physique identifiée ou identifiable).
   La **pseudonymisation n'est pas une anonymisation** : la zone analytique reste liée à
   la zone identité par la paire `(base_id, patient_code)` et constitue donc des données
   personnelles, au même titre que la zone identité elle-même.
2. **Traitement de données sensibles** : les données traitées sont des **données de
   santé** (antécédents, diagnostics, variables cliniques, images cliniques), catégorie
   spécialement protégée par la loi n° 2024/017.
3. **Recherche médicale impliquant la personne humaine** au sens de la loi n° 2022/008,
   dont le champ couvre expressément la recherche pratiquée sur **des données
   personnelles liées à la santé** (en plus des personnes vivantes ou décédées et du
   matériel biologique). Le régime éthique complet s'applique donc : consentement
   éclairé, avis d'un comité d'éthique, autorisation administrative de recherche.

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
| `[À COMPLÉTER : établissement de rattachement ou, à défaut, Dr Raymond Mbassi]` | **Responsable du traitement** | Détermine finalités et moyens. Recommandation §6 : adosser le registre à un établissement. |
| Médecins utilisateurs (propriétaires ou invités d'une base) | Personnes habilitées agissant sous l'autorité du responsable du traitement | Chartés et soumis au secret professionnel (art. 310 Code pénal, Code de déontologie) |
| Curateurs | Personnes habilitées, accès limité aux documents bruts dé-identifiés | Jamais d'accès à l'identité (garanti par RLS) |
| Administrateur système | Personne habilitée, aucune donnée patient | Gère gabarits et comptes uniquement |
| Supabase Inc. (et AWS en sous-traitance ultérieure) | **Sous-traitant** (hébergement base, auth, stockage, fonctions) | DPA à signer ; données en région `eu-west-3` (Paris) |
| Vercel Inc. | Sous-traitant (hébergement du frontend statique ; journaux techniques) | Ne stocke pas de données patients |
| Fournisseur SMTP `[À COMPLÉTER]` | Sous-traitant (e-mails de service aux professionnels) | Aucune donnée patient dans les e-mails |
| Hébergeur du scanner ClamAV `[À COMPLÉTER]` | Sous-traitant (analyse antivirale des fichiers téléversés) | Voit transiter les documents bruts : engagement requis |
| Patients | **Personnes concernées** | Droits : voir [07-droits-personnes.md](07-droits-personnes.md) |

## 3. Corpus de textes applicables

### 3.1 Textes camerounais contraignants

| Texte | Objet | Ce qu'il impose à MedData |
|---|---|---|
| **Loi n° 2024/017 du 23 décembre 2024** relative à la protection des données à caractère personnel | Régime général : licéité, consentement, données sensibles, droits, sécurité, violations, formalités préalables (art. 19), transferts internationaux (art. 32), autorité de protection, sanctions ; mise en conformité exigée au plus tard le **23 juin 2026** (art. 73) — **échéance déjà atteinte** | Tout le dossier : registre (01), AIPD (02), information/consentement (03-04), sécurité (06), droits (07), violations (08), formalités et transferts (10) |
| **Loi n° 2022/008 du 27 avril 2022** relative à la recherche médicale impliquant la personne humaine | Principes de la recherche en santé (72 articles), y compris la recherche sur données de santé ; consentement éclairé ; comités d'éthique ; encadrement investigateur/promoteur | Dossier éthique (12), consentement (04), gouvernance du registre |
| **Arrêté n° 0977/A/MINSANTE du 18 avril 2012** et textes associés (CNERSH, comités régionaux et institutionnels) | Organisation de l'évaluation éthique ; autorisation administrative de recherche (AAR) délivrée par le MINSANTE via la DROS | Circuit de soumission décrit en (12) |
| **Décret n° 83-166 du 12 avril 1983** portant Code de déontologie des médecins | Secret professionnel, dignité des patients, dossiers médicaux | Charte utilisateurs (11) ; règles d'accès |
| **Code pénal, art. 310** (secret professionnel) | Sanction pénale de la révélation d'un fait confidentiel connu dans l'exercice de la profession (3 mois à 3 ans, 20 000 à 100 000 FCFA) | Rappelé dans la charte (11) et l'engagement de confidentialité |
| **Loi n° 2010/012 du 21 décembre 2010** relative à la cybersécurité et à la cybercriminalité | Obligations générales de sécurité des systèmes d'information ; incrimination des accès frauduleux | PSSI (06), gestion des violations (08) |
| **Loi n° 96/03 du 4 janvier 1996** portant loi-cadre dans le domaine de la santé | Principes généraux du système de santé | Contexte général |

### 3.2 Textes continentaux et internationaux (référence et bonnes pratiques)

| Texte | Portée pour MedData |
|---|---|
| **Convention de l'Union africaine sur la cybersécurité et la protection des données personnelles** (« Convention de Malabo », 2014, en vigueur depuis le 8 juin 2023) | Le Cameroun ne figure pas parmi les États l'ayant ratifiée à la date de rédaction `[À VÉRIFIER au dépôt]` ; sert de référence d'harmonisation continentale |
| **Déclaration d'Helsinki** (AMM, révision d'octobre 2024) | S'applique expressément à la recherche sur **données humaines identifiables** : consentement pour la collecte, le stockage et l'usage secondaire ; les bases de données de recherche doivent être **approuvées et suivies par un comité d'éthique** |
| **Lignes directrices CIOMS/OMS 2016** (not. lignes 11 et 12) | Régissent la collecte et l'usage secondaire de données de santé ; admettent le **consentement élargi** (« broad consent ») pour un registre, sous gouvernance et supervision éthique — c'est le modèle retenu en (04) |
| **RGPD (UE) 2016/679** | Non directement applicable au responsable du traitement camerounais pour ce registre, mais : (i) les sous-traitants (Supabase, Vercel) y sont soumis et offrent des garanties de ce niveau (DPA, clauses contractuelles types) ; (ii) les données étant hébergées en France (`eu-west-3`), le niveau de protection du pays d'accueil est élevé — argument clé pour l'autorisation de transfert ; (iii) standard attendu pour collaborations et publications internationales |

### 3.3 Référentiels des sous-traitants

- **Supabase** : Data Processing Addendum (DPA) téléchargeable et à contresigner ;
  certifications SOC 2 Type 2 ; option HIPAA/BAA (plans Team/Enterprise) ; résidence des
  données par région choisie à la création du projet (production : `[À CONFIRMER —
  staging observé en eu-west-3, Paris]`). Voir [10-sous-traitants-transferts.md](10-sous-traitants-transferts.md).
- **Vercel** : DPA disponible ; héberge uniquement le build statique du frontend.

## 4. Matrice des obligations et état de MedData

| Obligation (source) | État actuel du produit | Action requise |
|---|---|---|
| Base de licéité : consentement préalable de la personne (loi 2024/017 ; loi 2022/008 ; Helsinki 2024) | Aucun patient réel ; pas de champ de traçage du consentement | Consentement écrit (04) ; tenue d'un registre des consentements ; envisager un champ `consent_ref` en zone identité (migration additive) |
| Formalités préalables auprès de l'autorité (art. 19) | Non réalisées ; autorité en cours d'installation (décret d'organisation attendu) | Déposer dès l'ouverture des guichets ; en attendant, conformité documentée + clairance éthique + AAR (§6) |
| Information des personnes | Néant | Notice (03) remise et expliquée avant inclusion |
| Droits des personnes (accès, rectification, effacement, opposition, portabilité) | Techniquement possibles (zones, `field_change_log`, soft delete) mais sans procédure | Procédure (07) + registre des demandes |
| Sécurité et confidentialité | Fort socle : RLS 3 zones, âge calculé côté serveur, exports en liste blanche, `audit_log`, RPC-only, ClamAV, hors-ligne désactivé pour données réelles | PSSI (06) ; compléter : MFA, sauvegardes testées, monitoring (cf. [deploiement.md §8](../../deploiement.md)) |
| Notification des violations à l'autorité et aux personnes | Aucune procédure | Procédure (08) + registre des violations |
| Registre/documentation des traitements | Néant | Registre (01), tenu à jour |
| Encadrement des sous-traitants | Aucun contrat signé | DPA Supabase + engagements SMTP/ClamAV/Vercel (10) |
| Transfert international (art. 32 : autorisation + garanties) | Données (fictives) déjà hébergées en UE | Dossier de transfert : autorisation de l'autorité, consentement explicite au transfert (04), garanties contractuelles (10) |
| Délégué/référent à la protection des données (certification prévue par la loi) | Personne non désignée | Désigner un référent `[À COMPLÉTER]` ; viser la certification quand le dispositif sera opérationnel |
| Avis éthique + AAR (loi 2022/008) | Non réalisés | Dossier (12) : comité compétent puis MINSANTE/DROS |
| Secret professionnel (art. 310 CP ; déontologie) | Implicite | Charte + engagement signé (11) |
| Sanctions encourues en cas de manquement | — | Administratives jusqu'à 100 M FCFA ; pénales jusqu'à 10 ans et 1 Md FCFA (personnes morales) : justifie la règle « données fictives tant que non validé » |

## 5. Points d'attention spécifiques au produit

1. **Ré-identification.** La pseudonymisation par `(base_id, patient_code)` sans clé
   étrangère est robuste côté base, mais les **champs libres** et documents bruts peuvent
   contenir des éléments identifiants saisis par erreur. Réponse : interdiction expresse
   dans la charte (11), dé-identification des documents avant téléversement, contrôle
   par le médecin soumetteur.
2. **Administrateur d'infrastructure.** La RLS protège l'accès applicatif, pas l'accès
   de l'opérateur de la base ([architecture.md §5](../../architecture.md)). Réponse : DPA et
   garanties Supabase, restriction et MFA sur le tableau de bord Supabase, journal des
   accès au dashboard, et à terme chiffrement applicatif de la zone identité (piste
   d'évolution documentée dans l'AIPD).
3. **Transfert hors du Cameroun.** L'hébergement UE est un choix assumé (qualité des
   garanties), mais il constitue un transfert international au sens de l'art. 32 :
   autorisation de l'autorité + information/consentement explicites des patients +
   garanties contractuelles. Aucune donnée réelle avant ces trois éléments.
4. **Autorité de protection non encore opérationnelle.** La loi est d'application
   obligatoire depuis le 23 juin 2026 mais le décret d'organisation de l'autorité
   `[À VÉRIFIER au dépôt]` peut ne pas être publié. Stratégie : conformité documentée et
   datée (ce dossier), dépôt des formalités dès ouverture, et appui sur les validations
   éthiques (comité + AAR) qui, elles, sont pleinement opérationnelles.
5. **Comptes professionnels.** Les utilisateurs (médecins, curateurs) sont aussi des
   personnes concernées pour leurs données de compte et de journalisation : couvert par
   la politique de confidentialité (05).
6. **Mode hors-ligne.** Désactivé par défaut pour toute donnée réelle
   ([securite-mode-hors-ligne.md](../../securite-mode-hors-ligne.md)) ; toute réactivation
   future = mise à jour de l'AIPD + information des personnes.

## 6. Stratégie de conformité recommandée

1. **Ancrage institutionnel.** Désigner comme responsable du traitement un établissement
   (hôpital, faculté, institut de recherche) plutôt qu'une personne physique :
   crédibilité auprès du comité d'éthique et de l'autorité, continuité, assurance,
   capacité à contracter avec les sous-traitants. Le porteur scientifique
   (`[Dr Raymond Mbassi]`) reste investigateur principal et point de contact.
2. **Périmètre initial restreint.** Démarrer avec un registre mono-spécialité,
   mono-site, à consentement prospectif écrit — le cas le plus simple à autoriser.
   L'import rétrospectif de dossiers existants ([reprise-import-historique.md](../../reprise-import-historique.md))
   fera l'objet d'une demande éthique spécifique (dispense ou modalités adaptées de
   consentement, à l'appréciation du comité).
3. **Modèle de consentement élargi gouverné** : consentement à l'inclusion dans le
   registre + usages de recherche futurs supervisés par le comité d'éthique (CIOMS 11),
   avec consentement distinct pour le transfert international et pour les images.
4. **Documentation d'abord.** Ce dossier complet, daté et versionné, constitue la preuve
   de conformité exigible (« accountability ») même avant l'ouverture des guichets de
   l'autorité.
5. **Jalonnement strict.** Aucune donnée réelle avant exécution complète de la
   [checklist (13)](13-checklist-donnees-reelles.md).

## 7. Décisions à acter par le porteur du projet

| # | Décision | Options |
|---|---|---|
| D1 | Responsable du traitement | Établissement `[nom]` (recommandé) / personne physique |
| D2 | Référent protection des données | `[nom, qualité, contact]` |
| D3 | Comité d'éthique visé | Institutionnel / régional (selon le site) / CNERSH (si multicentrique ou collaboration internationale) |
| D4 | Périmètre du pilote réel | Spécialité, site(s), effectif cible, prospectif seul ou + rétrospectif |
| D5 | Région Supabase de production | Confirmer `eu-west-3` (Paris) et la figer dans (10) |
| D6 | Plan Supabase | Passage à un plan avec DPA signé et support (Team recommandé) |

## 8. Sources

- Loi n° 2024/017 du 23 décembre 2024 (texte officiel) : https://prc.cm/fr/multimedia/documents/10258-loi-n-2024-017-du-23-12-2024-web
- Analyses de la loi n° 2024/017 : https://cio-mag.com/la-protection-des-donnees-a-caractere-personnel-au-cameroun-a-la-lecture-de-la-loi-du-23-decembre-2024/ ; https://www.village-justice.com/articles/cameroun-comprendre-questions-nouvelle-loi-sur-protection-des-donnees-caractere,52122.html ; https://cabinetnkoyokngoue.com/loi-2024-017-cameroun ; https://www.labase-lextenso.fr/l-essentiel-droits-africains-des-affaires/2025-n2/cameroun-adoption-d-une-loi-dediee-a-la-protection-des-donnees-a-caractere-personnel-DAA202v2
- Loi n° 2022/008 du 27 avril 2022 (recherche médicale) : https://www.prc.cm/fr/actualites/actes/lois/5773-loi-n-2022-008-du-27-avril-2022-relative-a-la-recherche-medicale-impliquant-la-personne-humaine-au-cameroun ; texte : http://cdnss.minsante.cm/sites/default/files/loi_recherche_medicale.pdf
- Évaluation éthique au Cameroun (CNERSH, comités régionaux, AAR/DROS) : https://learn.crenc.org/ethics-review-in-cameroon/ ; https://cdnss.minsante.cm/?q=fr/institution/comit%C3%A9-national-d%E2%80%99ethique-pour-la-recherche-en-sant%C3%A9-humaine-cnersh ; guide MINSANTE : https://cdnss.minsante.cm/sites/default/files/Guide%20De%20bonnes%20pratique.pdf
- Code de déontologie des médecins (décret n° 83-166 du 12 avril 1983) : https://www.medcamer.org/wp-content/uploads/2011/01/CODEONTOLOGIECAMEROUN.pdf
- Convention de Malabo (état des ratifications) : https://au.int/fr/node/29560 ; https://cybersecuritymag.africa/entree-vigueur-convention-malabo-cybersecurite-afrique/
- Déclaration d'Helsinki, révision 2024 : https://www.wma.net/what-we-do/medical-ethics/declaration-of-helsinki/
- Supabase : DPA https://supabase.com/downloads/docs/Supabase+DPA+250314.pdf ; sécurité https://supabase.com/security ; SOC 2 https://supabase.com/docs/guides/security/soc-2-compliance ; HIPAA https://supabase.com/docs/guides/security/hipaa-compliance
