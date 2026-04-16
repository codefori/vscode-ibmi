import { Ignore } from "ignore";
import { Uri, WorkspaceFolder } from "vscode";
import Instance from "./Instance";
import { ComponentRegistry } from './api/components/manager';
import { ConnectionManager } from "./api/configuration/config/ConnectionManager";
import { DeploymentMethod, FileError } from "./api/types";
import { CustomEditor } from "./editors/customEditorProvider";
import { DeployTools } from "./filesystems/local/deployTools";
import { ActionTools } from "./api/actions";
import { VscodeTools } from "./ui/Tools";
import { SearchTools } from "./api/SearchTools";
import { CustomUI } from "./webviews/CustomUI";

export interface CodeForIBMi {
  instance: Instance,
  customUI: () => CustomUI,
  customEditor: <T>(target: string, onSave: (data: T) => Promise<void>, onClosed?: () => void) => CustomEditor<T>,
  evfeventParser: (lines: string[]) => Map<string, FileError[]>,
  tools: typeof VscodeTools,
  deployTools: typeof DeployTools,
  actionTools: typeof ActionTools,
  componentRegistry: ComponentRegistry,
  connectionManager: ConnectionManager,
  searchTools: typeof SearchTools
}

export interface DeploymentParameters {
  method: DeploymentMethod
  workspaceFolder: WorkspaceFolder
  remotePath: string
  ignoreRules?: Ignore
  selectedFiles?: Uri[]
}

export * from "./api/types";
export * from "./ui/types";

