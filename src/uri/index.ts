import vscode from "vscode";
import { instance } from "../instantiate";
import { Code4iUriHandler } from "./handler";

export function registerURIHandler(context: vscode.ExtensionContext, ...handlers: Code4iUriHandler[]) {
  context.subscriptions.push(vscode.window.registerUriHandler({
    handleUri: (uri) => {
      handlers.filter(handler => handler.canHandle(uri.path)).forEach(handler => handler.handle(uri, instance.getConnection()));
    }
  }));
}