It is possible to write VS Code extensions that are based on Code for IBM i. That means your extension can use the connection that the user creates in your extension. This is not an extension tutorial, but an intro on how to access the APIs available within Code for IBM i.

For example, you might be a vendor that produces lists or HTML that you'd like to be accessible from within Visual Studio Code.

## Imports

```
const { instance } = vscode.extensions.getExtension(`halcyontechltd.code-for-ibmi`).exports;
```

`instance` has four methods for you to use:

* `getConnection()`: [`IBMi`](https://github.com/halcyon-tech/vscode-ibmi/blob/master/src/api/IBMi.js)`|undefined` to get the current connection. Will return `undefined` when the current workspace is not connected to a remote system.

* `getContent(): `[`IBMiContent`](https://github.com/halcyon-tech/vscode-ibmi/blob/master/src/api/IBMiContent.js) to work with content on the current connection
   * `IBMiContent` has methods to run SQL statements, get the contents of tables and read and write members/streamfiles.
   * While this API is available, when running statements and (pase/ile) commands, you should the VS Code `commands` API instead (below).

* `getConfig(): `[`Configuration`](https://github.com/halcyon-tech/vscode-ibmi/blob/master/src/api/Configuration.js) to get/set configuration for the current connection

* `on(event: string, callback: Function): void` to add an event handler. Available events:
  * `connected` which can be used to determine when Code for IBM i has established a connection.

## Examples

See the following code bases for large examples of extensions that use Code for IBM i:

* [VS Code extension to manage IBM i IWS services](https://github.com/halcyon-tech/vscode-ibmi-iws)
* [Git for IBM i extension](https://github.com/halcyon-tech/git-client-ibmi)

### Views

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

### Running commands with the user library list

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
const result = await vscode.commands.executeCommand(`code-for-ibmi.runCommand`, {
  environment: `pase`,
  command: `ls`
});

// or

const result: CommandResult = await vscode.commands.executeCommand(`code-for-ibmi.runCommand`, {
  environment: `pase`,
  command: `ls`
});
```

### Running SQL queries

Code for IBM i has a command that lets you run SQL statements and get a result back.

```ts
const rows: Object[] = await vscode.commands.executeCommand(`code-for-ibmi.runQuery`, statement);

// or

const rows = await vscode.commands.executeCommand(`code-for-ibmi.runQuery`, statement);
```

### Temporary library

Please remember that you cannot use `QTEMP` between commands since each command runs in a new job. Please refer to `instance.getConfig().tempLibrary` for a temporary library.

### Storing config specific to the connection

It is likely there will configuration that is specific to a connection. You can easily use `Configuration` to get and set configuration for the connection that is specific to your extension:

```js
const config = instance.getConfig();
let someArray = config.get(`someArray`);

if (!someArray) {
  //This means this config doesn't exist for the connection
  someArray = [];
}

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