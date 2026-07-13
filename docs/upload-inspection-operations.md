# Uploads et inspection antivirus : exploitation

## Cycle et etats

Une operation d'upload est identifiee par une cle UUID stable, conservee dans le navigateur
pour le meme fichier, cible et libelle. `create_upload_operation` persiste cette cle, le
ticket, le chemin et l'empreinte attendue. Le chemin est donc stable avant l'envoi des octets.
`finalize_upload_operation` rattache ensuite une seule ligne metier au ticket.

Portee de la cle : elle vit dans le `localStorage` du navigateur. Une relance depuis le MEME
onglet/appareil retrouve donc la meme operation (idempotence apres rafraichissement ou reponse
perdue), mais une relance depuis un autre navigateur ou appareil regenere une cle et cree une
operation distincte. Aucune garantie cross-device n'est promise a ce niveau et la securite n'en
depend pas : le serveur reste la source de verite. `create_upload_operation` refuse une meme cle
reutilisee avec un fichier ou un contexte different, rend deterministes deux creations reellement
concurrentes (le perdant de la course relit la ligne du gagnant au lieu d'exposer une erreur
brute) et refuse de rejouer une operation dont la ligne metier a ete supprimee logiquement (pas
de resurrection silencieuse d'un document soft-deletee).

Les etats documentaires sont `pending`, `scanning`, `accepted_client`, `accepted` et
`quarantined`. En environnement strict, seul `accepted` est lisible. `pending` signifie que
les octets et la ligne sont persistés mais qu'aucun verdict serveur n'est encore disponible;
une erreur scanner revient à cet état avec `last_inspection_error`. `scanning` est verrouillé
par `inspection_run_id`; `accepted` et `quarantined` sont terminaux. Les lignes supprimées
logiquement sont exclues des lectures.

La réponse de persistance est le point de succès utilisateur: l'écran peut afficher le
document en attente et le retrouver après rafraîchissement. Une erreur, un timeout ou une
réponse perdue de `inspect-upload` ne signifie jamais que le fichier est perdu. Une relance
inspecte le même identifiant de document; un verdict terminal déjà écrit est renvoyé sans
nouvelle analyse utile.

## Réconciliation prudente

Ne pas accepter automatiquement une ligne historique `pending`, `accepted_client`, ni une
ligne `accepted` sans audit/verdict serveur démontrable. Les objets en quarantaine sont déjà
traités par `reconcile-quarantine` et son journal `quarantine_move_log`.

Pour les tickets expirés, objets sans ligne, ou lignes sans objet, lancer une procédure
opérationnelle avec un compte de service : inventorier d'abord les tickets `pending` expirés,
vérifier l'existence Storage et les références SQL, puis soit supprimer l'objet orphelin et
marquer le ticket `cleaned`, soit conserver la ligne en `pending` et réinspecter. Toute action
doit produire une entrée d'audit; aucune suppression ne doit viser un objet rattaché.

## Checklist cloud avant mode strict

- Héberger ClamAV sur un service stable, privé et redémarré automatiquement.
- Authentifier Edge → scanner avec un secret distinct, rotation et endpoint de santé.
- Définir des budgets de timeout cohérents, retries bornés/cooldown et capacité maximale.
- Superviser 5xx, timeouts, nombre de `pending`/`scanning`, mouvements de quarantaine et logs
  sans données médicales ni secrets; configurer alertes et runbook de panne/rollback.
- Tester EICAR en staging, panne scanner, reprise et réconciliation de quarantaine.
- Prouver l'activation de `require_server_inspection()` avant de passer en mode strict.
