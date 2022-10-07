Dans Code for IBM i, Il y a la possibilité d'ouvrir un terminal 5250 dans son propre onglet. Cela signifie que presque tous les besoins des développeurs sont intégrés dans l'éditeur. Vous avez le choix de lancer un terminal de 5250 ou un shell Pase dans l'éditeur.

![Screenshot 2021-12-06 at 12 07 22 PM](https://user-images.githubusercontent.com/3708366/144915006-20d44162-23ec-4f04-beec-889f989cd497.png)

_Affiche explorer, RPGLE code, problems, outline view and 5250 terminal._

## Prérequis Terminal
Auparavant, pour utiliser l'environnement PASE, vous deviez utiliser le terminal VScode pour vous connecter au système (en utilisant SSH). Bien que cela fonctionnait bien, mais cela vous obligeait à vous connecter une deuxième fois - car vous deviez déjà être connecté pour utiliser Code For IBM i.

Maintenant, il y a un nouveau bouton cliquable pour sélectionner le terminal que vous souhaitez lancer:

![image](https://user-images.githubusercontent.com/3708366/144915672-6f2dbea4-c3cc-453c-8cdf-43297e9cf602.png)

Le bouton `Terminals` lance un menu de choix rapide, où vous pouvez sélectionner le type de terminal. Il utilisera la connexion existante dont vous disposez avec Code for IBM i.

* PASE: lancera un terminal dans l'environnement Pase
* 5250: lancera un émulateur 5250 directement dans le système connecté. Pour cette fonctionnalité, `tn5250` doit être installé sur le système distant. Cela peut être installé via Yum.

## Prérequis 5250 et paramétrage

La seule exigence pour lancer un émulateur 5250 est d'installer TN5250. Cela peut se faire via [installed via yum](https://www.seidengroup.com/php-documentation/how-to-set-up-the-ibm-i-open-source-environment/). Après l'avoir installé, vous êtes prêt à y aller!

Code for IBM i fournit des paramètres supplémentaires afin que vous puissiez configurer votre terminal comme vous le souhaitez. Le paramètre le plus courant est probablement la configuration du CCSID, qui vous permet de définir le codage du terminal.

![image](https://user-images.githubusercontent.com/3708366/144916702-79ba1d15-ab1f-4248-abed-8b19c84715c9.png)

## FAQ

- **Les touches de fonction fonctionnent-elles ?** Oui.
- **Il est possible de faire une demande système ?** Oui.Utilisez  Command+C.
- **Comment terminer ma session ?** Utilisez le bac terminal dansVS Code.
- **Je suis coincé avec `Cursor in protected area of display.`!** Utilisez Command+A pour reprendre la main, puis F12 pour revenir en arrière.
- **Comment sont traduites toutes les touches de fonctions?** [Vérifiez-les ici](https://linux.die.net/man/1/tn5250).