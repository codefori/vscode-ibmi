
# Custom UI in Code for IBM i

To make it easy for users to write custom UI, we have a CustomUI command that allows the users to define the form fields and handle the submission via a callback function. 

* Each form needs at least 1 submit field or buttons.
* You must `panel.dispose()` in the callback function.
* Returns `{panel, data}`

You can find the source for this API at `src/api/CustomUI.js`.

### `code-for-ibmi.launchUI` command

Your extension can execute this command with the following:

```js
vscode.commands.executeCommand(`code-for-ibmi.launchUI`, `UI Tab`, fields, (result) => {
  const {panel, data} = result;
  if (data) {
    // Button was pressed
    panel.dispose();
  } else {
    // Tab was closed
  }
});
```

### `Field` object

```js
/**
 * {{
 *    id: string,
 *    type: "input"|"password"|"buttons"|"checkbox"|"file"|"tabs"|"tree"|"select"|"paragraph"|"hr",
 *    label: string,
 *    description?: string,
 *    items?: {label: string, value: string}[],                                         // When type == tree
 *    items?: {selected?: boolean, value: string, text: string, description: string}[], // When type == select
 *    items?: {id: string, label: string}[],                                            // When type == buttons,
 *    readonly? boolean // When type == input, allowing a readonly, non editable field.
 * }[]}
 **/
```

## Example

### Simple example

```js
const vscode = require(`vscode`);

context.subscriptions.push(
  vscode.commands.registerCommand(`your-ext.runMyThing`, async function () {
    const fields = [
      { type: `input`, id: `name`, label: `Your name` },
      { type: `buttons`, items: [{id: `connect`, label: `Connect`}] }
    ];

    vscode.commands.executeCommand(`code-for-ibmi.launchUI`, `IBM i Login`, fields, (result) => {
      const {panel, data} = result;
      if (data) {
        if (data.name.length > 0) {
          panel.dispose(); //Must be called to close the panel!
          vscode.window.showInformationMessage(`Hello ${data.name}!`);
        } else {
          vscode.window.showErrorMessage(`Name cannot be blank.`);
        }
      } else {
        vscode.window.showInformationMessage(`Panel was closed by user.`);
      }
    });
  });
);
```