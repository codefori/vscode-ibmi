
import * as vscode from 'vscode';
import { DeploymentMethod } from '../typings';
import { FilterType } from './Filter';

export type SourceDateMode = "edit" | "diff";
export type DefaultOpenMode = "browse" | "edit";

const getConfiguration = (): vscode.WorkspaceConfiguration => {
  return vscode.workspace.getConfiguration(`code-for-ibmi`);
}

export function onCodeForIBMiConfigurationChange<T>(props: string | string[], todo: (value: vscode.ConfigurationChangeEvent) => void) {
  const keys = (Array.isArray(props) ? props : Array.of(props)).map(key => `code-for-ibmi.${key}`);
  return vscode.workspace.onDidChangeConfiguration(async event => {
    if (keys.some(key => event.affectsConfiguration(key))) {
      todo(event);
    }
  })
}

export namespace GlobalConfiguration {
  export function get<T>(key: string): T | undefined {
    return getConfiguration().get<T>(key);
  }

  export function set(key: string, value: any) {
    return getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
  }  
}

export namespace ConnectionConfiguration {
  export interface Parameters extends ConnectionProfile {
    host: string;
    autoClearTempData: boolean;
    connectionProfiles: ConnectionProfile[];
    commandProfiles: CommandProfile[];
    autoSortIFSShortcuts: boolean;
    enableSQL: boolean;
    tempLibrary: string;
    tempDir: string;
    sourceASP: string;
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
    debugCertDirectory: string;
    debugPort: string;
    debugIsSecure: boolean;
    debugUpdateProductionFiles: boolean;
    debugEnableDebugTracing: boolean;
    readOnlyMode: boolean;
    quickConnect: boolean;
    defaultDeploymentMethod: DeploymentMethod | '';
    protectedPaths: string[];
    showHiddenFiles: boolean;
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

  function getConnectionSettings(): Parameters[] {
    return getConfiguration().get<Parameters[]>(`connectionSettings`) || [];
  }

  function initialize(parameters: Partial<Parameters>): Parameters {
    return {
      ...parameters,
      name: parameters.name!,
      host: parameters.host || '',
      objectFilters: parameters.objectFilters || [],
      libraryList: parameters.libraryList || [],
      autoClearTempData: parameters.autoClearTempData || false,
      customVariables: parameters.customVariables || [],
      connectionProfiles: parameters.connectionProfiles || [],
      commandProfiles: parameters.commandProfiles || [],
      ifsShortcuts: parameters.ifsShortcuts || [],
      /** Default auto sorting of shortcuts to off  */
      autoSortIFSShortcuts: parameters.autoSortIFSShortcuts || false,
      homeDirectory: parameters.homeDirectory || `.`,
      /** Undefined means not created, so default to on */
      enableSQL: (parameters.enableSQL === true || parameters.enableSQL === undefined),
      tempLibrary: parameters.tempLibrary || `ILEDITOR`,
      tempDir: parameters.tempDir || `/tmp`,
      currentLibrary: parameters.currentLibrary || ``,
      sourceASP: parameters.sourceASP || ``,
      sourceFileCCSID: parameters.sourceFileCCSID || `*FILE`,
      autoConvertIFSccsid: (parameters.autoConvertIFSccsid === true),
      hideCompileErrors: parameters.hideCompileErrors || [],
      enableSourceDates: parameters.enableSourceDates === true,
      sourceDateMode: parameters.sourceDateMode || "diff",
      sourceDateGutter: parameters.sourceDateGutter === true,
      encodingFor5250: parameters.encodingFor5250 || `default`,
      terminalFor5250: parameters.terminalFor5250 || `default`,
      setDeviceNameFor5250: (parameters.setDeviceNameFor5250 === true),
      connectringStringFor5250: parameters.connectringStringFor5250 || `localhost`,
      autoSaveBeforeAction: (parameters.autoSaveBeforeAction === true),
      showDescInLibList: (parameters.showDescInLibList === true),
      debugCertDirectory: (parameters.debugCertDirectory || "/QIBM/ProdData/IBMiDebugService/bin/certs"),
      debugPort: (parameters.debugPort || "8005"),
      debugIsSecure: (parameters.debugIsSecure === true),
      debugUpdateProductionFiles: (parameters.debugUpdateProductionFiles === true),
      debugEnableDebugTracing: (parameters.debugEnableDebugTracing === true),
      readOnlyMode: (parameters.readOnlyMode === true),
      quickConnect: (parameters.quickConnect === true || parameters.quickConnect === undefined),
      defaultDeploymentMethod: parameters.defaultDeploymentMethod || ``,
      protectedPaths: (parameters.protectedPaths || []),
      showHiddenFiles: (parameters.showHiddenFiles === true || parameters.showHiddenFiles === undefined),
    }
  }

  async function updateAll(connections: Parameters[]) {
    await getConfiguration().update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
  }

  export async function update(parameters: Parameters) {
    if(parameters?.name) {
      const connections = getConnectionSettings();
      connections.filter(conn => conn.name === parameters.name).forEach(conn => Object.assign(conn, parameters));
      await updateAll(connections);
    }
  }

  /**
   * Will load an existing config if it exists, otherwise will create it with default values.
   * @param name Connection name string for configuration
   * @returns the parameters
   */
  export async function load(name: string): Promise<Parameters> {
    let connections = getConnectionSettings();
    let existingConfig = connections.find(conn => conn.name === name);
    let config: Parameters;
    if (existingConfig) {
      config = initialize(existingConfig);
    } else {
      config = initialize({ name: name });
      connections.push(config);
      await updateAll(connections);
    }

    return config;
  }
}
