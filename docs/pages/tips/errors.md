This page consists of fixes to weird errors users recieve. They are usually due to some weird system configuration.

## Unexpected packet before version

This error appears when you have lines in startup files that write to standard out. Usually the main issue is when the following commands exist in the `.bashrc` file (non-login startup file).

* `echo`
* `liblist` - this is a new bash builtin on IBM i which adds to the library list, but also writes to standard out.

You can see the original [issue on GitHub](https://github.com/halcyon-tech/vscode-ibmi/issues/325):

> This was my 'a-ha' moment as I did recently change my `~/.bashrc` file on the IBMi to pump out some general output. And sure enough, when I toggle the `~/.bashrc` file between writing to stdout and not writing to stdout, I am seeing the issue appear/disappear (respectively).
>
> The best solution, for me, is to keep the shell initialization that writes to stdout in my `~/.profile` file which will not execute via an SFTP connection. That, however, is outside the scope of this extension.

