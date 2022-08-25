In Code for IBM i, there is the ability to open a 5250 terminal in it's own tab. This means that all almost all developer needs are integrated into the editor. You have the choice of launching a 5250 terminal or a pase shell right in the editor.

![Screenshot 2021-12-06 at 12 07 22 PM](https://user-images.githubusercontent.com/3708366/144915006-20d44162-23ec-4f04-beec-889f989cd497.png)

_Shows explorer, RPGLE code, problems, outline view and 5250 terminal._

## Termimal requirements

Previously, to bring up the pase environment, you had to use the VS Code termimal to log into the system again (using SSH). While this worked fine, it still meant that you had to log in a second time - because you would have already connected when using Code for IBM i.

Now, there is a new clickable button to select which Termimal you want to launch:

![image](https://user-images.githubusercontent.com/3708366/144915672-6f2dbea4-c3cc-453c-8cdf-43297e9cf602.png)

Clicking the Terminals button which launch a quick pick menu, where you can select which Terminal type you want. It will use the existing connection you have in Code for IBM i.

* PASE: will launch into the pase environment
* 5250: will launch a 5250 emulator right into the connected system. For this functionality, `tn5250` must be installed on the remote system. This can be installed via yum.

## 5250 requirements & settings

The only requirement to launch a 5250 emulator is to have tn5250 installed. This can be [installed via yum](https://www.seidengroup.com/php-documentation/how-to-set-up-the-ibm-i-open-source-environment/). After you have it installed, you're good to go!

Code for IBM i provides additional settings so you can setup your termimal how you like. The most common setting is likely the CCSID mapping configuration, which lets you set the encoding for the terminal.

![image](https://user-images.githubusercontent.com/3708366/144916702-79ba1d15-ab1f-4248-abed-8b19c84715c9.png)

## FAQ

- **Do the function keys work?** Yes.
- **It is possible to do a system request?** Yes. Use Command+C.
- **How do I end my session?** Use the Terminal bin in VS Code.
- **I am stuck with `Cursor in protected area of display.`!** Use Command+A to get attention, then use F12 to go back.
- **What are all the key bindings?** [Check them out here](https://linux.die.net/man/1/tn5250).