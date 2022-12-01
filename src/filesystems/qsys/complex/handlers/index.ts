import { ExtensionContext } from "vscode";

import editHandler from "./editHandler";
import diffHandler from "./diffHandler";

export default function getHandler(context: ExtensionContext, id: string) {
  if (id === `diff`) {
    return diffHandler.begin(context);
  }

  return editHandler.begin(context);
}