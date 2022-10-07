### Établir une connexion

1. Pressez `F1`
2. Trouvez `IBM i: New Connection`
3. Saisissez les informations de votre connexion dans la fenêtre qui s'ouvre
4. Appuyez sur `Connect`

Astuce: La prochaine fois, essayez d'utiliser `IBM i: Connect to previous`

### Parcourir / modifier les membres sources

1. Connectez-vous à votre système.
2. Trouvez l'explorateur s'objet `OBJECT BROWSER`  et cliquez `Create new filter`.
3. Complétez la boîte de dialogue du nouveau filtre, en suivant le texte descriptif, en vous assurant:
   a. Que `Object` est le fichier physique source que vous souhaitez modifier.
   b. Que  `Object type filter`est positionné sur `*SRCPF`.
4. Enregistrez les paramètres
5. Cliquez sur le filtre pour afficher la liste des membres du fichier source.
6. Cliquez sur un membre pour l'ouvrir.

 **Note:** Il n'y a pas de verrouillage des membres et le paramétrage par défaut de l'extension ne met pas à jour les dates de source.

### Comment compiler mon code source?

1. Modifiez votre liste de bibliothèque dans l'explorateur `USER LIBRARY LIST`. (Chaque connexion a sa propre liste de bibliothèques.)
2. Ouvrez la source que vous souhaitez compiler.
3. Utilisez `Ctrl+E` ou `Cmd+E` pour compiler votre source.
4. Si vous avez plus d'une commande de compilation à votre disposition pour ce type de source, sélectionnez la plus appropriée.
5. Si vous utilisez `*EVENTF`, La liste des erreurs doit se charger automatiquement dans l'onglet `PROBLEMS`.
