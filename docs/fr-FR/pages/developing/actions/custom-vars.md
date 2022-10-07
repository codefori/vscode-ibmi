Vous pouvez créer une variable personnalisée à utiliser dans l'instruction de votre action. Pour accéder aux variables personnalisées:

Utilisez <kbd>F1</kbd>, puis recherchez "IBM i Custom variables":

 ![F1 + IBM i Custom Variable](../../../assets/actions_custom_01.png)
 
 ou depuis l'explorateur de la liste des bibliothèques utilisateur:

![Library List Browser](../../../assets/actions_custom_01a.png)

dans le volet **Work with Variables**, cliquez sur **New Variable** pour ajouter votre variable:

 ![Work with Variables](../../../assets/actions_custom_02.png)
 
 Ici, nous ajoutons une variable nommée &TARGET_RLSE.

 ![Adding TARGET_RLSE](../../../assets/actions_custom_03.png)

Appuyez sur **save** et la liste des variables personnalisées s'affiche:

![Variables list after Save](../../../assets/actions_custom_04.png)

Cliquez sur une variable personnalisée pour la modifier ou la supprimer.

#### *Exemple d'utilisation*

Dans toutes les actions CRTBNDxxx ajoutez la variable TGTRLS(&TARGET_RLSE), comme cela:

`?CRTBNDCL PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE)  TGTRLS(&TARGET_RLSE)`

Maintenant un seul changement à la variable TARGET_RLSE affectera toutes les actions CRTBNDxxx.