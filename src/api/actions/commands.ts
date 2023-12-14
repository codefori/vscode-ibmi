import { ExtensionContext, TreeItem, Uri, commands, window } from "vscode";
import Instance from "../Instance";
import { BrowserItem, Action, DeploymentMethod } from "../../typings";
import { ConnectionConfiguration } from "../Configuration";
import { CompileTools } from "./CompileTools";

export function connectActionCommands(context: ExtensionContext, instance: Instance) {
  context.subscriptions.push(
    commands.registerCommand(`code-for-ibmi.runAction`, async (target: TreeItem | BrowserItem | Uri, group?: any, action?: Action, method?: DeploymentMethod) => {
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
        const config = instance.getConfig();
        if (config) {
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
                  await ConnectionConfiguration.update(config);
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
            return await CompileTools.runAction(instance, uri, action, method, browserItem);
          }
        }
        else {
          window.showErrorMessage('Please connect to an IBM i first');
        }
      }

      return false;
    }),
  );
}