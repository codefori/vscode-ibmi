import vscode from 'vscode';
import { ConnectionData } from '../typings';

const PREVIOUS_CUR_LIBS_KEY = `prevCurLibs`;
const LAST_PROFILE_KEY = `currentProfile`;
const SOURCE_LIST_KEY = `sourceList`;
const DEPLOYMENT_KEY = `deployment`;
const DEBUG_KEY = `debug`;
const SERVER_SETTINGS_CACHE_PREFIX = `serverSettingsCache_`;
const SERVER_SETTINGS_CACHE_KEY = (name: string) => SERVER_SETTINGS_CACHE_PREFIX + name;
const PREVIOUS_SEARCH_TERMS_KEY = `prevSearchTerms`;
const PREVIOUS_FIND_TERMS_KEY = `prevFindTerms`;
const RECENTLY_OPENED_FILES_KEY = `recentlyOpenedFiles`;
const AUTHORISED_EXTENSIONS_KEY = `authorisedExtensions`

export type PathContent = Record<string, string[]>;
export type DeploymentPath = Record<string, string>;
export type DebugCommands = Record<string, string>;

type AuthorisedExtension = {
  id: string
  displayName: string
  since: number
  lastAccess: number
}

abstract class Storage {
  protected readonly globalState;

  constructor(context: vscode.ExtensionContext) {
    this.globalState = context.globalState;
  }

  protected keys(): readonly string[] {
    return this.globalState.keys();
  }

  protected get<T>(key: string): T | undefined {
    return this.globalState.get(this.getStorageKey(key)) as T | undefined;
  }

  protected async set(key: string, value: any) {
    await this.globalState.update(this.getStorageKey(key), value);
  }

  protected abstract getStorageKey(key: string): string;
}

export type LastConnection = {
  name: string
  timestamp: number
};

export type CachedServerSettings = {
  aspInfo: { [id: number]: string }
  qccsid: number | null;
  jobCcsid: number | null
  remoteFeatures: { [name: string]: string | undefined }
  remoteFeaturesKeys: string | null
  variantChars: { american: string, local: string }
  badDataAreasChecked: boolean | null
  libraryListValidated: boolean | null
  pathChecked?: boolean
  userDefaultCCSID: number | null
  debugConfigLoaded: boolean
} | undefined;

export class GlobalStorage extends Storage {
  private static instance: GlobalStorage;

  static initialize(context: vscode.ExtensionContext) {
    if (!this.instance) {
      this.instance = new GlobalStorage(context);
    }
  }

  static get() {
    return this.instance;
  }

  private constructor(context: vscode.ExtensionContext) {
    super(context);
  }

  protected getStorageKey(key: string): string {
    return key;
  }

  getLastConnections() {
    return this.get<LastConnection[]>("lastConnections");
  }

  async setLastConnection(name: string) {
    const lastConnections = this.getLastConnections() || [];
    const connection = lastConnections?.find(c => c.name === name);
    if (connection) {
      connection.timestamp = Date.now();
    }
    else {
      lastConnections?.push({ name, timestamp: Date.now() });
    }
    await this.setLastConnections(lastConnections);
  }

  async setLastConnections(lastConnections: LastConnection[]) {
    await this.set("lastConnections", lastConnections.sort((c1, c2) => c2.timestamp - c1.timestamp));
  }

  getServerSettingsCache(name: string) {
    return this.get<CachedServerSettings>(SERVER_SETTINGS_CACHE_KEY(name));
  }

  async setServerSettingsCache(name: string, serverSettings: CachedServerSettings) {
    await this.set(SERVER_SETTINGS_CACHE_KEY(name), serverSettings);
  }

  async setServerSettingsCacheSpecific(name: string, newSettings: Partial<CachedServerSettings>) {
    await this.set(SERVER_SETTINGS_CACHE_KEY(name), {
      ...this.getServerSettingsCache(name),
      ...newSettings
    });
  }

  async deleteServerSettingsCache(name: string) {
    await this.set(SERVER_SETTINGS_CACHE_KEY(name), undefined);
  }

  async deleteStaleServerSettingsCache(connections: ConnectionData[]) {
    const validKeys = connections.map(connection => SERVER_SETTINGS_CACHE_KEY(connection.name));
    const currentKeys = this.keys();
    const keysToDelete = currentKeys.filter(key => key.startsWith(SERVER_SETTINGS_CACHE_PREFIX) && !validKeys.includes(key));
    for await (const key of keysToDelete) {
      await this.set(key, undefined);
    }
  }

