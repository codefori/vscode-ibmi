import path from "path";
import vscode, { l10n } from "vscode";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { ReconnectMode } from "../../typings";
import { VscodeTools } from "../../ui/Tools";

let createOnConnectPromise: (connection: string) => Promise<boolean>;
export function initializeFSUtils(context: vscode.ExtensionContext) {
  createOnConnectPromise = (connection) => {
    return new Promise<boolean>((resolve) => instance.subscribe(context, "connected", "Restore previously opened editor", () => resolve(instance.getConnection()?.currentConnectionName === connection), true));
  }
}

/**
 * Called when a member/streamfile is left open when VS Code is closed and re-opened to reconnect (or not) to the previous IBM i, based on the `autoReconnect` global configuration value.
 * If the user choses not to reconnect, the editor tab will be closed.
 * 
 * @param uri the uri of the file triggerring the reconnection attempt
 * @returns `true` if the user choses to reconnect, `false` otherwise.
 */
export async function reconnectFS(uri: vscode.Uri) {
  const reconnect = IBMi.connectionManager.get<ReconnectMode>("autoReconnect") || "ask";
  let doReconnect = false;
  switch (reconnect) {
    case "always":
      doReconnect = true;
      break;

    case "ask":
      const lastConnection = IBMi.GlobalStorage.getLastConnections()?.at(0)?.name;
      if (lastConnection) {
        const answer = await Promise.race([
          vscode.window.showInformationMessage(l10n.t("Do you want to reconnect to {0} and open {1}?", lastConnection, path.basename(uri.path)), l10n.t("Reconnect")),
          createOnConnectPromise(lastConnection)
        ]);
        if (answer === true) {
          //createOnConnectPromise resolved first
          return true;
        }
        else if (typeof answer === "string") {
          //Dialog was answered
          doReconnect = true
        }
      }
      break;

    default:
  }

  if (doReconnect) {
    return await vscode.commands.executeCommand<boolean>(`code-for-ibmi.connectToPrevious`);
  }
  else {
    for (const tab of VscodeTools.findUriTabs(uri)) {
      await vscode.window.tabGroups.close(tab);
    }
    return false;
  }
}