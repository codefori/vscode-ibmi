It is possible to write VS Code extensions that are based on Code for IBM i. That means your extension can use the connection that the user creates in your extension. This is not an extension tutorial, but an intro on how to access the APIs available within Code for IBM i.

For example, you might be a vendor that produces lists or HTML that you'd like to be accessible from within Visual Studio Code.

# Examples

See the following code bases for large examples of extensions that use Code for IBM i:

* [VS Code extension to manage IBM i IWS services](https://github.com/halcyon-tech/vscode-ibmi-iws)
* [Git for IBM i extension](https://github.com/halcyon-tech/git-client-ibmi)

# Command APIs

## Running commands with the user library list

Code for IBM i ships a command that can be used by an extension to execute a remote command on the IBM i: `code-for-ibmi.runCommand`.

It has a parameter which is an object with some properties:

```ts
interface CommandInfo {
  /** describes what environment the command will be executed. Is optional and defaults to `ile` */
  environment?: `pase`|`ile`|`qsh`;
  /** set this as the working directory for the command when it is executed. Is optional and defaults to the users working directory in Code for IBM i. */
  cwd?: string;
  command: string;
}
```

* Command can also use [Promptable fields](https://halcyon-tech.github.io/vscode-ibmi/#/?id=prompted).
* When executing a command in the `ile` or `qsh` environment, it will use the library list from the current connection.

The command returns an object:

```ts
interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}
```

```js
const result: CommandResult = await vscode.commands.executeCommand(`code-for-ibmi.runCommand`, {
  environment: `pase`,
  command: `ls`
});

// or

const result = await vscode.commands.executeCommand(`code-for-ibmi.runCommand`, {
  environment: `pase`,
  command: `ls`
});
```

## Running SQL queries

Code for IBM i has a command that lets you run SQL statements and get a result back.

```js
const rows: Object[] = await vscode.commands.executeCommand(`code-for-ibmi.runQuery`, statement);

// or

const rows = await vscode.commands.executeCommand(`code-for-ibmi.runQuery`, statement);
```

## Get members and streamfiles

It is possible for extensions to utilise the file systems provided by Code for IBM i.

`openTextDocument` returns a [`TextDocument`](https://code.visualstudio.com/api/references/vscode-api#TextDocument).

**Getting a member**

```js
const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({
  scheme: `member`,
  path: `/${library}/${file}/${name}.${extension}`
}));
```

**Getting a streamfile**
```js
const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({
  scheme: `streamfile`,
  path: streamfilePath
}));
```

## Connect to a system

It is possible for your API to automate connecting to an IBM i instead of the user using the connection view.

```js
const connected: boolean = await vscode.commands.executeCommand(`code-for-ibmi.connectDirect`, ConnectionData);

if (connected) {
  // do a thing.
} else {
  // something went wrong.
}
```

See `global.d.ts` for the `ConnectionData` interface.

# Specifics

## Right click options

It is possible for your extension to add right click options to:

* objects in the Object Browser
* members in the Object Browser
* directories in the IFS Browser
* streamfiles in the IFS Browser
* much more

You would register a command as you'd normally expect, but expect a parameter for the chosen node from the tree view. Here is the sample for deleting a streamfile in the IFS Browser.

```js
context.subscriptions.push(
  // `node` is the object passed in directly from the IFS Browser.
  vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (node) => {
    if (node) {
      //Running from right click
      let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

      if (result === `Yes`) {
        // directory using the connection API.
        const connection = instance.getConnection();

        try {
          // Run a pase command
          await vscode.commands.executeCommand(`code-for-ibmi.runCommand`, {
            command: `rm -rf "${node.path}`,
            environment: `pase`,
          });

          vscode.window.showInformationMessage(`Deleted ${node.path}.`);

          this.refresh();
        } catch (e) {
          vscode.window.showErrorMessage(`Error deleting streamfile! ${e}`);
        }
      }
    } else {
      // If it's reached this point, it usually 
      // indicates that it's running from the command palette
    }
  })
);
```

Following that, we need to register the command so it has a label. We do this in `package.json`

```json
{
  "command": "code-for-ibmi.deleteIFS",
  "title": "Delete object",
  "category": "Your extension"
}
```

Finally, we add it to a context menu:

```json
"menus": {
  "view/item/context": [
    {
      "command": "code-for-ibmi.deleteIFS",
      "when": "view == ifsBrowser",
      "group": "yourext@1"
    },
  ]
}
```

**When adding your command to a menu context**, there are lots of possible values for your `when` clause:

* `view` can be `ifsBrowser` or `objectBrowser`.
* `viewItem` can be different depending on the view:
   * for `ifsBrowser`, it can be `directory` or `streamfile`
   * for `objectBrowser`, it can be `member` (source member), `object` (any object), `SPF` (source file) or `filter`.

This allows your extension to provide commands for specific types of objects or specific items in the treeview.

[Read more about the when clause on the VS Code docs website.](https://code.visualstudio.com/api/references/when-clause-contexts)

## Views

Code for IBM i provides a context so you can control when a command, view, etc, can work. `code-for-ibmi.connected` can and should be used if your view depends on a connection. For example

This will show a welcome view when there is no connection:

```json
		"viewsWelcome": [{
			"view": "git-client-ibmi.commits",
			"contents": "No connection found. Please connect to an IBM i.",
			"when": "code-for-ibmi:connected !== true"
		}],
