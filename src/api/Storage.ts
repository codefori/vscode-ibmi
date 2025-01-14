
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

export type LastConnection = {
  name: string
  timestamp: number
};

export type CachedServerSettings = {
  lastCheckedOnVersion: string | undefined;
  aspInfo: { [id: number]: string }
  qccsid: number | null;
  jobCcsid: number | null
  remoteFeatures: { [name: string]: string | undefined }
  remoteFeaturesKeys: string | null
  badDataAreasChecked: boolean | null
  libraryListValidated: boolean | null
  pathChecked?: boolean
  userDefaultCCSID: number | null
  debugConfigLoaded: boolean
  maximumArgsLength: number
} | undefined;

export abstract class Storage {
  protected readonly globalState: any;

  constructor() {
    this.globalState = new Map<string, any>();
  }

  keys(): readonly string[] {
    return Array.from(this.globalState.keys());
  }

  get<T>(key: string): T | undefined {
    return this.globalState.get(this.getStorageKey(key)) as T | undefined;
  }

  async set(key: string, value: any) {
    await this.globalState.set(this.getStorageKey(key), value);
  }

  getStorageKey(key: string): string {
    return key;
  }
}

export class CodeForIStorage {
  // private static instance: GlobalStorage;

  // static initialize(context: vscode.ExtensionContext) {
  //   if (!this.instance) {
  //     this.instance = new GlobalStorage(context);
  //   }
  // }

  // static get() {
  //   return this.instance;
  // }

  constructor(private internalStorage: Storage) {}

  protected getStorageKey(key: string): string {
    return key;
  }

  getLastConnections() {
    return this.internalStorage.get<LastConnection[]>("lastConnections");
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
    await this.internalStorage.set("lastConnections", lastConnections.sort((c1, c2) => c2.timestamp - c1.timestamp));
  }

  getServerSettingsCache(name: string) {
    return this.internalStorage.get<CachedServerSettings|undefined>(SERVER_SETTINGS_CACHE_KEY(name));
  }

  async setServerSettingsCache(name: string, serverSettings: CachedServerSettings) {
    await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), serverSettings);
  }

  async setServerSettingsCacheSpecific(name: string, newSettings: Partial<CachedServerSettings>) {
    await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), {
      ...this.getServerSettingsCache(name),
      ...newSettings
    });
  }

  async deleteServerSettingsCache(name: string) {
    await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), undefined);
  }

  async deleteStaleServerSettingsCache(connections: ConnectionData[]) {
    const validKeys = connections.map(connection => SERVER_SETTINGS_CACHE_KEY(connection.name));
    const currentKeys = this.internalStorage.keys();
    const keysToDelete = currentKeys.filter(key => key.startsWith(SERVER_SETTINGS_CACHE_PREFIX) && !validKeys.includes(key));
    for await (const key of keysToDelete) {
      await this.internalStorage.set(key, undefined);
    }
  }

  getPreviousSearchTerms() {
    return this.internalStorage.get<string[]>(PREVIOUS_SEARCH_TERMS_KEY) || [];
  }

  async addPreviousSearchTerm(term: string) {    
    await this.internalStorage.set(PREVIOUS_SEARCH_TERMS_KEY, [term].concat(this.getPreviousSearchTerms().filter(t => t !== term)));
  }

  async clearPreviousSearchTerms(){
    await this.internalStorage.set(PREVIOUS_SEARCH_TERMS_KEY, undefined);
  }

  getPreviousFindTerms() {
    return this.internalStorage.get<string[]>(PREVIOUS_FIND_TERMS_KEY) || [];
  }

  async addPreviousFindTerm(term: string) {
    await this.internalStorage.set(PREVIOUS_FIND_TERMS_KEY, [term].concat(this.getPreviousFindTerms().filter(t => t !== term)));
  }

  async clearPreviousFindTerms(){
    await this.internalStorage.set(PREVIOUS_FIND_TERMS_KEY, undefined);
  }
}

export class ConnectionStorage {
  private connectionName: string = "";
  constructor(private internalStorage: Storage) {}

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
    return this.internalStorage.get<PathContent>(SOURCE_LIST_KEY) || {};
  }

  async setSourceList(sourceList: PathContent) {
    await this.internalStorage.set(SOURCE_LIST_KEY, sourceList);
  }

  getLastProfile() {
    return this.internalStorage.get<string>(LAST_PROFILE_KEY);
  }

  async setLastProfile(lastProfile: string) {
    await this.internalStorage.set(LAST_PROFILE_KEY, lastProfile);
  }

  getPreviousCurLibs() {
    return this.internalStorage.get<string[]>(PREVIOUS_CUR_LIBS_KEY) || [];
  }

  async setPreviousCurLibs(previousCurLibs: string[]) {
    await this.internalStorage.set(PREVIOUS_CUR_LIBS_KEY, previousCurLibs);
  }

  getDeployment() {
    return this.internalStorage.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
  }

  async setDeployment(existingPaths: DeploymentPath) {
    await this.internalStorage.set(DEPLOYMENT_KEY, existingPaths);
  }

  getDebugCommands() {
    return this.internalStorage.get<DebugCommands>(DEBUG_KEY) || {};
  }

  setDebugCommands(existingCommands: DebugCommands) {
    return this.internalStorage.set(DEBUG_KEY, existingCommands);
  }

  getWorkspaceDeployPath(workspaceFolderFsPath: string) {
    const deployDirs = this.internalStorage.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
    return deployDirs[workspaceFolderFsPath].toLowerCase();
  }

  getRecentlyOpenedFiles() {
    return this.internalStorage.get<string[]>(RECENTLY_OPENED_FILES_KEY) || [];
  }

  async setRecentlyOpenedFiles(recentlyOpenedFiles: string[]) {
    await this.internalStorage.set(RECENTLY_OPENED_FILES_KEY, recentlyOpenedFiles);
  }

  async clearRecentlyOpenedFiles() {
    await this.internalStorage.set(RECENTLY_OPENED_FILES_KEY, undefined);
  }

  async grantExtensionAuthorisation(extensionId: string, displayName: string) {
    const extensions = this.getAuthorisedExtensions();
    if (!this.getExtensionAuthorisation(extensionId)) {
      extensions.push({
        id: extensionId,
        displayName: displayName,
        since: new Date().getTime(),
        lastAccess: new Date().getTime()
      });
      await this.internalStorage.set(AUTHORISED_EXTENSIONS_KEY, extensions);
    }
  }

  getExtensionAuthorisation(extensionId: string) {
    const authorisedExtension = this.getAuthorisedExtensions().find(authorisedExtension => authorisedExtension.id === extensionId);
    if (authorisedExtension) {
      authorisedExtension.lastAccess = new Date().getTime();
    }
    return authorisedExtension;
  }

  getAuthorisedExtensions(): AuthorisedExtension[] {
    return this.internalStorage.get<AuthorisedExtension[]>(AUTHORISED_EXTENSIONS_KEY) || [];
  }

  revokeAllExtensionAuthorisations() {
    this.revokeExtensionAuthorisation(...this.getAuthorisedExtensions());
  }

  revokeExtensionAuthorisation(...extensions: AuthorisedExtension[]) {
    const newExtensions = this.getAuthorisedExtensions().filter(ext => !extensions.includes(ext));
    return this.internalStorage.set(AUTHORISED_EXTENSIONS_KEY, newExtensions);
  }
}
