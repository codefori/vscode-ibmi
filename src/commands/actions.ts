import path from "path";
import { commands, TreeItem, Uri, WorkspaceFolder, window, Disposable } from "vscode";
import { refreshDiagnosticsFromServer } from "../ui/diagnostics";
import Instance from "../Instance";
import { Action, DeploymentMethod } from "../typings";
import { runAction } from "../ui/actions";
import IBMi from "../api/IBMi";
import { BrowserItem } from "../ui/types";

export function registerActionsCommands(instance: Instance): Disposable[] {
  return [
    commands.registerCommand(`code-for-ibmi.runAction`, async (target: TreeItem | BrowserItem | Uri, group?: any, action?: Action, method?: DeploymentMethod, workspaceFolder?: WorkspaceFolder) => {
      const connection = instance.getConnection()!;
      const editor = window.activeTextEditor;
      let uri;
      let browserItem;
      if (target) {
        if ("fsPath" in target) {
          uri = target;
        }
        else {
          uri = target?.resourceUri;
          if ("refresh" in target) {
            browserItem = target;
          }
        }
      }

      uri = uri || editor?.document.uri;

      if (uri) {
        if (connection) {
          const config = connection.getConfig();
          let canRun = true;
          if (editor && uri.path === editor.document.uri.path && editor.document.isDirty) {
            if (config.autoSaveBeforeAction) {
              await editor.document.save();
            } else {
              const result = await window.showWarningMessage(`The file must be saved to run Actions.`, `Save`, `Save automatically`, `Cancel`);
              switch (result) {
                case `Save`:
                  await editor.document.save();
                  canRun = true;
                  break;
                case `Save automatically`:
                  config.autoSaveBeforeAction = true;
                  await IBMi.connectionManager.update(config);
                  await editor.document.save();
                  canRun = true;
                  break;
                default:
                  canRun = false;
                  break;
              }
            }
          }

          if (canRun && [`member`, `streamfile`, `file`, 'object'].includes(uri.scheme)) {
            return await runAction(instance, uri, action, method, browserItem, workspaceFolder);
          }
        }
        else {
          window.showErrorMessage('Please connect to an IBM i first');
        }
      }

      return false;
    }),

    commands.registerCommand(`code-for-ibmi.openErrors`, async (qualifiedObject?: string) => {
      interface ObjectDetail {
        asp?: string;
        lib: string;
        object: string;
        ext?: string;
      }

      const detail: ObjectDetail = {
        asp: undefined,
        lib: ``,
        object: ``,
        ext: undefined
      };

      let inputPath: string | undefined

      if (qualifiedObject) {
        // Value passed in via parameter
        inputPath = qualifiedObject;

      } else {
        // Value collected from user input

        let initialPath = ``;
        const editor = window.activeTextEditor;
        const connection = instance.getConnection();
        
        if (editor && connection) {
          const config = connection.getConfig();
          const uri = editor.document.uri;

          if ([`member`, `streamfile`].includes(uri.scheme)) {

            switch (uri.scheme) {
              case `member`:
                const memberPath = uri.path.split(`/`);
                if (memberPath.length === 4) {
                  detail.lib = memberPath[1];
                } else if (memberPath.length === 5) {
                  detail.asp = memberPath[1];
                  detail.lib = memberPath[2];
                }
                break;
              case `streamfile`:
                detail.asp = connection.getCurrentIAspName();
                detail.lib = config.currentLibrary;
                break;
            }

            const pathDetail = path.parse(editor.document.uri.path);
            detail.object = pathDetail.name;
            detail.ext = pathDetail.ext.substring(1);

            initialPath = `${detail.lib}/${pathDetail.base}`;
          }
        }

        inputPath = await window.showInputBox({
          prompt: `Enter object path (LIB/OBJECT)`,
          value: initialPath
        });
      }

      if (inputPath) {
        const [library, object] = inputPath.split(`/`);
        if (library && object) {
          const nameDetail = path.parse(object);
          refreshDiagnosticsFromServer(instance, { library, object: nameDetail.name, extension: (nameDetail.ext.length > 1 ? nameDetail.ext.substring(1) : undefined) });
        }
      }
    }),
  ]
}