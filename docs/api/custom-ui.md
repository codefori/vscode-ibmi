
# Custom UI in Code for IBM i

To make it easy for users to write custom UI, we have a CustomUI class that allows the users to define the form fields and handle the submission via a callback function. 

* Each form needs at least 1 submit field.
* You must `panel.dispose()` in the callback function.
* A user closing the tab does not trigger the callback.

You can find the source for this API at `src/api/CustomUI.js`.

### `CustomUI` class

* `constructor()` creates an instances
* `addField(Field)` adds a field to the CustomUI
* `loadPage(context: vscode.ExtensionContext, title: string, onDidRecieveMessage: Function)` is called when you're ready to render the page. The context must come from the extension. The callback function should have two paramaters:
  1. `panel: vscode.WebviewPanel` which is the panel being used to render the form.
  2. `{command: "clicked", data: {...}}` which returns the form data (in the `data` property).

### `Field` class

* `constructor(type: "input"|"password"|"submit", id: string, label: string)` to create an instance of a field.
* `field.description` (`string`) can be used to set text about the field for information about the field.
* `field.default` can be used to set the initial value of the field.

## Example

```js
const vscode = require(`vscode`);
const {CustomUI, Field} = require(`./api/CustomUI`);

context.subscriptions.push(
  vscode.commands.registerCommand(`code-for-ibmi.runMyThing`, function () {
    let ui = new CustomUI();

    ui.addField(new Field(`input`, `name`, `Your name`));
    ui.addField(new Field(`submit`, `submitButton`, `Connect`));

    ui.loadPage(context, `IBM i Login`, 
      /**
        * Callback function from the load page.
        * @param {vscode.WebviewPanel} panel 
        * @param {{command: "clicked"|string, data: any}} message 
        */
      async (panel, message) => {
        const {data} = message;

        if (data.name.length > 0) {
          vscode.window.showInformationMessage(`Hello ${data.name}!`);
          panel.dispose(); //Must be called to close the panel!
        } else {
          vscode.window.showErrorMessage(`Name cannot be blank.`);
        }
      }
    );
  })
);
```