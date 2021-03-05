# code-for-ibmi

> IBM i development extension for VS Code

Maintain your RPGLE, CL, COBOL, C/CPP on IBM i right from Visual Studio Code.


## Installation

### Requirements

- SSH Daemon must be started on IBM i.

### VS Code Marketplace
[Install code-for-ibmi from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.code-for-ibmi)

### Recommended Extensions

- [IBMi Languages](https://marketplace.visualstudio.com/items?itemName=barrettotte.ibmi-languages) - Syntax highlighting for RPG, RPGLE, CL, and DDS


## Login
Press <kbd>F1</kbd>, search for ```IBM i: Connect```, and press enter to arrive at the login form below.

![assets/login_01.png](assets/login_01.png)

![assets/login_04.png](assets/login_04.png)

If you have already connected to an IBM i system, you can use ```IBM i: Connect to previous``` to reconnect and save time typing.

![assets/login_02.png](assets/login_02.png)

Alternatively, use the sidebar button to reach the same two connect options and the subsequent login form.

![assets/login_03.png](assets/login_03.png)

After logging in, a status bar item will appear showing the name
of the IBM i system you are connected to.

![assets/login_05.png](assets/login_05.png)

## Settings
To adjust this extension's settings, press <kbd>F1</kbd> and 
search for ```Preferences: Open Settings (UI)```. 
Settings for this extension will be under ```Code for IBM i```

![assets/settings_01.png](assets/settings_01.png)

### Actions

Actions can be used to perform tasks on members, streamfiles and eventually other types of objects too.

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

The two available `type` property values are:

* `member` for source members
* `streamfile` for streamfiles
* `object` for objects

You can also use the `environment` property to run the action in a certain environment:

* `ile` (default) to run CL commands in the ILE environment
* `qsh` to run commands in QShell
* `pase` to run commands in pase

The `extensions` property is used to tie the action to certain types of files or objects. `name` is used to identify the action when selecting & running them. `command` is used to define what will be executed.

Notice the special identifiers in the command begining with `&`. These identifiers correspond to values of whichever member is currently open in the extension. Members and streamfiles have different variables.

#### Member variables

| Variable | Usage                              |
|----------|------------------------------------|
| &OPENLIB | Library that member resides in     |
| &OPENSPF | Source file that member resides in |
| &OPENMBR | Name of member                     |
| &EXT     | Member extension                   |

#### Streamfile variables

| Variable  | Usage                                           |
|-----------|-------------------------------------------------|
| &BUILDLIB | Values which comes from Code for IBM i settings |
| &FULLPATH | Path to the streamfile.                         |
| &NAME     | Name of the streamfile with no extension        |
| &EXT      | Extension of basename                           |

#### Object variables

| Variable  | Usage                             |
|-----------|-----------------------------------|
| &LIBRARY  | Library which the object exists   |
| &NAME     | Name of the object                |
| &TYPE     | The object type (PGM, FILE, etc)  |

New actions can be added by defining a new action object in the settings like the snippet listed above.

### Auto Refresh
When enabled, listings will refresh when items are interacted with (create, copy, delete, etc). If performance is bad, it is suggested you disable this option.

### Log Compile Output
When enabled, spool files will be logged from command execution.
These spool files can be found under **OUTPUT** / **IBM i Compile Log**.
### Connections
List of connection details from prior connections.

Here is a snippet of what the connection details look like:

```json
"code-for-ibmi.connections": [
  {
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
An array for the library list. Highest item of the library list goes first.

#### Home Directory
Home directory for user. This directory is also the root for the IFS browser.

#### Temporary library
Temporary library. Is used OUTPUT files. Cannot be QTEMP.

#### Build library
A library that can be defined/changes for IFS builds.

#### Source ASP
If source files are located in a specific ASP, specify here. 
Otherwise, leave blank.

## Adding Source Files
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


## Opening Source Members
After adding a source file, a source member can now be opened by selecting
it in the member list.

![assets/members_01.png](assets/members_01.png)

## Comparing sources

It is now possible to compare two sources, whether they are members or streamfiles.

1. right click on either type, choose 'Select for compare'
2. right click the other source you'd like to compare with and choose 'Compare with Selected'
3. Profit ???

![assets/compare_01.png](assets/compare_01.png)

## Compiling Sources
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
