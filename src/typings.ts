import { Ignore } from "ignore";
import { ConfigurationChangeEvent, Disposable, Uri, WorkspaceFolder } from "vscode";
import Instance from "./Instance";
import { SearchTools } from "./api/SearchTools";
import { ActionTools } from "./api/actions";
import { ComponentRegistry } from './api/components/manager';
import { ConnectionManager } from "./api/configuration/config/ConnectionManager";
import { DeploymentMethod, FileError } from "./api/types";
import { ViewSettings } from "./config/Configuration";
import { CustomEditor } from "./editors/customEditorProvider";
import { DeployTools } from "./filesystems/local/deployTools";
import { VscodeTools } from "./ui/Tools";
import { FrontendTables } from "./ui/frontendTables";
import { CustomUI } from "./webviews/CustomUI";

export interface CodeForIBMi {
  instance: Instance,
  customUI: () => CustomUI,
  customEditor: <T>(target: string, onSave: (data: T) => Promise<void>, onClosed?: () => void) => CustomEditor<T>,
  evfeventParser: (lines: string[]) => Map<string, FileError[]>,
  tools: typeof VscodeTools,
  frontendTables: typeof FrontendTables,
  viewSettings: typeof ViewSettings,
  deployTools: typeof DeployTools,
  actionTools: typeof ActionTools,
  componentRegistry: ComponentRegistry,
  connectionManager: ConnectionManager,
  searchTools: typeof SearchTools,
  onCodeForIBMiConfigurationChange: (props: string | string[], todo: (event: ConfigurationChangeEvent) => void) => Disposable
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
