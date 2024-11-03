import vscode, { l10n } from "vscode";
import { GlobalConfiguration, ReconnectMode } from "../../api/Configuration";
import { Tools } from "../../api/Tools";

/**
 * Called when a member/streamfile is left open when VS Code is closed and re-opened to reconnect (or not) to the previous IBM i, based on the `autoReconnect` global configuration value.
 * If the user choses not to reconnect, the editor tab will be closed.
 * 
 * @param uri the uri of the file triggerring the reconnection attempt
 * @returns `true` if the user choses to reconnect, `false` otherwise.
 */
export async function reconnectFS(uri: vscode.Uri) {
  const reconnect = GlobalConfiguration.get<ReconnectMode>("autoReconnect") || "ask";
  let doReconnect = false;
  switch (reconnect) {
    case "always":
      doReconnect = true;
      break;

    case "ask":
      if (await vscode.window.showInformationMessage(l10n.t("Do you want to reconnect and open {0}?", uri.path.split('/').reverse()?.[0]), l10n.t("Reconnect"))) {
        doReconnect = true;
      }
      break;

    default:
  }

  if (doReconnect) {
    await vscode.commands.executeCommand(`code-for-ibmi.connectToPrevious`);    
    return true;
  }
  else {
    for(const tab of Tools.findUriTabs(uri)){
      await vscode.window.tabGroups.close(tab);
    }
    return false;
  }
}