  getPreviousSearchTerms() {
    return this.get<string[]>(PREVIOUS_SEARCH_TERMS_KEY) || [];
  }

  async addPreviousSearchTerm(term: string) {    
    await this.set(PREVIOUS_SEARCH_TERMS_KEY, [term].concat(this.getPreviousSearchTerms().filter(t => t !== term)));
  }

  async clearPreviousSearchTerms(){
    await this.set(PREVIOUS_SEARCH_TERMS_KEY, undefined);
  }

  getPreviousFindTerms() {
    return this.get<string[]>(PREVIOUS_FIND_TERMS_KEY) || [];
  }

  async addPreviousFindTerm(term: string) {
    await this.set(PREVIOUS_FIND_TERMS_KEY, [term].concat(this.getPreviousFindTerms().filter(t => t !== term)));
  }

  async clearPreviousFindTerms(){
    await this.set(PREVIOUS_FIND_TERMS_KEY, undefined);
  }
}

export class ConnectionStorage extends Storage {
  private connectionName: string = "";
  constructor(context: vscode.ExtensionContext) {
    super(context);
  }

  get ready(): boolean {
    if (this.connectionName) {
      return true;
    }
    else {
      return false;
    }
  }

  setConnectionName(connectionName: string) {
    this.connectionName = connectionName;
  }

  protected getStorageKey(key: string): string {
    return `${this.connectionName}.${key}`;
  }

  getSourceList() {
    return this.get<PathContent>(SOURCE_LIST_KEY) || {};
  }

  async setSourceList(sourceList: PathContent) {
    await this.set(SOURCE_LIST_KEY, sourceList);
  }

  getLastProfile() {
    return this.get<string>(LAST_PROFILE_KEY);
  }

  async setLastProfile(lastProfile: string) {
    await this.set(LAST_PROFILE_KEY, lastProfile);
  }

  getPreviousCurLibs() {
    return this.get<string[]>(PREVIOUS_CUR_LIBS_KEY) || [];
  }

  async setPreviousCurLibs(previousCurLibs: string[]) {
    await this.set(PREVIOUS_CUR_LIBS_KEY, previousCurLibs);
  }

  getDeployment() {
    return this.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
  }

  async setDeployment(existingPaths: DeploymentPath) {
    await this.set(DEPLOYMENT_KEY, existingPaths);
  }

  getDebugCommands() {
    return this.get<DebugCommands>(DEBUG_KEY) || {};
  }

  setDebugCommands(existingCommands: DebugCommands) {
    return this.set(DEBUG_KEY, existingCommands);
  }

  getWorkspaceDeployPath(workspaceFolder: vscode.WorkspaceFolder) {
    const deployDirs = this.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
    return deployDirs[workspaceFolder.uri.fsPath].toLowerCase();
  }

  getRecentlyOpenedFiles() {
    return this.get<string[]>(RECENTLY_OPENED_FILES_KEY) || [];
  }

  async setRecentlyOpenedFiles(recentlyOpenedFiles: string[]) {
    await this.set(RECENTLY_OPENED_FILES_KEY, recentlyOpenedFiles);
  }

  async clearRecentlyOpenedFiles() {
    await this.set(RECENTLY_OPENED_FILES_KEY, undefined);
  }

  async grantExtensionAuthorisation(extension: vscode.Extension<any>) {
    const extensions = this.getAuthorisedExtensions();
    if (!this.getExtensionAuthorisation(extension)) {
      extensions.push({
        id: extension.id,
        displayName: extension.packageJSON.displayName,
        since: new Date().getTime(),
        lastAccess: new Date().getTime()
      });
      await this.set(AUTHORISED_EXTENSIONS_KEY, extensions);
    }
  }

  getExtensionAuthorisation(extension: vscode.Extension<any>) {
    const authorisedExtension = this.getAuthorisedExtensions().find(authorisedExtension => authorisedExtension.id === extension.id);
    if (authorisedExtension) {
      authorisedExtension.lastAccess = new Date().getTime();
    }
    return authorisedExtension;
  }

  getAuthorisedExtensions(): AuthorisedExtension[] {
    return this.get<AuthorisedExtension[]>(AUTHORISED_EXTENSIONS_KEY) || [];
  }

  revokeAllExtensionAuthorisations() {
    this.revokeExtensionAuthorisation(...this.getAuthorisedExtensions());
  }

  revokeExtensionAuthorisation(...extensions: AuthorisedExtension[]) {
    const newExtensions = this.getAuthorisedExtensions().filter(ext => !extensions.includes(ext));
    return this.set(AUTHORISED_EXTENSIONS_KEY, newExtensions);
  }
}
