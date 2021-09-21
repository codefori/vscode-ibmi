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
4. Hit connect

Tip: next time, try using 'IBM i: Connect to previous'

### Browse source members

1. Connect to your system
2. Find the member browser and hover your mouse over it until you see the folder with the plus icon
3. Click the icon. A window will appear to add a path to a source physical file you'd like to browse (format: `LIB/FILE`)
4. After you've entered your chosen source file, hit enter.
5. Source file should appear in member browser.

You can click on a member to open and edit it. There is no member locking and the extension defaults to not retaining source dates.

### How do I compile my source code?

1. Edit your library list in the 'USER LIBRARY LIST' browser. (Each connection has its own library list.)
2. Open the source you want to compile.
3. Use Ctrl+E or Cmd+E to compile your source.
4. If you have more than one compile option available to you for the type of source, select the appropriate one.
5. If you are using `*EVENTF`, it should automatically load the error listing in the Problems tab.

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

![assets/login_05.png](assets/login_05.png)

### Logout (Disconnect)

To close a connection and logout out, press <kbd>F1</kbd>, search for ```IBM i: Disconnect from current connection```

## Settings

To adjust this extension's settings, press <kbd>F1</kbd> and search for ```Preferences: Open Settings (UI)```.

![assets/settings_02.png](assets/settings_02.png)

Settings for this extension will be under ```Code for IBM i```

![assets/settings_01.png](assets/settings_01.png)

## Actions

Actions can be used to perform tasks on members, streamfiles and eventually other types of objects too.

As of 0.4.5, you can now edit the Actions from a UI.

![assets/actions_01.png](assets/actions_01.png)

Here is an example of the action used to compile an RPG member:

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

The available `type` property values are:

- `member` for source members
- `streamfile` for streamfiles
- `object` for objects

You can also use the `environment` property to run the action in a certain environment:

- `ile` (default) to run CL commands in the ILE environment
- `qsh` to run commands in QShell
- `pase` to run commands in pase

Other important properties:

- `extensions` property is used to tie the action to certain types of files or objects.
- `name` is used to identify the action when selecting and running them.
- `command` is used to define what will be executed. Read about command below.

### Command variables and fields

> `CRTBNDRPG PGM(&OPENLIB/&OPENMBR) SRCFILE(&OPENLIB/&OPENSPF) OPTION(*EVENTF) DBGVIEW(*SOURCE)`

Notice the special identifiers in the command begining with `&`. These identifiers correspond to values of whichever member is currently open in the extension. Each `type` has different variables.

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

#### Command fields

It is possible to prompt the user specific fields with the custom UI functionality. The command string also accepts a variable format. It looks like this:

```
${NAME|LABEL|[DEFAULTVALUE]}
${desc|Description}
${objectName|Object name|&BUILDLIB}
```

It takes 3 different options:

1. The ID of the input box. Also known as the name.
2. The label which will show next to the input box.
3. Default value in the text box. **optional**

Example:

```json
{
    "type": "streamfile",
    "extensions": ["rpgle"],
    "name": "Run CRTBNDRPG (inputs)",
    "command": "CRTBNDRPG PGM(${buildlib|Build library|&BUILDLIB}/${objectname|Object Name|&NAME}) SRCSTMF('${sourcePath|Source path|&FULLPATH}') OPTION(*EVENTF) DBGVIEW(*SOURCE) TGTRLS(*CURRENT)"
},
```

![Panel to the right](assets/compile_04.png)

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
    "username": "OTTEB"
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
