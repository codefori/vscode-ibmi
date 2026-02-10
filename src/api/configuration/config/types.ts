import { FilterType } from "../../Filter";
import { ConnectionData, DeploymentMethod } from "../../types";

export type DefaultOpenMode = "browse" | "edit";
export type ReconnectMode = "always" | "never" | "ask";

export interface ConnectionConfig extends ConnectionProfile {
  host: string;
  autoClearTempData: boolean;
  connectionProfiles: ConnectionProfile[];
  autoSortIFSShortcuts: boolean;
  tempLibrary: string;
  tempDir: string;
  sourceFileCCSID: string;
  autoConvertIFSccsid: boolean;
  hideCompileErrors: string[];
  enableSourceDates: boolean;
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
  debugIgnoreCertificateErrors: boolean;
  readOnlyMode: boolean;
  quickConnect: boolean;
  defaultDeploymentMethod: DeploymentMethod | '';
  protectedPaths: string[];
  showHiddenFiles: boolean;
  secureSQL: boolean;
  keepActionSpooledFiles: boolean;
  mapepireJavaVersion: string
  currentProfile?: string;
  currentProfileType?: ProfileType;
  currentProfileLastKnownUpdate?: number;
  [name: string]: any;
}

export interface RemoteConfigFile {
  codefori?: Partial<ConnectionConfig>;
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

export type AnyConnectionProfile = | LocalConnectionProfile | ServerConnectionProfile

export type ProfileType = 'local' | 'server';

export type ProfileState = 'In Sync' | 'Modified' | 'Out of Sync';

export interface LocalConnectionProfile extends ConnectionProfile {
  type: 'local';
}

export interface ServerConnectionProfile extends ConnectionProfile {
  type: 'server';
  state: ProfileState;
}

export interface ConnectionProfile {
  name: string;
  homeDirectory?: string;
  currentLibrary: string;
  libraryList: string[];
  objectFilters: ObjectFilters[];
  ifsShortcuts: string[];
  customVariables: CustomVariable[];
  setLibraryListCommand?: string;
  lastUpdated?: number;
}

export interface StoredConnection {
  index: number,
  data: ConnectionData
};