# 10 — Sous-traitants et transferts internationaux de données

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider** (conseil juridique ; contrats à signer avant données réelles) |
| Fondement | Loi n° 007/PR/2015 : obligations du responsable du traitement vis-à-vis des sous-traitants ; transferts internationaux soumis aux formalités auprès de l'ANSICE (décret n° 075/PR/2019) `[articles exacts à préciser]` |

---

## 1. Cartographie des sous-traitants

| Sous-traitant | Rôle | Données traitées | Localisation | Garanties disponibles | Contrat requis | Statut |
|---|---|---|---|---|---|---|
| **Supabase Inc.** (États-Unis ; infrastructure AWS) | Hébergement de la base PostgreSQL, authentification, stockage de fichiers, Edge Functions | **Toutes les zones** (identité, analytique, documents), comptes, journaux | Région du projet : **`[eu-west-3 — Paris, France — à confirmer pour la production]`** ; les données restent dans la région choisie | DPA standard (clauses contractuelles types UE incluses), SOC 2 Type 2, chiffrement transit/repos, option HIPAA/BAA (plans Team/Enterprise), liste publique des sous-traitants ultérieurs | **DPA signé** + plan avec support adapté (`Team` recommandé) | ☐ À signer |
| **Amazon Web Services** (sous-traitant ultérieur de Supabase) | Infrastructure physique sous-jacente | Identiques (via Supabase) | Même région | Couvert par le DPA Supabase (obligations répercutées) | Via DPA Supabase | ☐ |
| **Vercel Inc.** (États-Unis) | Hébergement du frontend statique (PWA) | **Aucune donnée patient stockée** ; journaux techniques (IP, requêtes) des utilisateurs | CDN mondial | DPA disponible ; les flux de données cliniques vont directement du navigateur à Supabase | DPA à accepter/archiver | ☐ |
| **`[Fournisseur SMTP — à choisir]`** | E-mails de service (confirmation de compte, réinitialisation) | E-mails et noms des professionnels ; **jamais de donnée patient** | `[à documenter]` | `[selon fournisseur — privilégier un fournisseur avec DPA]` | DPA/CGV archivées | ☐ |
| **`[Hébergeur du scanner ClamAV — à définir]`** | Analyse antivirale des fichiers téléversés | **Documents bruts en transit d'inspection** (données de santé dé-identifiées) | `[à définir — privilégier la même région UE]` | Service opéré par l'équipe (docker-compose dédié) ; sécuriser : jeton fort, accès réseau restreint, pas de rétention des fichiers après verdict | Contrat d'hébergement + engagement de confidentialité de l'opérateur | ☐ |
| **GitHub** (Microsoft) | Hébergement du code source et CI | **Aucune donnée patient** (seed fictif uniquement) ; comptes des développeurs | Mondial | Hors périmètre données patients ; règle PSSI §10-11 (aucune donnée C1–C3 dans le dépôt) | — | ✔ (rien à signer au titre des données patients) |

