
const { throws } = require(`assert`);
const vscode = require(`vscode`);

let instance = require(`../Instance`);
const Configuration = require(`../api/Configuration`);

module.exports = class ifsBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(

      vscode.commands.registerCommand(`code-for-ibmi.refreshIFSBrowser`, async () => {
        this.refresh();
      }),

      vscode.commands.registerCommand(`code-for-ibmi.changeHomeDirectory`, async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        const homeDirectory = config.homeDirectory;

        const newDirectory = await vscode.window.showInputBox({
          prompt: `Changing home directory`,
          value: homeDirectory
        });

        try {
          if (newDirectory && newDirectory !== homeDirectory) {
            await config.set(`homeDirectory`, newDirectory);
            
            if (Configuration.get(`autoRefresh`)) this.refresh();
          }
        } catch (e) {
          console.log(e);
        }
      }),


      vscode.commands.registerCommand(`code-for-ibmi.createDirectory`, async (node) => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        let root;

        if (node) {
          //Running from right click
          
          root = node.path;
        } else {
          root = config.homeDirectory;
        }

        const fullName = await vscode.window.showInputBox({
          prompt: `Path of new folder`,
          value: root
        });

        if (fullName) {

          try {
            await connection.paseCommand(`mkdir ${fullName}`);

            if (Configuration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new directory! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createStreamfile`, async (node) => {
        const connection = instance.getConnection();
        const config = instance.getConfig();
        let root;

        if (node) {
          //Running from right click
          
          root = node.path;
        } else {
          root = config.homeDirectory;
        }
        
        const fullName = await vscode.window.showInputBox({
          prompt: `Name of new streamfile`,
          value: root
        });

        if (fullName) {
          const connection = instance.getConnection();

          try {
            vscode.window.showInformationMessage(`Creating and streamfile ${fullName}.`);

            await connection.paseCommand(`echo "" > ${fullName}`);

            vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullName);

            if (Configuration.get(`autoRefresh`)) this.refresh();

          } catch (e) {
            vscode.window.showErrorMessage(`Error creating new streamfile! ${e}`);
          }
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.deleteIFS`, async (node) => {

        if (node) {
          const isStillOpen = vscode.workspace.textDocuments.find(document => document.uri.path === node.path);

          if (isStillOpen) {
            //Since there is no easy way to close a file.
            vscode.window.showInformationMessage(`Cannot delete streamfile while it is open.`);

          } else {
            //Running from right click
            let result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

            if (result === `Yes`) {
              const connection = instance.getConnection();

              try {
                await connection.paseCommand(`rm -rf ${node.path}`)

                vscode.window.showInformationMessage(`Deleted ${node.path}.`);

                if (Configuration.get(`autoRefresh`)) this.refresh();
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
          const isStillOpen = vscode.workspace.textDocuments.find(document => document.uri.path === node.path);

          if (isStillOpen) {
            //Since there is no easy way to close a file.
            vscode.window.showInformationMessage(`Cannot delete streamfile while it is open.`);

          } else {
            const fullName = await vscode.window.showInputBox({
              prompt: `Name of new path`,
              value: node.path
            });

            if (fullName) {
              const connection = instance.getConnection();

              try {
                await connection.paseCommand(`mv ${node.path} ${fullName}`);
                if (Configuration.get(`autoRefresh`)) this.refresh();

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
    let items = [], item;

    if (connection) {
      const config = instance.getConfig();
      
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
          item = new vscode.TreeItem(`Error loading members.`);
          vscode.window.showErrorMessage(e);
          items = [item];
        }

      } else {
        const objects = await content.getFileList(config.homeDirectory);

        for (let object of objects) {
          items.push(new Object(object.type, object.name, object.path));
        }
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

    if (type === `directory`) {
      this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      this.resourceUri = vscode.Uri.parse(path).with({scheme: `streamfile`});
      this.command = {
        command: `code-for-ibmi.openEditable`,
        title: `Open Streamfile`,
        arguments: [path]
      };
    }
  }
}