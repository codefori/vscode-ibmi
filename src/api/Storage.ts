import vscode from 'vscode';

const PREVIOUS_CUR_LIBS_KEY = `prevCurLibs`;
const LAST_PROFILE_KEY = `currentProfile`;
const SOURCE_LIST_KEY = `sourceList`;
const DEPLOYMENT_KEY = `deployment`;
const DEBUG_KEY = `debug`

export type PathContent = Record<string, string[]>;
export type DeploymentPath = Record<string, string>;
export type DebugCommands = Record<string, string>;

export class Storage {
  constructor(readonly context : vscode.ExtensionContext, readonly connectionName: string) {
  }

  private get<T>(key: string) : T | undefined {
    return this.context.globalState.get<T>(`${this.connectionName}.${key}`);
  }

  private async set(key : string, value: any) {
    await this.context.globalState.update(`${this.connectionName}.${key}`, value);
  }

  getSourceList() {
    return this.get<PathContent>(SOURCE_LIST_KEY) || {};
  }

  async setSourceList(sourceList : PathContent) {
    await this.set(SOURCE_LIST_KEY, sourceList);
  }

  getLastProfile() {
    return this.get<string>(LAST_PROFILE_KEY);
  }

  async setLastProfile(lastProfile : string) {
    await this.set(LAST_PROFILE_KEY, lastProfile);
  }

  getPreviousCurLibs() {
    return this.get<string[]>(PREVIOUS_CUR_LIBS_KEY) || [];
  }

  async setPreviousCurLibs(previousCurLibs : string[]) {
    await this.set(PREVIOUS_CUR_LIBS_KEY, previousCurLibs);
  }

  getDeployment() {
    return this.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
  }

  async setDeployment(existingPaths : DeploymentPath) {
    await this.set(DEPLOYMENT_KEY, existingPaths);
  }

  getDebugCommands() {
    return this.get<DebugCommands>(DEBUG_KEY) || {};
  }

  setDebugCommands(existingCommands: DebugCommands) {
    return this.set(DEBUG_KEY, existingCommands);
  }
}