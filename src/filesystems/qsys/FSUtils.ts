import vscode, { l10n } from "vscode";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { ReconnectMode } from "../../typings";

export let restoreEditors: Promise<boolean> | undefined;

export function handleEditorsLeftOpened(context: vscode.ExtensionContext) {
  const reconnect = IBMi.connectionManager.get<ReconnectMode>("autoReconnect") || "ask";

  if (reconnect !== "never") {
    const editorsLeftOpened = vscode.window.tabGroups.all
      .flatMap(group => group.tabs)
      .filter(tab => tab.input instanceof vscode.TabInputText && ["member", "streamfile"].includes(tab.input.uri.scheme));

    const lastConnection = IBMi.GlobalStorage.getLastConnections()?.at(0)?.name;
    if (editorsLeftOpened.length && lastConnection) {
      const promises: PromiseLike<boolean>[] = [new Promise<boolean>((resolve) => instance.subscribe(context, "connected", "Restore previously opened editor", () => resolve(instance.getConnection()?.currentConnectionName === lastConnection), true))];
      if (reconnect === "ask") {
        promises.push(
          vscode.window.showInformationMessage(l10n.t("{0} editors were left opened; do you want to reconnect to {1} and restore them?", editorsLeftOpened.length, lastConnection), l10n.t("Reconnect"))
            .then(reply => reply ? vscode.commands.executeCommand<boolean>(`code-for-ibmi.connectToPrevious`) : false)
        );
      }
      else {
        vscode.commands.executeCommand<boolean>(`code-for-ibmi.connectToPrevious`);
      }
      restoreEditors = Promise.race(promises).then(restore => {
        if (!restore) {
          return vscode.window.tabGroups.close(editorsLeftOpened).then(() => false);
        }
        return restore;
      });
    }
  }
}

/**
 * Called when a member/streamfile is left open when VS Code is closed and re-opened to reconnect (or not) to the previous IBM i, based on the `autoReconnect` global configuration value.
 * If the user choses not to reconnect, the editor tab will be closed.
 * 
 * @returns `true` if the user has chose to reconnect, `false` otherwise.
 */
export async function waitOnReconnect() {
  return restoreEditors ? await restoreEditors : false;
}