import { CustomUI } from "./webviews/CustomUI";
import Instance from "./Instance";
import { DeployTools } from "./filesystems/local/deployTools";
import { ComponentRegistry } from './api/components/manager';
import { DeploymentMethod, FileError } from "./api/types";
import { Ignore } from "ignore";
import { WorkspaceFolder } from "vscode";
import { VscodeTools } from "./ui/Tools";

export interface CodeForIBMi {
  instance: Instance,
  customUI: () => CustomUI,
  deployTools: typeof DeployTools,
  evfeventParser: (lines: string[]) => Map<string, FileError[]>,
  tools: typeof VscodeTools,
  componentRegistry: ComponentRegistry
}

export interface DeploymentParameters {
  method: DeploymentMethod
  workspaceFolder: WorkspaceFolder
  remotePath: string
  ignoreRules?: Ignore
}

export type EditorPath = string | { fsPath: string };

export * from "./api/types";
export * from "./ui/types";