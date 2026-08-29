# 04 — Formulaire de consentement éclairé

| Cartouche | |
|---|---|
| Version | 1.0 (projet) |
| Date | 2026-07-14 |
| Statut | **PROJET — à valider par le comité d'éthique** |
| Documents liés | [Notice d'information (03)](03-notice-information.md) — remise obligatoire préalable |
| Exemplaires | 2 originaux signés : 1 remis au patient, 1 conservé par l'investigateur |

> **Consignes d'utilisation (à retirer de la version imprimée).**
> Le consentement est recueilli par le médecin investigateur (ou un médecin délégué
> formé), **après** remise et explication de la notice (03), **avant** toute saisie dans
> MedData. Les consentements optionnels (B, C) sont réellement optionnels : un refus ne
> fait pas obstacle à l'inclusion si le consentement A et le consentement au transfert
> sont donnés. Le formulaire signé reçoit une **référence** (`CONS-AAAA-NNNN`) reportée
> dans MedData (champ de traçabilité en zone identité, action A9 de l'AIPD) ; l'original
> papier est conservé sous clé par l'investigateur. Si le patient ne peut pas lire :
> lecture intégrale à voix haute en langue comprise, présence d'un **témoin impartial**
> (ni membre de l'équipe de recherche, ni personnel du registre) qui atteste et signe ;
> le patient appose sa signature ou son empreinte digitale.

---

## FORMULAIRE DE CONSENTEMENT ÉCLAIRÉ

**Registre : `[nom du registre]`** — **Référence du consentement : CONS-`[AAAA-NNNN]`**
**Établissement responsable du traitement : `[nom, adresse]`**
**Médecin investigateur : `[nom, service]`**
**Avis éthique (CNBT) : `[référence]` — Autorisation de recherche : `[référence]`**

### Identification du participant

| | |
|---|---|
| Nom et prénom(s) | |
| Date de naissance | |
| Le cas échéant, représentant légal (nom, lien) | |

### Déclarations du participant

Je soussigné(e), déclare que (cocher chaque case) :

- ☐ J'ai reçu la **notice d'information version `[1.0]` du `[date]`**, et elle m'a été
  expliquée dans une langue que je comprends.
- ☐ J'ai pu poser toutes mes questions et j'ai reçu des réponses claires.
- ☐ J'ai disposé d'un temps de réflexion suffisant.
- ☐ J'ai compris que ma participation est **volontaire**, qu'un refus ne changera rien à
  mes soins, et que je peux **retirer mon consentement à tout moment** sans justification
  et sans conséquence.
- ☐ J'ai compris que mes informations médicales seront enregistrées **sous un code** ne
  permettant pas de m'identifier, que mon identité n'est accessible qu'à mon médecin et
  aux personnes qu'il a autorisées, et que toute consultation de mon identité est tracée.

### A. Consentement à l'inclusion dans le registre (obligatoire)

- ☐ **J'accepte** que mes données d'identité et mes données médicales soient
  enregistrées dans le registre `[nom]` et utilisées pour la recherche scientifique
  décrite dans la notice.

### B. Consentement aux études futures (optionnel — « consentement élargi »)

- ☐ **J'accepte** / ☐ **Je refuse** que mes données **codées (sans mon identité)**
  soient réutilisées pour de **futures études scientifiques** portant sur le même
  domaine médical, à condition que chaque étude soit préalablement **approuvée par un
  comité d'éthique** et respecte les mêmes garanties de confidentialité.

### C. Images et photographies médicales (optionnel)

- ☐ **J'accepte** / ☐ **Je refuse** que des images ou photographies médicales me
  concernant soient enregistrées dans la zone sécurisée du registre. J'ai compris
  qu'elles ne sont **jamais exportées** ni publiées sous forme identifiante.

### D. Hébergement et transfert des données hors du Tchad (obligatoire pour participer)

- ☐ J'ai compris que mes données seront hébergées de manière sécurisée sur des serveurs
  situés **en France (Union européenne)**, auprès d'un prestataire lié par contrat et
  soumis à des règles strictes de protection des données, et **j'accepte expressément ce
  transfert**, encadré par la loi tchadienne n° 007/PR/2015.

### E. Consentement du mineur / de la personne protégée (le cas échéant)

- ☐ Je suis le représentant légal de `[nom du mineur/protégé]` et je consens en son nom
  aux points cochés ci-dessus. ☐ L'assentiment du mineur en âge de comprendre a été
  recherché et obtenu (dès que possible, le consentement personnel sera recueilli à la
  majorité).

### Signatures

| | Nom et prénom(s) | Date | Signature (ou empreinte) |
|---|---|---|---|
| Participant (ou représentant légal) | | | |
| Témoin impartial *(si lecture orale / participant ne lisant pas)* | | | |
| Médecin investigateur ayant conduit l'information | | | |

Le témoin atteste que la notice et le présent formulaire ont été lus et expliqués
fidèlement au participant, et que celui-ci a librement donné son consentement.

---

## VOLET DE RETRAIT DE CONSENTEMENT

*(À remplir uniquement en cas de retrait ; peut aussi être exprimé oralement au médecin,
qui le consigne, ou par courrier.)*

Je soussigné(e) `[nom]`, ayant consenti le `[date]` (référence CONS-`[…]`), **retire mon
consentement** à compter de ce jour :

- ☐ pour tout nouvel enregistrement me concernant (aucune donnée supplémentaire ne sera
  collectée) ;
- ☐ et je demande en outre l'**effacement** des données déjà enregistrées, dans les
  limites qui m'ont été expliquées (données déjà intégrées à des analyses publiées ou
  conservation exigée par la loi, sous forme codée). La réponse écrite du responsable
  du traitement m'indiquera précisément ce qui a été effacé.

| | Date | Signature |
|---|---|---|
| Participant (ou représentant légal) | | |
| Médecin/référent ayant reçu le retrait | | |

**Traitement du retrait côté registre** : voir
[procédure des droits (07)](07-droits-personnes.md) — enregistrement de la demande au
registre des demandes, exécution dans MedData (arrêt de collecte, suppression le cas
échéant), réponse écrite sous `[30 jours]`.

---

## Registre des consentements (tenu par l'investigateur)

| Réf. consentement | Code patient MedData | Date | A | B | C | D | Témoin (O/N) | Localisation de l'original |
|---|---|---|---|---|---|---|---|---|
| CONS-2026-0001 | `[base]`/`[code]` | | ☐ | ☐/✗ | ☐/✗ | ☐ | | Armoire sécurisée `[…]` |

Règles de tenue : l'original papier est conservé en lieu sûr fermant à clé, pendant
toute la durée du registre + `[5 ans]` ; la correspondance consentement↔code patient
est une donnée d'identité (ne jamais l'exporter) ; les refus B/C sont reportés dans
MedData pour être respectés (pas de réutilisation, pas d'image).
