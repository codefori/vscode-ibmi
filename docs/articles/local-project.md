# Local Projects

It is possible to develop ILE code on your local machine without an internet connection, though a connection to an IBM i is needed for compiling code.

To open a local project, open the folder in VS Code (File -> Open Folder) - this will add the folder to your workspace. You can edit code as you would in the Explorer and the highlighting should work as expect.

To compile code from your local project, you should connect to an IBM i. This method is the same as always; though the Code for IBM i extension.

## Project file

When you connect to a system with a workspace open for the first time, it will ask the user if it is an IBM i project. You will only see this notice if the `./iproj.json` file does not exist. This is the projects configuration file. **You should check `iproj.json` into git** as all developers will need it. When it creates the default config, it may also create a `.env` file. **`.env` should be added to the `.gitignore`** because each developer should have their own version of it.

The `iproj.json` file is based on IBM's re-implementation of [Better Object Builder](https://github.com/IBM/ibmi-bob). Local Projects don't utilise the entire JSON file, as it's also used for other tools (such as `makei`) to build the entire project. Local Projects use `objlib` and `actions` primarily.

## Environment file

The `.env` file allows each developer to define their own configuration. For example, standard development practice with git is everyone developing in their own environment - so developers might build into their own libraries. `iproj.json` will automatically inherit variables from the local `.env` file.

```
# developer A:
DEVLIB=DEVALIB
```

```
# developer B:
DEVLIB=DEVBLIB
```

```json
// iproj.json
{
  "objlib": "&DEVLIB",
  "actions": []
}
```

If every developer is compiling into the same (shared) library, then an environment file is not needed and you can specify that build library in the project file.

You can also use environment variable in the Actions.

## Actions

**Local projects get their own Actions** and do not use the Actions created as part of the connection. Actions for the project belong in the `iproj.json` file - this is so every developer shares the same Actions. VS Code will provide content assist of the `iproj.json` file.

Commands have access to the following variables:

* `&OBJLIB`: object library as defined in `iproj.json`, which may be inherited from the `.env` file
* `&FOLDER`: folder in which the source you are compiling belongs in
* `&NAME`: name of the file you are compiling
* `&EXT`: extension of the file you are compiling
* `&DESC`: description of the file you are compiling

You can also specify which file system the source code should be uploaded to, though right now Code for IBM i only supports `qsys`. This means when using include/copy statements in your source code, it should be in the format for copying in members.

Additionally, you can specify which environment the command should run in. Although, we only support `qsys` right now. `pase` and `qsh` support will be added in the future.

## Compiling code

Compiling code works as it normally would in Code for IBM i - using the Control / Command + E shortcut. It is also possible to right-click on a file in the Explorer and 'Run Action' from there. Since ILE languages have the ability to copy/include source from other files, Actions will automatically detect dependencies and copy them in. Running an Action consists of:

1. The user selecting which action they want to run
2. Code for IBM i determining any sources are depended on
3. Upload all sources required for the command to run
4. Execute the command for the compile

You will see the errors show up as you would normally expect.