```

This will show a view when there is a connection:

```json
    "views": {
      "scm": [{
        "id": "git-client-ibmi.commits",
        "name": "Commits",
        "contextualTitle": "IBM i",
        "when": "code-for-ibmi:connected == true"
      }]
    }
```

# Imports

```
const { instance } = vscode.extensions.getExtension(`halcyontechltd.code-for-ibmi`).exports;
```

`instance` has some methods for you to use:

* `getConnection()`: [`IBMi`](https://github.com/halcyon-tech/vscode-ibmi/blob/master/src/api/IBMi.js)`|undefined` to get the current connection. Will return `undefined` when the current workspace is not connected to a remote system.

* `getContent(): `[`IBMiContent`](https://github.com/halcyon-tech/vscode-ibmi/blob/master/src/api/IBMiContent.js) to work with content on the current connection
  * This API should only be used to upload contents of streamfiles and members.

* `getConfig(): `[`Configuration`](https://github.com/halcyon-tech/vscode-ibmi/blob/master/src/api/Configuration.js) to get/set configuration for the current connection

### Temporary library

Please remember that you cannot use `QTEMP` between commands since each command runs in a new job. Please refer to `instance.getConfig().tempLibrary` for the user temporary library.

### Storing config specific to the connection

It is likely there will configuration that is specific to a connection. You can easily use `Configuration` to get and set configuration for the connection that is specific to your extension:

```js
const config = instance.getConfig();
const someArray = config.get(`someArray`) || [];

someArray.push(someUserItem);

config.set(`someArray`, someArray);
```

### Is there a connection?

You can use `instance.getConnection()` to determine if there is a connection:

```js
async getChildren(element) {
  const connection = instance.getConnection();

  /** @type {vscode.TreeItem[]} */
  let items = [];

  if (connection) {
    //Do work here...

  } else {
    items = [new vscode.TreeItem(`Please connect to an IBM i and refresh.`)];
  }

  return items;
}
```

### `connected` event

It is recommended to use the extensions activiation event and make it so the extension is only activated when viewed or a command is activated. If you refer to the **Views** section, make it so the view is only shown when connected and then use an `onView` activiation event. This means by the time the view is used, there should be a connection.

```json
"views": {
  "explorer": [{
    "id": "yourIbmiView",
    "name": "My custom View",
    "contextualTitle": "Extension name",
    "when": "code-for-ibmi:connected == true"
  }]
}
```

```json
"activationEvents": [
    "onView:yourIbmiView"
]
```

```js
const { instance } = vscode.extensions.getExtension(`halcyontechltd.code-for-ibmi`);

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context) {
  const connection = instance.getConnection();
  if (connection) {
    // do initial work
  }
}
```