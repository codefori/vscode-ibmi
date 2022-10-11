Plusieurs connexions peuvent être définies.  
Certains paramètres sont spécifiques à une connexion et peuvent être enregistrés pour la connexion puis recharger ultérieurement.

### Current library

Cette bibliothèque sera choisie comme la bibliothèque courante lors de la compilation.

Vous pouvez modifier la bibliothèque actuelle avec la commande `Change build library` (ou  `F1 -> Change build library`).

### Home Directory 

Répertoire courant de l'utilisateur (/home).
Ce répertoire est la racine dans l'explorateur IFS.

### Temporary library

la **bibliothèque temporaire** stocke les objets temporaires utilisés par Code For IBM i. Si elle n'existe pas, elle est créée automatiquement. Elle ne peut pas être *QTEMP*.
La valeur par défaut est *ILEDITOR*.  

Remarque: Si votre IBM I utilise un logiciel de réplication, il n'est pas nécessaire de répliquer la bibliothèque temporaire.Votre administrateur système peut l'ajouter à la liste des objets à ignorer.

### Temporary IFS directory

Le **répertoire temporaire** stocke les fichiers IFS temporaires utilisés par Code for IBM i. Si il n'existe pas, il est créé automatiquement . Il doit se trouver dans *root* ou *QOpenSys*.
La valeur par défaut est */tmp*.  
Remarque: Si votre IBM I utilise un logiciel de réplication, il n'est pas nécessaire de reproduire le répertoire temporaire.Votre administrateur système peut l'ajouter à la liste des chemins à ignorer.
Il est conseillé de prévoir la suppression automatique des fichiers créés par Code For IBM i lors de la maintenance ou IPL.

### Source ASP

Si les fichiers source sont situés dans un ASP spécifique, spécifiez le ici.
Sinon, laissez à blanc.

### Enable source dates

Sélectionné, les dates de source seront conservées.

### Source Dates in Gutter

Sélectionné, les dates de source seront affichées dans le gutter (partie gauche au niveau d'une ligne de source).