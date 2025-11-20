import vscode from "vscode";
import { FocusOptions } from "../../../typings";
import { BrowserItem } from "../../types";

export class ContextItem extends BrowserItem {
  async refresh() {
    await vscode.commands.executeCommand("code-for-ibmi.environment.refresh.item", this);
  }

  reveal(options?: FocusOptions) {
    return vscode.commands.executeCommand<void>(`code-for-ibmi.environment.reveal`, this, options);
  }
}