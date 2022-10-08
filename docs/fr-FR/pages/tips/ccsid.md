IBM i utilise le codage EBCDIC à l'opposé de votre poste de travail, qui utilise le codage ASCII (Windows, MAC and Linux ....chacun utilise sa propre variante). Cela peut entraîner des problèmes dans l'affichage des noms pour les objets, fichiers et membres dans l'explorateur d'objet  *Object Browser*. Pire encore, IBM I a plusieurs variantes EBCDIC, chacune ciblant une langue nationale, de plus  les caractères spéciaux américains '#', '@' and '$' autorisés sur IBM I pour les noms d'objet,membre peuvent avoir des valeurs de code différentes selon les variantes de code EBCDIC.Mais l'IBM i s'attends toujours à ce que les mêmes valeurs de code des caractères américains soient utilisées, et donc les caractères nationaux avec ces mêmes  valeurs de code doivent être utilisés à la place.

À partir de la version 1.4.0 de cette extension, le code pour gérer ces différences a été modifié, principalement lorsque SQL est activé et utilisé pour récupérer les listes d'objets et de membres. Auparavant, il n'y avait pas de conversion entre les caractères américains et nationaux, mais maintenant, Code for IBM i convertit les caractères américains en caractères nationaux. Ceci est contrôlé par le jeu de caractères choisi (CCSID) au niveau du profil IBM i utilisé pour la connexion, Alternativement la valeur système `QCCSID` (Si la valeur du CCSID du profil utilisateur est  `*SYSVAL`). Le CCSID est probablement déjà défini sur votre profil ou système utilisateur, mais si vous devez changer pour passer à une autre langue, voici quelques exemples de la façon de définir le CCSID:

| Language | Command | Variant characters |
| -------- | ------- | :----------------: |
| US | `CHGUSRPRF _yourprofile_ CCSID(37)` | $, #, @ |
| DK | `CHGUSRPRF _yourprofile_ CCSID(277)` | Å, Æ, Ø |
| FR | `CHGUSRPRF _yourprofile_ CCSID(297)` |  |
| FR avec euro | `CHGUSRPRF _yourprofile_ CCSID(1147)` | $, £, § |


La conversion se fait dans les deux sens: Lors de la lecture des noms d'objet et des membres pour la liste, mais aussi lors de la création d'un fichier source ou d'un membre ou lors de l'application d'un filtre à une liste. Pour les utilisateurs non américains, vous devez toujours utiliser vos caractères nationaux au lieu des caractères américains, également dans les filtres.

Si vous modifiez le CCSID pour votre profil sur le serveur, Vous devrez peut-être également changer vos filtres, si vous avez utilisé l'un des caractères spéciaux dans un filtre (le caractère euros par exemple !).

La valeur spéciale de CCSID **65535** signifie **aucune conversion**" - et cela désactivera le support SQL.  
Il n'est **pas recommandé** d'utiliser le CCSID **65535** et la plupart des systèmes récents ont un CCSID différent de 65535.  
Mais vous pouvez trouver cette valeur sur les systèmes plus anciens.  
La solution ici serait de changer la valeur de CCSID du profil utilisateur pour une valeur correspondant à votre langue nationale, par exemple.280 en Italie ou 297 en France.

## Définition des variables d'environnement

Si vous rencontrez toujours des problèmes après avoir établi la valeur CCSID, vous devez peut-être vérifier que le paramétrage de l'environnement local de IBM I Pase :

- OS 7.4 ou ultérieur:

[7.4 and above defaults to UTF-8](https://www.ibm.com/docs/en/i/7.4?topic=system-default-pase-ccsid-locale-changed-utf-8) and there should be no issue.

- OS 7.3 ou postérieur:

Le démon ssh doit être démarré avec les bonnes variables d'environnement `PASE_LANG` et `QIBM_PASE_CCSID`.  
Vous voulez probablement utiliser un paramètre local par défaut le CCSID est 1208 (UTF-8).  
**Les paramètres régionaux sont sensibles à la casse**. c.a.d, `FR_FR` est différent de `fr_FR`.

1. Modifiez le langage Pase et le système CCSID *niveau système* en utilisant `WRKENVVAR LEVEL(*SYS)` pour mettre en place:
   - La bonne valeur locale/langue, c.a.d., `PASE_LANG 'FR_FR'`. Vous pouvez trouver des informations les valeurs locales sur Pase de l'IBM i [içi](https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/apis/pase_locales.htm)
   - `QIBM_PASE_CCSID` doit être `1208`.
2. **Redémarrer** le démon SSH.

Vous pouvez également modifier les variables d'environnement au niveau du job `*JOB`, mais il est recommandé de le faire une fois pour toute sur votre système.

Quelques liens vers des pages contenant des informations sur les variantes d'encodage des caractères:

- [IBM definition of Variant characters](https://www.ibm.com/docs/en/db2-for-zos/11?topic=ccsids-variant-characters)
- [IBM Support](https://www.ibm.com/support/pages/what-impact-changing-qccsid-shipped-65535-another-ccsid)
- [Wikipedia](https://en.wikipedia.org/wiki/EBCDIC)