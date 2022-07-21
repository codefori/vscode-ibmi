You can create custom variable to use in your "Command to run" strings. To access custom variables:

Use <kbd>F1</kbd>, then search for "IBM i Custom variables":

 ![F1 + IBM i Custom Variable](../../../assets/actions_custom_01.png)
 
 Or from the User Library List browser:

![Library List Browser](../../../assets/actions_custom_01a.png)

In the **Work with Variables** tab, click on **New Variable** to add your variable:

 ![Work with Variables](../../../assets/actions_custom_02.png)
 
 Here we are adding a variable named &TARGET_RLSE.

 ![Adding TARGET_RLSE](../../../assets/actions_custom_03.png)

Press Save and the list of custom variables is shown:

![Variables list after Save](../../../assets/actions_custom_04.png)

Click on a custom variable to change it or delete it.

#### *Example Usage*

In all the  CRTBNDxxx actions add TGTRLS(&TARGET_RLSE), like this:

`?CRTBNDCL PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE)  TGTRLS(&TARGET_RLSE)`

Now a single change to the TARGET_RLSE custom variable can impact all the CRTBNDxxx actions.