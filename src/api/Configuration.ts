
import * as vscode from 'vscode';
import { Parameters } from '../export/code-for-ibmi';

const getConfiguration = (): vscode.WorkspaceConfiguration => {
  return vscode.workspace.getConfiguration(`code-for-ibmi`);
}

export namespace GlobalConfiguration {
  export function get<T>(prop: string): T | undefined {
    return getConfiguration().get<T>(prop);
  }

  export function set(key: string, value: any) {
    return getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
  }
}

export namespace ConnectionConfiguration {
  

  function getConnectionSettings(): Parameters[] {
    return getConfiguration().get<Parameters[]>(`connectionSettings`) || [];
  }

  function initialize(parameters: Partial<Parameters>) : Parameters{
    return {
      ...parameters,
      name : parameters.name!,
      host : parameters.host || '',
      objectFilters : parameters.objectFilters || [],
      libraryList : parameters.libraryList || [],
      autoClearTempData : parameters.autoClearTempData || false,
      customVariables : parameters.customVariables || [],
      connectionProfiles : parameters.connectionProfiles || [],
      ifsShortcuts : parameters.ifsShortcuts || [],
      /** Default auto sorting of shortcuts to off  */
      autoSortIFSShortcuts : parameters.autoSortIFSShortcuts || false,
      homeDirectory : parameters.homeDirectory || `.`,
      /** Undefined means not created, so default to on */
      enableSQL : (parameters.enableSQL === true || parameters.enableSQL === undefined),
      tempLibrary : parameters.tempLibrary || `ILEDITOR`,
      tempDir : parameters.tempDir || `/tmp`,
      currentLibrary : parameters.currentLibrary || ``,
      sourceASP : parameters.sourceASP || ``,
      sourceFileCCSID : parameters.sourceFileCCSID || `*FILE`,
      autoConvertIFSccsid : (parameters.autoConvertIFSccsid === true),
      hideCompileErrors : parameters.hideCompileErrors || [],
      enableSourceDates : parameters.enableSourceDates === true,
      sourceDateMode : parameters.sourceDateMode || "edit",
      sourceDateGutter : parameters.sourceDateGutter === true,
      encodingFor5250 : parameters.encodingFor5250 || `default`,
      terminalFor5250 : parameters.terminalFor5250 || `default`,
      setDeviceNameFor5250 : (parameters.setDeviceNameFor5250 === true),
      connectringStringFor5250 : parameters.connectringStringFor5250 || `localhost`,
      autoSaveBeforeAction : (parameters.autoSaveBeforeAction === true),
      showDescInLibList : (parameters.showDescInLibList === true),
    }
  }

  async function updateAll(connections: Parameters[]) {
    await getConfiguration().update(`connectionSettings`, connections, vscode.ConfigurationTarget.Global);
  }

  export async function update(parameters: Parameters) {
    let connections = getConnectionSettings();
    connections.filter(conn => conn.name === parameters.name).forEach(conn => Object.assign(conn, parameters));
    await updateAll(connections);
  }

  /**
   * Will load an existing config if it exists, otherwise will create it with default values.
   * @param name Connection name string for configuration
   * @returns the parameters
   */
  export async function load(name: string): Promise<Parameters> {
    let connections = getConnectionSettings();
    let existingConfig = connections.find(conn => conn.name === name);
    let config : Parameters;
    if(existingConfig) {
      config = initialize(existingConfig);
    } else {
      config = initialize({name: name});
      connections.push(config);
      await updateAll(connections);
    }

    return config;
  }
}