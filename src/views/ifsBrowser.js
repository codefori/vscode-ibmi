
const { throws } = require('assert');
const vscode = require('vscode');

var instance = require('../Instance');

module.exports = class ifsBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.homeDirectory");
        if (affected) {
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, async () => {
        this.refresh();
      }),


      vscode.commands.registerCommand(`code-for-ibmi.createDirectory`, async (node) => {
        const connection = instance.getConnection();
        let root;

        if (node) {
          //Running from right click
          
          root = node.path;
        } else {
          root = connection.homeDirectory;
        }

        const fullName = await vscode.window.showInputBox({
          prompt: "Path of new folder",
          value: root
        });

        if (fullName) {

          try {
            await connection.paseCommand(`mkdir ${fullName}`);

            if (connection.autoRefresh) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new directory! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node) => {
        const connection = instance.getConnection();
        let root;

        if (node) {
          //Running from right click
          
          root = node.path;
        } else {
          root = connection.homeDirectory;
        }
        
        const fullName = await vscode.window.showInputBox({
          prompt: "Name of new streamfile",
          value: root
        });

        if (fullName) {
          const connection = instance.getConnection();

          try {
            vscode.window.showInformationMessage(`Creating and streamfile ${fullName}.`);

            await connection.paseCommand(`echo "" > ${fullName}`);

            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);

            if (connection.autoRefresh) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new streamfile! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (node) => {

        if (node) {
          const isStillOpen = vscode.window.visibleTextEditors.find(editor => editor.document.uri.path === node.path);

          if (isStillOpen) {
            //Since there is no easy way to close a file.
            vscode.window.showInformationMessage(`Cannot delete streamfile while it is open.`);

          } else {
            //Running from right click
            var result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

            if (result === `Yes`) {
              const connection = instance.getConnection();

              try {
                await connection.paseCommand(`rm -rf ${node.path}`)

                vscode.window.showInformationMessage(`Deleted ${node.path}.`);

                if (connection.autoRefresh) this.refresh();
              } catch (e) {
                  vscode.window.showErrorMessage(`Error deleting streamfile! ${e}`);
              }
            }

          }
        } else {
          //Running from command.
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.moveIFS`, async (node) => {
        if (node) {
          //Running from right click
          const isStillOpen = vscode.window.visibleTextEditors.find(editor => editor.document.uri.path === node.path);

          if (isStillOpen) {
            //Since there is no easy way to close a file.
            vscode.window.showInformationMessage(`Cannot delete streamfile while it is open.`);

          } else {
            const fullName = await vscode.window.showInputBox({
              prompt: "Name of new path",
              value: node.path
            });

            if (fullName) {
              const connection = instance.getConnection();

              try {
                await connection.paseCommand(`mv ${node.path} ${fullName}`);
                if (connection.autoRefresh) this.refresh();

              } catch (e) {
                vscode.window.showErrorMessage(`Error moving streamfile! ${e}`);
              }
            }

          }

        } else {
          //Running from command
          console.log(this);
        }
      })
    )
  }

  refresh() {
    this.emitter.fire();
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {Object?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const connection = instance.getConnection();
    const content = instance.getContent();
    var items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);

      try {
        const objects = await content.getFileList(element.path);

        for (const object of objects) {
          items.push(new Object(object.type, object.name, object.path));
        }

      } catch (e) {
        console.log(e);
        item = new vscode.TreeItem("Error loading members.");
        vscode.window.showErrorMessage(e);
        items = [item];
      }

    } else {
      const objects = await content.getFileList(connection.homeDirectory);

      for (var object of objects) {
        items.push(new Object(object.type, object.name, object.path));
      }
    }

    return items;
  }
}

class Object extends vscode.TreeItem {
  /**
   * @param {"directory"|"streamfile"} type 
   * @param {string} label 
   * @param {string} path
   */
  constructor(type, label, path) {
    super(label);

    this.contextValue = type;
    this.path = path;

    if (type === 'directory') {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.resourceUri = vscode.Uri.parse(path).with({scheme: 'streamfile'});
      this.command = {
        command: `code-for-ibmi.openEditable`,
        title: `Open Streamfile`,
        arguments: [path]
      };
    }
  }
}