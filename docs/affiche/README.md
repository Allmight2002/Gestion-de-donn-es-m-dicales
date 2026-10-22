# Affiche d'accès au registre (A4)

Affiche à imprimer et à fixer dans un service pour accéder à MedData par QR code.

| Fichier | Usage |
|---|---|
| `affiche-meddata.pdf` | A4 vertical vectoriel, prêt à imprimer (échelle 100 %, sans « ajuster à la page »). |
| `affiche-meddata.png` | 2480 × 3508 px, 300 DPI. |
| `affiche-meddata.svg` | Version modifiable (Inkscape, Illustrator, navigateur). |
| `generer_affiche.py` | Régénère les trois fichiers avec le nom du service et le contact du référent. |

Les fichiers versionnés gardent les champs `[Nom du service]` et `[Nom ou contact du référent]`.

## Personnaliser

Méthode recommandée (taille du texte ajustée automatiquement) :

```bash
pip install segno pillow
python docs/affiche/generer_affiche.py \
  --service "Neurochirurgie" \
  --contact "Interne référent — poste 1234" \
  --out ./affiche-neurochirurgie
```

Sans Python : ouvrir `affiche-meddata.svg` dans Inkscape et modifier les textes `service` et
`contact` (repérés par un commentaire dans le fichier). La police prévue est Inter ; sans elle,
Helvetica/Arial prend le relais.

## QR code

- Encode exactement `https://gestion-de-donn-es-m-dicales.vercel.app/` (QR version 5, correction Q).
- Noir sur blanc, 88 mm de côté (modules de 2,4 mm), marge blanche de 4 modules.
- Décodage vérifié sur le PNG, sur le PDF rastérisé à 150 DPI et sur une image réduite et floutée
  simulant une lecture à distance.

Ne jamais ajouter d'identifiant ni de mot de passe sur l'affiche.
