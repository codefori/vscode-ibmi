
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
          this.refresh();
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.refreshMemberBrowser`, async () => {
        this.refresh();
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

                vscode.window.showInformationMessage(`Creating and opening member ${uriPath}.`);

                await connection.remoteCommand(
                  `ADDPFM FILE(${path[0]}/${path[1]}) MBR(${name}) SRCTYPE(${extension})`
                );

                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, uriPath);
              } catch (e) {
                vscode.window.showErrorMessage(`Error creating new member! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`Extension must be provided when creating a member.`);
            }
          }

        } else {
          //Running from command
        }
      }),

      vscode.commands.registerCommand(`code-for-ibmi.copyMember`, async (node) => {
        if (node) {
          //Running from right click
          var fullPath = await vscode.window.showInputBox({
            prompt: "New path for copy of source member",
            value: node.path
          });

          if (fullPath) {
            fullPath = fullPath.toUpperCase();

            const connection = instance.getConnection();
            const oldPath = node.path.split('/');
            const oldName = oldPath[2].substring(0, oldPath[2].lastIndexOf('.'));
            const newPath = fullPath.split('/');

            if (newPath.length === 3) {
              const newName = newPath[2].substring(0, newPath[2].lastIndexOf('.'));

              try {
                vscode.window.showInformationMessage(`Creating and opening member ${fullPath}.`);

                await connection.remoteCommand(
                  `CPYSRCF FROMFILE(${oldPath[0]}/${oldPath[1]}) TOFILE(${newPath[0]}/${newPath[1]}) FROMMBR(${oldName}) TOMBR(${newName}) MBROPT(*REPLACE)`,
                )

                vscode.commands.executeCommand(`code-for-ibmi.openEditable`, fullPath);
              } catch (e) {
                vscode.window.showErrorMessage(`Error creating new member! ${e}`);
              }
            } else {
              vscode.window.showErrorMessage(`Extension must be provided when creating a member.`);
            }
          }

        } else {
          //Running from command. Perhaps get active editor?
        }
      }),
      vscode.commands.registerCommand(`code-for-ibmi.deleteMember`, async (node) => {
        if (node) {
          //Running from right click
          var result = await vscode.window.showWarningMessage(`Are you sure you want to delete ${node.path}?`, `Yes`, `Cancel`);

          if (result === `Yes`) {
            const connection = instance.getConnection();
            const path = node.path.split('/');
            const name = path[2].substring(0, path[2].lastIndexOf('.'));

            try {
              await connection.remoteCommand(
                `RMVM FILE(${path[0]}/${path[1]}) MBR(${name})`,
              );

              vscode.window.showInformationMessage(`Deleted ${node.path}.`);
            } catch (e) {
                vscode.window.showErrorMessage(`Error deleting member! ${e}`);
            }

            //Not sure how to remove the item from the list. Must refresh - but that might be slow?
          }

        } else {
          //Running from command.
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
   * @param {SPF?} element
   * @returns {Promise<vscode.TreeItem[]>};
   */
  async getChildren(element) {
    const content = instance.getContent();
    var items = [], item;

    if (element) { //Chosen SPF
      //Fetch members
      console.log(element.path);
      const [lib, spf] = element.path.split('/');

      try {
        const members = await content.getMemberList(lib, spf);

        for (const member of members) {
          items.push(new Member(member));
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

class Member extends vscode.TreeItem {
  constructor(member) {
    const path = `${member.library}/${member.file}/${member.name}.${member.extension}`;

    super(`${member.name}.${member.extension}`);

    this.contextValue = 'member';
    this.description = member.text;
    this.path = path;
    this.resourceUri = vscode.Uri.parse(path).with({scheme: 'member'});
    this.command = {
      command: `code-for-ibmi.openEditable`,
      title: `Open Member`,
      arguments: [path]
    };
  }
}