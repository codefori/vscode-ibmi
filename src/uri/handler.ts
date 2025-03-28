import vscode from "vscode";
import IBMi from "../api/IBMi";

export type Code4iUriHandler = {
  canHandle(path: string): boolean;
  handle(uri: vscode.Uri, connection?: IBMi): void | Promise<void>;
}