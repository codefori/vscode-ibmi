# Integrated terminals

It is possible, using the Terminals button in the lower left-hand corner, to select a Terminal to launch:

* PASE: will launch into the pase environment
* 5250: will launch a 5250 emulator right into the connected system. For this functionality, `tn5250` must be installed on the remote system. This can be installed via yum.
   - **Do the function keys work?** Yes.
   - **It is possible to do a system request?** Yes. Use Command+C.
   - **How do I end my session?** Use the Terminal bin in VS Code.
   - **I am stuck with `Cursor in protected area of display.`!** Use Command+A to get attention, then use F12 to go back.
   - **What are all the key bindings?** [Check them out here](https://linux.die.net/man/1/tn5250).