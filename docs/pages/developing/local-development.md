# Workspaces & Deployment (local development)

It is possible for the user to develop in a local workspace folder and deploy+compile on IBM i.

If the user opens a Workspace before connecting to an IBM i:

1. A new information messgae will show the user what their current library is,
2. If this is the first time connecting with this workspace, it will 
   * prompt the user to set a default Deploy directory, 
   * if no `actions.json` file is found will ask the user if they'd like to create a default
3. a new right-click option will appear on IFS directories to deploy to that directory
4. a 'Deploy' button will appear on the status bar

## Guides

* This step-by-step guide [in the rpg-git-book](https://worksofliam.github.io/rpg-git-book/7-tooling-vscode.html).
* A [video tutorial on YouTube](https://www.youtube.com/watch?v=XuiGyWptgDA&t=425s), showing the setup from scratch.

## 1. Setting the deploy location

In the IFS Browser, the user can right-click on any directory and select the 'Deploy Workspace to location' option.  In the Object Browser, the user can right-click on any filter and select the 'Deploy Workspace to location' option. 

If their workspace has more than one folder opened, the user will be prompted to choose which folder will be deployed to that directory/library. The user needs to have this location setup before they can deploy your workspace.

The user can change the deploy kicatuib at any by using the same right-click option on another directory or library.

When the user has used the right-click option, they will be asked if they want to run the deploy then.

## 2. The Deploy button / Running the deployment process

Using the 'Deploy' button will start the deployment process. For the deployment process to run, VS Code needs to know which folder/library to deploy to and will fail if it has not been setup correctly. If the workspace has more than one folder, the user will have to select which folder they want to deploy.

There are three options for deployment:

1. Working Changes: This only works if the chosen workspace folder is a git repository. Code for IBM i will look at the git status to determine the files that have been changed since the last commit (unstaged and staged) and only uploads those files.
2. Staged Changes: The same as the "Working Changes" option, but only uploads staged / indexed files.
3. All: Will upload all files in the chosen workspace folder. Will ignore files that are part of the '.gitignore' file if it exists.

The user can also defined Actions that are for the 'file' (local) type to run the deploy before running the Action.

## 3. Workspace Actions (deploy & build)

Similar to other repository settings, users can now store Actions as part of the Workspace. Users can now create `.vscode/actions.json` inside of your Workspace, and can contain Actions that are specific to that Workspace. That configuration file should also be checked into git for that application.

Here is an example `actions.json` setup, which requires deployment to happen before triggering BoB. VS Code will prompt content assist when working with `actions.json`. You could replace BoB with any build system here (e.g. make, or perhaps a vendor-specific tool.).

```json
[
  {
    "name": "Deploy & build 🔨",
    "command": "error=*EVENTF lib1=&CURLIB makei -z &NAME.&EXT",
    "extensions": [
      "GLOBAL"
    ],
    "environment": "pase",
    "deployFirst": true
  }
]
```

Now, when the user runs an Action against the local file (with `Control/Command + E`), they will appear in the list. 

![image](https://user-images.githubusercontent.com/3708366/146957104-4a26b4ba-c675-4a40-bb51-f77ea964ecf5.png)