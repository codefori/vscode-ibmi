
const vscode = require('vscode');

var instance = require('../instance');

module.exports = class memberBrowserProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        let affected = event.affectsConfiguration("code-for-ibmi.sourceFileList");
        if (affected) {
          this.emitter.fire();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.createMember`, async (node) => {
        if (node) {
          //Running from right click
          const fullName = await vscode.window.showInputBox({
            prompt: "Name of new source member"
          });

          if (fullName) {
            const connection = instance.getConnection();
            const path = node.path.split('/');
            const [name, extension] = fullName.split('.');

            if (extension !== undefined && extension.length > 0) {
              try {
                const uriPath = `${path[0]}/${path[1]}/${name}.${extension}`.toUpperCase();

                vscode.window.showErrorMessage(`Creating and opening member ${uriPath}.`);
                
                await connection.remoteCommand(
                  `ADDPFM FILE(${path[0]}/${path[1]}) MBR(${name}) SRCTYPE(${extension})`
                );

                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, uriPath);
              } catch (e) {
                vscode.window.showErrorMessage(`Error created new member! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`Extension must be provided when creating a member.`);
            }
          }

        } else {
          //Running from command
        }
      })
    )
  }

  /**
   * @param {vscode.TreeItem} element
   * @returns {vscode.TreeItem};
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {SPF?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    var items = [], item, path;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const [lib, spf] = element.path.split('/');

      try {
        const members = await content.getMemberList(lib, spf);

        for (const member of members) {
          path = `${member.library}/${member.file}/${member.name}.${member.extension}`;

          item = new vscode.TreeItem(`${member.name}.${member.extension}`);
          item.description = member.text;
          item.resourceUri = vscode.Uri.parse(path).with({scheme: 'member'});
          item.command = {
            command: `code-for-ibmi.openEditable`,
            title: `Open Member`,
            arguments: [path]
          };
          
          items.push(item);
        }
      } catch (e) {
        console.log(e);
        item = new vscode.TreeItem("Error loading members.");
        items = [item];
      }

    } else {
      const shortcuts = instance.getConnection().spfShortcuts;

      for (var shortcut of shortcuts) {
        shortcut = shortcut.toUpperCase();
        items.push(new SPF(shortcut, shortcut));
      }
    }

    return items;
  }
}

class SPF extends vscode.TreeItem {
  /**
   * @param {string} label 
   * @param {string} path
   */
  constructor(label, path) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'SPF';
    this.path = path;
  }
}