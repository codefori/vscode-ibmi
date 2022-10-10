Cette page propose des correctifs à des erreurs bizarres que les utilisateurs rencontrent en fonction de la configuration du système.

## Unexpected packet before version

Cette erreur apparaît lorsque vous avez des lignes de code dans les fichiers de démarrage qui écrivent dans la sortie standard (*standard out*). Habituellement, le problème principal survient lorsque les commandes suivantes existent dans le fichier `.bashrc` (Fichier de démarrage sans connexion).

* `echo`
* `liblist` - Ceci est une fonction intégrée au bash sur IBM I qui modifie la liste des bibliothèques, mais elle écrit aussi dans la sortie standard.

Vous pouvez voir le [problème originel sur GitHub](https://github.com/halcyon-tech/vscode-ibmi/issues/325):

> C'est un peu ma dernière prise de conscience car j'ai récemment changé mon fichier `~ / .bashrc` sur l'IBMI pour supprimer certaines sorties. Et en effet, quand je bascule entre le fichier `~/.bashrc` qui écrit dans 'stdout' et celui qui n'y écrit pas , Je vois que le problème apparaît / disparaît (respectivement).
>
> La meilleure solution, pour moi, est de conserver les commandes shell qui écrivent dans le STDOUT dans mon fichier `~/.profile`. Car ce fichier ne s'exécutera pas via une connexion SFTP. Ce qui est en dehors de la portée de cette extension.
## exécution de SQL sans résultat

Lors de l'exécution d'une instruction SQL, aucun message ou résultat n'apparaît. Cela s'est produit lorsque le SSHD n'a pas démarré correctement. Vous pouvez voir dans la sortie (output) de code pour IBM I quelque chose comme ce qui suit:
```
/home/NUJKJ: LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')"
select srcdat, rtrim(srcdta) as srcdta from ILEDITOR.QGPL_QCLSRC_A_CHGUSR_C
{
"code": 0,
"signal": null,
"stdout": "DB2>",
"stderr": ""
}
```

### Correction potentielle

Si vous lancez la commande `ps -ef | grep sshd` et voyez en résultat `/QOpenSys/usr/sbin/sshd`, cette solution peut marcher pour vous.

1. Mettre fin à l'instance SSHD actuelle: `ENDTCPSVR SERVER(*SSHD)`.
2. Relancer le serveur SSHD: `STRTCPSVR SERVER(*SSHD)`.
3. Dans le shell PASE, lancez `ps -ef | grep sshd`.

Vous devriez maintenant voir que le SSHD s'est lancé à un autre endroit.

```
$ ps -ef | grep sshd
 qsecofr    107      1   0   Jul 15      -  0:00 /QOpenSys/QIBM/ProdData/SC1/OpenSSH/sbin/sshd
```

Le problème doit maintenant être résolu.

## La connexion utilisant la clé privée SSH échoue toujours 

Sur certaines plates-formes (par exemple, Linux Popos), votre connexion à l'aide de la clé privée SSH peut échouer avec un message comme:
```
Error while signing data with privateKey: error:06000066:public key routines:OPENSSL_internal:DECODE_ERROR
```
Cela peut se produire si les routines OpenSSL de votre plate-forme utilisées par Code pour IBM ont des problèmes avec le format de clé publique par défaut.

### Correction en faisant une copie de la clé privée au format PEM

Vous pouvez résoudre ce problème en créant une deuxième instance de votre clé publique existante au format PEM pour la déposer aux côtés de votre clé par défaut. Par exemple, si votre clé publique est `$ home / .ssh / id_rsa`, vous pouvez effectuer ce qui suit:
```
cd $HOME/.ssh
cp id_rsa id_rsa_original
ssh-keygen -p -f id_rsa -m PEM
mv id_rsa id_rsa.pem
mv id_rsa_original id_rsa
```
Configurez la connexion de code for IBM I pour utiliser la clé `id_rsa.pem` à  la place de `id_rsa`. De cette façon, votre clé d'origine est toujours là pour établir des connexions comme toujours, et vous avez une nouvelle copie au format PEM pour que les connexions de Code for IBMi fonctionnent correctement.