import { FilterType } from "../../Filter";
import { Action, ConnectionData, DeploymentMethod } from "../../types";

export type DefaultOpenMode = "browse" | "edit";
export type ReconnectMode = "always" | "never" | "ask";
export type FilterDetails = "tooltip" | "description" | "both";

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
  ccsidConversionEnabled: boolean;
  ccsidConvertFrom: string;
  ccsidConvertTo: string;
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
  autoUpdateDirectoryPermissions: string;
  mapepireJavaVersion: string
  mapepireUseServer: boolean
  mapepireServerPort: number
  mapepireAllowSelfCert: boolean
  sqlJobNaming: string
  statusBarColor: string
  currentProfile?: string
  [name: string]: any;
}

// Global `code-for-ibmi.*` settings not related to a single connection
export interface GlobalConfiguration {
  recentlyOpenedFilesLimit: number;
  defaultOpenMode: DefaultOpenMode;
  autoReconnect: ReconnectMode;
  grepIgnoreDirs: string[];
  createLibraryOnBranchChange: boolean;
  clearDiagnosticOnEdit: boolean;
  clearErrorsBeforeBuild: boolean;
  'tables.itemsPerPage': number;
  'views.autoRefreshInterval': number;
  postActionView: 'task' | 'problems' | 'none';
  logCompileOutput: boolean;
  clearOutputEveryTime: boolean;
  persistOutputOnConnect: boolean;
  sortActionsBy: 'usage' | 'name' | 'config';
  'IfsBrowser.DragAndDropDefaultBehavior': 'ask' | 'copy' | 'move';
  autoRefresh: boolean;
  safeDeleteMode: boolean;
  'ObjectBrowser.showNamesInLowercase': boolean;
  'ObjectBrowser.sortObjectsByName': boolean;
  'ObjectBrowser.filterDetails': FilterDetails;
  autoOpenFile: boolean;
  'terminals.5250.openInEditorArea': boolean;
  'terminals.pase.openInEditorArea': boolean;
  actions: Action[];
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
  memberText?: string
  memberCreated?: string
  memberChanged?: string
  protected: boolean
}

export interface CustomVariable {
  name: string
  value: string
}

export interface ConnectionProfile {
  name: string
  homeDirectory: string
  currentLibrary?: string
  libraryList: string[]
  objectFilters: ObjectFilters[]
  ifsShortcuts: string[]
  customVariables: CustomVariable[]
  setLibraryListCommand?: string
  iasp?: string
  statusBarColor?: string
}

export interface StoredConnection {
  index: number,
  data: ConnectionData
};