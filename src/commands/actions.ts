import path from "path";
import { commands, Disposable, l10n, TreeItem, Uri, window, WorkspaceFolder } from "vscode";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import Instance from "../Instance";
import { Action, DeploymentMethod } from "../typings";
import { runAction } from "../ui/actions";
import { refreshDiagnosticsFromServer } from "../ui/diagnostics";
import { BrowserItem } from "../ui/types";

export function registerActionsCommands(instance: Instance): Disposable[] {
  return [
    commands.registerCommand(`code-for-ibmi.runAction`, async (item?: (TreeItem | BrowserItem | Uri), items?: (TreeItem | BrowserItem | Uri)[], action?: Action, method?: DeploymentMethod, workspaceFolder?: WorkspaceFolder) => {
      const connection = instance.getConnection()!;
      if (connection) {
        const editor = window.activeTextEditor;
        const browserItems: BrowserItem[] = [];
        const uris: Uri[] = [];
        if (!item) {
          if (editor?.document.uri) {
            uris.push(editor?.document.uri);
          }
        }
        else {
          for (const target of (Array.isArray(items) ? items : [item])) {
            if (target instanceof Uri) {
              uris.push(target);
            }
            else if (target.resourceUri) {
              uris.push(target.resourceUri);
              if (target instanceof BrowserItem) {
                browserItems.push(target);
              }
            }
          }
        }

        const scheme = uris[0]?.scheme;
        if (scheme) {
          if (!uris.every(uri => uri.scheme === scheme)) {
            window.showWarningMessage(l10n.t("Actions can't be run on multiple items of different natures. ({0})", uris.map(uri => uri.scheme).filter(Tools.distinct).join(", ")));
            return false;
          }

          const config = connection.getConfig();          

          for (const openedEditor of window.visibleTextEditors) {
            const path = openedEditor.document.uri.path;
            if (uris.some(uri => uri.path === path) && openedEditor.document.isDirty) {
              if (config.autoSaveBeforeAction) {
                await openedEditor.document.save();
              } else {
                const result = await window.showWarningMessage(`File ${path} must be saved to run Actions.`, `Save`, `Save automatically`, `Cancel`);
                switch (result) {
                  case `Save`:
                    await openedEditor.document.save();
                    break;

                  case `Save automatically`:
                    config.autoSaveBeforeAction = true;
                    await IBMi.connectionManager.update(config);
                    await openedEditor.document.save();
                    break;

                  default:
                    return;
                }
              }
            }
          }

          if ([`member`, `streamfile`, `file`, 'object'].includes(scheme)) {
            return await runAction(instance, uris, action, method, browserItems, workspaceFolder);
          }
        }

      }
      else {
        window.showErrorMessage('Please connect to an IBM i first');
      }

      return false;
    }),

    commands.registerCommand(`code-for-ibmi.openErrors`, async (options: { qualifiedObject?: string, workspace?: WorkspaceFolder, keepDiagnostics?: boolean }) => {
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

      if (options.qualifiedObject) {
        // Value passed in via parameter
        inputPath = options.qualifiedObject;

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
          refreshDiagnosticsFromServer(instance, { library, object: nameDetail.name, extension: (nameDetail.ext.length > 1 ? nameDetail.ext.substring(1) : undefined), workspace: options.workspace }, options.keepDiagnostics);
        }
      }
    }),
  ]
}