# Code for IBM i

## IBM i development extension for VS Code

Maintain and compile your RPGLE, CL, COBOL, C/CPP on the IBM i right from Visual Studio Code.
![intro_01.png](assets/intro_01.png)

![intro_02.png](assets/intro_02.png)

## Requirements

- SSH Daemon must be started on IBM i.
  (Licensed program 5733-SC1 provides SSH support. STRTCPSVR *SSHD starts the daemon.)
- Some familarity with VS Code. An introduction can be found [here](https://code.visualstudio.com/docs/getstarted/introvideos).

## Installation

From  VS Code Marketplace:

[Code-for-ibmi from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi)

Or from the Extensions icon in the Activity Bar (on the left):
![assets/install_01,png](assets/install_01.png)

### Recommended Extensions

- [IBMi Languages](https://marketplace.visualstudio.com/items?itemName=barrettotte.ibmi-languages) - Syntax highlighting for RPG, RPGLE, CL, and DDS. Is usually installed automatically.

## Quick Start Guide

### Make a connection

1. Press F1
2. Find 'IBM i: New Connection'
3. Enter in your connection details in the window that opens
4. Hit Connect

Tip: next time, try using 'IBM i: Connect to previous'

### Browse/Edit source members

1. Connect to your system
2. Find the MEMBER BROWSER and click on it to expand it.
3. Hover over it and click the + icon. A window will appear to add the path to a source physical file you'd like to browse or edit.
4. Key the path in `LIB/FILE` format and hit enter.
5. The library will show up in the MEMBER BROWSER. Click on it and the source file will display.
6. Click on the source file to display the list of members.
7. Click on a member to open it.
 **Note:** There is no member locking and the extension defaults to not retaining source dates.

### How do I compile my source code?

1. Edit your library list in the 'USER LIBRARY LIST' browser. (Each connection has its own library list.)
2. Open the source you want to compile.
3. Use Ctrl+E or Cmd+E to compile your source.
4. If you have more than one compile option available to you for the type of source, select the appropriate one.
5. If you are using `*EVENTF`, the error listing should automatically load in the PROBLEMS tab.

## Login

### Connect First Time

Click the IBM i icon.

![](assets/connect_01.png)

Click 'Connect to an IBM i'

![](assets/connect_02.png)

Complete this form. (You need either a password or a private key)

![](assets/connect_03.png)

Alternatively, press <kbd>F1</kbd>, search for ```IBM i: New Connection```, and complete the above form.

### Connect Subsequent

If you have already connected to an IBM i system, click on the conection in the IBM i: SERVERS browser.

![](assets/connect_04.png)

After logging in, a status bar item will appear showing the name
of the IBM i system you are connected to.

![assets/connect_05.png](assets/connect_05.png)

### Logout (Disconnect)

To close a connection and logout out, press <kbd>F1</kbd>, search for ```IBM i: Disconnect from current connection```

## Actions

Actions are used to perform tasks on members, streamfiles and other types of objects. You can edit Actions in this UI or by manually creating or editing the ```code-for-ibmi.actions``` section in the Code for IBM i settings file: ```settings.json```. If no ```code-for-ibmi.actions``` section exists in ```settings.json```, the default action list is loaded directly from the extension itself. If a new action is created or a change is made to an existing action and saved from this UI, the ```code-for-ibmi.actions``` section will be automatically written/updated to ```settings.json```.

![assets/actions_01.png](assets/actions_01.png)

- Add actions with New Action.
- Copy an existing action and modify it with Duplicate.
- Click on an action to change it.

Adding or changing, you see this same UI:

![assets/actions_02.png](assets/actions_02.png)

In the example above we are editing 'Create Bound RPG Program (CRTBNDRPG)'. We can change any of the properties.

- '**Command to run**' is the command that will be executed. Notice it has portions of text that start with an `&` (ampersand) - such text is a "variable" that will be substituted when the action is run. Commands can have different variables based on what 'Type' (member, streamfile, object) is specified. Note that in addition to the supplied variables, you can create your own variables.  See "Custom Variables", below.
- '**Extensions**' defines the list of extensions that can use this Action. For `CRTBNDRPG`, that usually means only `RPGLE` and `RPG`, so we would enter: `RPGLE, RPG`.
- '**Types**' determines which type of object can run this action. For example, if your Action only applies to source members, then choose 'Member' from the dropdown.
- '**Environment**' determine where the command should be run. In this case, `CRTBNDRPG` needs to run in the ILE environment since it's an ILE command. You also have the option to run commands through PASE or QShell.

When complete, **click Save**. If you simply close the tab, nothing will be saved.
<!-- Left in, just in case we need it again. -->
<!-- Internally, the command information is saved similar to this in settings.json:

```json
"code-for-ibmi.actions": [
  {
    "type": "member",
    "extensions": [
      "rpgle",
      "rpg"
    ],
    "name": "CRTBNDRPG",
    "command": "CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE)"
  }
]
```

The  `type` property values are:

- `member` for source members
- `streamfile` for streamfiles
- `object` for objects

Use the `environment` property to run the action in a specific environment:

- `ile` (default) to run CL commands in the ILE environment
- `qsh` to run commands in QShell
- `pase` to run commands in pase

Other important properties:

- `extensions` property is used to tie the action to certain types of files or objects.
- `name` is used to identify the action when selecting and running them.
- `command` is used to define what will be executed. Read about command below.

### Command variables and fields

> `CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE)`

The command variable is the command that will be executed on the IBM i. Notice it has portions of text that start with an & (ampersand) - such text will be substituted when the action is run. Commands can have different variables based on what 'Type' (member, streamfile, object) is specified.

#### Variables in all types

| Variable | Usage                              |
|----------|------------------------------------|
| `&CURLIB` | Values which comes from the connection settings |
| `&BUILDLIB` | The same as `&CURLIB` |
| `&USERNAME` | Username being used to connect to the current system |
| `&HOME` | Home directory configured for the connection |

#### Member variables

For all member variables, you can end the variable with `L` for the lowercase of it. E.g. `&OPENMBR` for the uppercase or `&OPENMBRL` for the lowercase.

| Variable | Usage                              |
|----------|------------------------------------|
| `&OPENLIB` | Library that member resides in     |
| `&OPENSPF` | Source file that member resides in |
| `&OPENMBR` | Name of member                     |
| `&EXT`     | Member extension                   |

#### Streamfile variables

| Variable  | Usage                                           |
|-----------|-------------------------------------------------|
| `&FULLPATH` | Path to the streamfile.                         |
| `&NAME`     | Name of the streamfile with no extension        |
| `&NAMEL`    | The same as `&NAME`, but lowercase.             |
| `&EXT`      | Extension of basename                           |
| `&EXTL`      | The same as `&EXT`, but lowercase. |

#### Object variables

For all object variables, you can end the variable with `L` for the lowercase of it. E.g. `&NAME` for the uppercase or `&NAMEL` for the lowercase.

| Variable  | Usage                             |
|-----------|-----------------------------------|
| `&LIBRARY`  | Library in which the object exists|
| `&NAME`     | Name of the object                |
| `&TYPE`     | The object type (PGM, FILE, etc)  |
| `&EXT`     | The same as `&TYPE`  |
 -->
## Action Execution

There are three varieties of Actions. They can:

- execute immediately,
- or they can be displayed for modification,
- or they can be prompted through the user interface.

### Execute Immediately

If we have a "**Call program**" command with a "Command to run" string like this:

`CALL &LIBRARY/&NAME`  

It will execute immediatly it is selected.

### Display for modification

If the "Command to run" string has a leading "?", e.g., like this:

`?CALL &LIBRARY/&NAME`  

It is displayed and you can edit it as needed.

![](assets/actions_exec_01.png)

For example, you might want to add **PARM('Douglas' 'Adams')** to the end.

![](assets/actions_exec_02.png)

### Prompted

Rather than using the "?", you can have the Action prompt for values.
The "Command to run" string can have embedded prompt string(s) to invoke prompting.

A "prompt string" has the format ``${NAME|LABEL|[DEFAULTVALUE]}`` where:

- NAME is an arbitrary name for the prompt field, but must be unique for this action.
- LABEL is the text to describe the prompt field.
- [DEFAULTVALUE] is an **optional** value to pre-populate the prompt field.

#### *Example 1*

Suppose we have a "**Call program, prompt for parms**" action with the "Command to run" defined like this:

``CALL &LIBRARY/&NAME PARM('${AAA|First name|Your name}' '${xyz|Last Name}')``

If we run the action it prompts like this:

![](assets/actions_exec_03.png)

If we complete the screen like this:

![](assets/actions_exec_04.png)

and click **Execute** a command like this is executed;

``CALL LENNONS1/ATEST PARM('Douglas' 'Adams')``

#### *Example 2*

You can also use variables in the prompt string. If an action is defined like this:

``CALL &LIBRARY/&NAME PARM('${AAA|Library|&CURLIB}' '${xyz|Report Name}')``

&CURLIB will be substituted and the prompt will look like this when executed:

![](assets/actions_exec_05.png)

#### *Example 3*

Here's a more complex example of a "**Run CRTBNDRPG (inputs)**" action.
The 'Command to run" string is defined like this:

``CRTBNDRPG PGM(${buildlib|Build library|&BUILDLIB}/${objectname|Object Name|&NAME}) SRCSTMF('${sourcePath|Source path|&FULLPATH}') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)``

When executed, it prompts like this: 

![Panel to the right](assets/compile_04.png)

### Custom Variables

You can create custom variable to use in your "Command to run" strings. To access custom variables:
 Use <kbd>F1</kbd>, then search for "IBM i Custom variables":

 ![](assets/actions_custom_01.png)
 
 Or from the User Library List browser:

![](assets/actions_custom_01a.png)

In the **Work with Variables** tab, click on **New Variable** to add your variable:

 ![](assets/actions_custom_02.png)
 
 Here we are adding a variable named &TARGET_RLSE.

 ![](assets/actions_custom_03.png)

Press Save and the list of custom variables is show:

![](assets/actions_custom_04.png)

Click on a custom variable to change it or delete it.

An example of usage might be in all the  CRTBNDxxx actions to add TGTRLS(&TARGET_RLSE), like this:

`?CRTBNDCL PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE)  TGTRLS(&TARGET_RLSE)`

Now a change to the TARGET_RLSE custom variable can impact all the CRTBNDxxx actions.

## Settings

To adjust this extension's settings, press <kbd>F1</kbd> and search for ```Preferences: Open Settings (UI)```.

![assets/settings_02.png](assets/settings_02.png)

Settings for this extension will be under ```Code for IBM i```

![assets/settings_01.png](assets/settings_01.png)


### Auto Refresh

When enabled, listings will refresh when items are interacted with (create, copy, delete, etc). If performance is bad, it is suggested you disable this option.

### Log Compile Output

When enabled, spool files will be logged from the command execution.
These spool files can be found under the **OUTPUT** tab (View->Output, or Ctrl + Shift + U). Select **IBM i Output** in the drop down on the right.

![Panel on Right](assets/LogOutput_01.png)

You can clear the OUTPUT tab using the **Clear Output** icon on the right.
![Clear output](assets/LogOutput_02.png)

You can change the font size in the OUTPUT tab in your settings.json thus:

````json
"[Log]": {
        "editor.fontSize": 11
    },
````

### Connections

List of connection details from prior connections.

Here is a snippet of what the connection details look like:

```json
"code-for-ibmi.connections": [
  {
    "name": "My IBMi Connection",
    "host": "DEV400",
    "port": 22,
    "username": "OTTEB",
    "privateKey": null
  }
],
```

#### Connection Settings

An array of objects. Each object is unique by the host property and is used so different connections can have their own settings. **Note that connection properties can only be edited in the form of JSON, other than certain places in the UI**

```json
    "code-for-ibmi.connectionSettings": [
        {
            "name": "My IBMi Connection",
            "host": "seiden.iinthecloud.com",
            "sourceFileList": [
                "QSYSINC/H",
                "BARRY/QRPGLESRC",
                "MYPROJ/QRPGLESRC"
            ],
            "libraryList": [
                "QSYS2",
                "QSYSINC",
                "SAMPLE"
            ],
            "homeDirectory": "/home/alan3/apug",
            "tempLibrary": "ILEDITOR",
            "buildLibrary": "QTEMP",
            "sourceASP": null
        }
    ]
```

#### Source File List

Source files to be included in the member browser.

#### Library List

An array for the user library list. Highest item of the library list goes first.

```json
"libraryList": [
    "DATALIB",
    "QSYSINC"
]
```

##### Connection profiles

It is possible to save the connection settings state, so you can change and revert back to it later. We call that state a 'connection profile'.

You can save a magnitude of settings into a profile by using the save button on the Library List view. You can provide it with a unique name, or use an existing one to overwrite an existing profile.

To load a profile, which would update the settings, you can use the list/load button on the Library List view.

The settings stored into a profile are the following:

* Home / working directory
* Current library
* Library list
* Source file list
* IFS shortcuts
* Object browser list
* Database browser list

You might use this if you use a single box to manage many different applications that have different source files and/or library lists.

#### Current library

The library which will be set as the current library during compilation.

You can change the current library with the 'Change build library' command (F1 -> Change build library).

#### Home Directory

Home directory for user. This directory is also the root for the IFS browser.

#### Temporary library

Temporary library. Stores temporary objects used by Code for i. Will be created automatically if it does not exist. Cannot be QTEMP.
Default value: ILEDITOR.
Note: If your IBM i runs replication software, there is no need to replicate the temporary library. Your sysadmin may add it to the list of objects to be ignored.

#### Source ASP

If source files are located in a specific ASP, specify here.
Otherwise, leave blank.

## Source files

### Adding Source Files

In order to make the member browser useful, source files need to be declared
in the ```Code for IBM i``` settings.

In the **Source File List** setting, additional source files can be added
by clicking the **Add Item** button.
The source file follows the intuitive ```LIB/SRCPF``` format.

![assets/srcflist_01.png](assets/srcflist_01.png)

![assets/srcflist_02.png](assets/srcflist_02.png)

Now in the **Member Browser**, source files will appear.
Each source file can be expanded to reveal its members.

![assets/srcflist_03.png](assets/srcflist_03.png)

![assets/srcflist_04.png](assets/srcflist_04.png)

A source file can be refreshed by right clicking and selecting **Refresh Member List** in the context menu.

![assets/srcflist_05.png](assets/srcflist_05.png)

### Opening Source Members

After adding a source file, a source member can now be opened by selecting
it in the member list.

![assets/members_01.png](assets/members_01.png)

### Comparing sources

It is now possible to compare two sources, whether they are members or streamfiles.

1. right click on either type, choose 'Select for compare'
2. right click the other source you'd like to compare with and choose 'Compare with Selected'
3. Profit ???

![assets/compare_01.png](assets/compare_01.png)

### Compiling Sources

Pressing <kbd>F1</kbd> and search for ```IBM i: Run Action```
will reveal two commands that can compile a source member.

![assets/compile_01.png](assets/compile_01.png)

Notice how ```IBM i: Run Action on Active Editor``` can be executed with
<kbd>CTRL</kbd> + <kbd>E</kbd>.

To compile a source member, run the ```IBM i: Run Action on Active Editor``` command.
If there is more than one compile option available for the member type, it will prompt you.

This will result in a message displaying whether the
compilation was successful or not.

If any compiler warnings or errors occurred, it will be listed under
the **PROBLEMS** tab.

![assets/compile_02.png](assets/compile_02.png)

This is what happens when a compiler error occurs.

![assets/compile_03.png](assets/compile_03.png)

For compile command configuration, see [Settings/Actions](#actions)

## Database Browser

The database browser allows you browse tables in schemas on your connected system. The schema list comes from the defined library list.

Clicking on a schema will load all tables, views, PFs, and LFs inside of the chosen schema. Click on any of those SQL objects will show you what columns are availabe. The tree view is primarily used for information purposes. When the schema has been opened, it will then add snippets to the editor when editing `.sql` sources.

### Hovering tables shows information it

![assets/db_01.png](assets/db_01.png)

### Editor will provide snippets to insert

![assets/db_02.png](assets/db_02.png)

### Viewing result sets

It is also possible to run SQL statements right from the editor. You can either highlight the statement you want to run or move your anchor over the statement and use Ctrl+R/Cmd+R to execute the statement. **note: statements only run in SQL mode and does not inherit the library list**

![assets/db_03.png](assets/db_03.png)

### db2Util Required

A compatible version of [db2util](https://github.com/IBM/ibmi-db2util) needs to be installed on the IBM i for the Database Browser to work.

If installed, db2util is also used to more quickly populate the MEMBER BROWSER list. However, incompatible versions of db2util may fail to populate the MEMBER BROWSER list. You can ignore db2util in connectionSettings like this:

````json
            "buildLibrary": "QTEMP",
            "sourceFileCCSID": "*FILE",
            "enableSQL": false,
````

## Tips & Tricks

### Search source files and IFS directories

You can now right click and click 'Search' on IFS directories and source files to search through the content of streamfiles and source members.

### Overtype

VS Code works in "insert" mode. This can be annoying when editing a fixed mode source, for example DDS. Fortunately there is an [Overtype extension](https://marketplace.visualstudio.com/items?itemName=DrMerfy.overtype) that allows you to toggle between insert and  overtype, and can also display the current mode in the status bar.

### Variant Characters/CCSID Issues

Use of variant characters, for example, '£', in your file names or source code may cause files not to open or characters to display incorrectly in Code for IBM i. If you are experiencing such issues, it is likely the IBM i PASE environment locale is not set correctly.
To ensure that the locale is set corretly:

- OS 7.4 or greater:

  It defaults to UTF-8 and there should be no issue.

- OS 7.3 or earlier:

  The SSH daemon must start with the correct PASE_LANG environment variable set. Note you probably want to use a locale that defaults to CCSID 1208. Note also case sensitivity: FR_FR is different from fr_FR.

  - Change just once by USING ``WRKENVVAR LEVEL(*JOB)`` to set the appropriate locale/language, e.g., ``PASE_LANG 'IT_IT'``.  **Restart** the SSH daemon.
  
  - Change the PASE language *system wide* by using ``WRKENVVAR LEVEL(*SYS)`` to set the appropriate locale/language, e.g., ``PASE_LANG 'FR_FR'``.  **Restart** the SSH daemon.

You can find infomation on PASE for i Locales [here](https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/apis/pase_locales.htm)

Some links to pages which containing information on variant characters:

- [IBM definition of Variant characters](https://www.ibm.com/docs/en/db2-for-zos/11?topic=ccsids-variant-characters)

- [IBM Support](https://www.ibm.com/support/pages/what-impact-changing-qccsid-shipped-65535-another-ccsid)

- [Wikipedia](https://en.wikipedia.org/wiki/EBCDIC)

## Extension Development

1. clone repo
2. ```npm i```
3. 'Run extension' from VS Code debug.

### Documentation

#### Getting Started

- install docsify ```npm i docsify-cli -g```
- run local with ```docsify serve docs/```
- by default, runs on http://localhost:3000
- Read more about [Docsify](https://docsify.js.org/#/)

#### File Structure

- ```docs/README.md``` is the main documentation file
- ```docs/index.html``` would be for styling tweaks, Docsify configuration, or adding syntax highlighting (PrismJs)
- ```docs/_sidebar.md``` is for utilizing separate markdown files (chapters in a book is a good comparison)
