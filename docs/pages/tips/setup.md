This page consists of fixes to weird errors users receive based on system configuration.

## Unexpected packet before version

This error appears when you have lines in startup files that write to standard out. Usually the main issue is when the following commands exist in the `.bashrc` file (non-login startup file).

* `echo`
* `liblist` - this is a new bash builtin on IBM i which adds to the library list, but also writes to standard out.

You can see the original [issue on GitHub](https://github.com/halcyon-tech/vscode-ibmi/issues/325):

> This was my 'a-ha' moment as I did recently change my `~/.bashrc` file on the IBMi to pump out some general output. And sure enough, when I toggle the `~/.bashrc` file between writing to stdout and not writing to stdout, I am seeing the issue appear/disappear (respectively).
>
> The best solution, for me, is to keep the shell initialization that writes to stdout in my `~/.profile` file which will not execute via an SFTP connection. That, however, is outside the scope of this extension.

## No results from SQL execution

When executing an SQL statement, no messages or results are appearing. This has been happening when the SSHD has not started up correctly. You may see in the Code for IBM i output is returning something like the following:

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

### Potential fix

If you run `ps -ef | grep sshd` and see `/QOpenSys/usr/sbin/sshd`, this fix may work for you.

1. End the current SSHD instance: `ENDTCPSVR SERVER(*SSHD)`.
2. Start the SSHD up again: `STRTCPSVR SERVER(*SSHD)`.
3. In a pase shell, run `ps -ef | grep sshd`.

You should now see that the SSHD has started up from a different place.

```
$ ps -ef | grep sshd
 qsecofr    107      1   0   Jul 15      -  0:00 /QOpenSys/QIBM/ProdData/SC1/OpenSSH/sbin/sshd
```

The issue should now be resolved.

## Connection using SSH private key always fails 

On some platforms (e.g., Linux PopOS) your connection using SSH private key may fail with a message like:
```
Error while signing data with privateKey: error:06000066:public key routines:OPENSSL_internal:DECODE_ERROR
```
This may occur if the OpenSSL routines on your platform used by Code for IBM i have problems with the default public key format.

### Fix by making copy of private key in PEM format

You can solve this by creating a second instance of your extant public key in PEM format to sit alongside your default key. For instance, if your public key is `$HOME/.ssh/id_rsa` you can do the following:
```
cd $HOME/.ssh
cp id_rsa id_rsa_original
ssh-keygen -p -f id_rsa -m PEM
mv id_rsa id_rsa.pem
mv id_rsa_original id_rsa
```
Now configure the Code for IBM i connection using `id_rsa.pem` instead of `id_rsa`. In this way, your original key is still there to make connections as always, and you have a new copy in PEM format using which Code for IBM i connections operate correctly.