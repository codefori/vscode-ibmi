import { FilterType } from "../../Filter";
import { DeploymentMethod, ConnectionData } from "../../types";

export type SourceDateMode = "edit" | "diff";
export type DefaultOpenMode = "browse" | "edit";
export type ReconnectMode = "always" | "never" | "ask";

export interface ConnectionConfig extends ConnectionProfile {
  host: string;
  autoClearTempData: boolean;
  connectionProfiles: ConnectionProfile[];
  commandProfiles: CommandProfile[];
  autoSortIFSShortcuts: boolean;
  tempLibrary: string;
  tempDir: string;
  sourceFileCCSID: string;
  autoConvertIFSccsid: boolean;
  hideCompileErrors: string[];
  enableSourceDates: boolean;
  sourceDateMode: SourceDateMode;
  sourceDateGutter: boolean;
  encodingFor5250: string;
  terminalFor5250: string;
  setDeviceNameFor5250: boolean;
  connectringStringFor5250: string;
  autoSaveBeforeAction: boolean;
  showDescInLibList: boolean;
  debugPort: string;
  debugSepPort: string;
  debugUpdateProductionFiles: boolean;
  debugEnableDebugTracing: boolean;
  readOnlyMode: boolean;
  quickConnect: boolean;
  defaultDeploymentMethod: DeploymentMethod | '';
  protectedPaths: string[];
  showHiddenFiles: boolean;
  lastDownloadLocation: string;
  [name: string]: any;
}

export interface ObjectFilters {
  name: string
  filterType: FilterType
  library: string
  object: string
  types: string[]
  member: string
  memberType: string
  protected: boolean
}

export interface CustomVariable {
  name: string
  value: string
}

export interface ConnectionProfile {
  name: string
  homeDirectory: string
  currentLibrary: string
  libraryList: string[]
  objectFilters: ObjectFilters[]
  ifsShortcuts: string[]
  customVariables: CustomVariable[]
}

export interface CommandProfile {
  name: string;
  command: string;
}

export interface StoredConnection {
  index: number,
  data: ConnectionData
};