**Règle.** Aucun nouveau sous-traitant (outil de supervision, analytics, service
d'e-mailing, IA, etc.) ne peut être branché sur la plateforme sans : inscription dans ce
tableau, contrat conforme §2, mise à jour du registre (01) et, si des données patients
sont concernées, de l'AIPD (02).

## 2. Exigences contractuelles minimales (tout sous-traitant touchant des données)

À vérifier dans chaque DPA/contrat avant signature :

1. Traitement **sur instructions documentées** du responsable du traitement uniquement ;
2. **Confidentialité** du personnel du sous-traitant ;
3. **Mesures de sécurité** décrites (chiffrement, contrôle d'accès, journalisation) ;
4. **Sous-traitance ultérieure** : information préalable, obligations répercutées,
   liste des sous-traitants ultérieurs accessible ;
5. **Notification des violations** au responsable du traitement sans retard indu ;
6. **Assistance** pour les droits des personnes et les notifications ;
7. **Localisation** : engagement sur la ou les régions de traitement ;
8. **Restitution/suppression** des données en fin de contrat, attestée ;
9. **Audits** : droit d'audit ou production de rapports de certification (SOC 2, ISO
   27001) ;
10. **Transferts** : clauses contractuelles types ou mécanisme équivalent si le
    sous-traitant peut accéder aux données depuis un pays tiers (cas Supabase : support
    américain — vérifier dans le DPA les conditions d'accès du personnel hors UE).

## 3. Analyse des flux internationaux

### 3.1 Schéma des flux

```
Patients (Tchad)
   │ collecte par le médecin (Tchad)
   ▼
Navigateur du professionnel (Tchad) ──TLS──► Supabase, région eu-west-3 (Paris, FRANCE)
   │                                                 │ sous-traitance ultérieure : AWS (même région)
   │                                                 │ sauvegardes : même région [à confirmer]
   ├──TLS──► Vercel (CDN mondial) : code applicatif uniquement, pas de données patients
   └──(fichiers téléversés)──► Edge Function ──► Scanner ClamAV [localisation à définir]
E-mails de service (pas de données patients) ──► SMTP [localisation à documenter]
```

### 3.2 Qualification

Le stockage des données du registre (y compris la zone identité) sur des serveurs situés
en France constitue un **transfert de données à caractère personnel hors du Tchad** au
sens de la loi n° 007/PR/2015, soumis aux **formalités préalables auprès de l'ANSICE**
(déclaration ou autorisation selon le régime applicable aux données de santé
`[à confirmer sur le texte]` — l'agence statue dans un délai d'un mois).

### 3.3 Dossier de justification du transfert (à joindre à la formalité ANSICE)

1. **Nécessité et proportionnalité** : absence d'offre locale équivalente pour un
   pilote (sauvegardes gérées, RLS, chiffrement, disponibilité) ; choix d'une région
   **UE** précisément pour son niveau de protection élevé (RGPD applicable à
   l'hébergement).
2. **Garanties contractuelles** : DPA Supabase signé (avec clauses contractuelles
   types), engagements des autres sous-traitants (§2).
3. **Garanties techniques** : chiffrement en transit et au repos ; cloisonnement RLS ;
   pseudonymisation de la zone analytique ; journalisation d'audit ; MFA.
4. **Consentement explicite** des personnes au transfert (case D du
   [consentement (04)](04-consentement.md)) après information claire
   ([notice (03)](03-notice-information.md) §5).
5. **Réversibilité** : capacité d'export complet et de migration vers un autre
   hébergement (`supabase db dump`, Storage), documentée.
6. **Encadrement des accès distants** : le support du sous-traitant n'accède aux
   données que dans les conditions du DPA ; accès du personnel hors UE `[analyser le
   DPA Supabase sur ce point — accès de support depuis les États-Unis possible ;
   le mentionner honnêtement dans la demande]`.

### 3.4 Mesures complémentaires décidées

- Confirmer et **figer la région de production** (`eu-west-3`) ; interdire tout
  changement de région sans nouvelle analyse de transfert.
- Restreindre l'accès au tableau de bord Supabase (PSSI §4) — c'est le vrai point
  d'accès « étranger » aux données.
- Étudier (AIPD action A5) le chiffrement applicatif de la zone identité, qui
  neutraliserait l'essentiel du risque lié à l'hébergeur.
- Héberger le scanner ClamAV dans la même région UE ou au Tchad `[décision à
  acter]` ; dans tous les cas, aucune rétention de fichier après verdict.

## 4. Registre des contrats

| Contrat | Contrepartie | Date de signature | Échéance/renouvellement | Localisation de l'archive |
|---|---|---|---|---|
| DPA Supabase | Supabase Inc. | `[…]` | tacite | `docs/juridique/preuves/` (hors dépôt public) |
| DPA Vercel | Vercel Inc. | `[…]` | | |
| Contrat + engagement ClamAV | `[…]` | | | |
| DPA/CGV SMTP | `[…]` | | | |

## 5. Actions avant données réelles (reprises en checklist 13)

- ☐ Choisir le plan Supabase adapté (Team recommandé), **signer le DPA**, archiver la
  preuve.
- ☐ Confirmer la région de production et l'inscrire ici et dans le registre (01).
- ☐ Documenter la rétention des sauvegardes et leur localisation.
- ☐ Choisir le fournisseur SMTP et l'hébergeur ClamAV définitifs ; signer leurs
  engagements.
- ☐ Accepter/archiver le DPA Vercel.
- ☐ Déposer la formalité de transfert auprès de l'ANSICE avec le dossier §3.3
  (réponse sous un mois — anticiper pour ne pas en faire le chemin critique).
