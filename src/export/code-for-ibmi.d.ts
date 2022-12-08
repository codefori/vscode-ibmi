import * as vscode from "vscode";

export interface CodeForIBMi {
    instance: Instance
    baseContext: vscode.ExtensionContext
    CustomUI: object //CustomUI: typeof CustomUI
    Field: object //Field: typeof Field;
}

export interface Instance {
    getConnection(): IBMi | undefined
    setConfig(newConfig: Parameters): Promise<void>
    getConfig(): Parameters | undefined
    getContent(): IBMiContent | undefined
    getStorage(): Storage | undefined
    onEvent(event: 'connected', fnct: Function) : void
}

export interface IBMi {
    connect(connectionObject: ConnectionData): Promise<{ success: boolean, error?: any }>
    getConnectionName(): string
    getHost(): string
    getPort(): number
    getUser(): string
    remoteCommand(command: string, directory?: string): Promise<String | CommandResult>
    sendQsh(options: CommandData): Promise<CommandResult>
    sendCommand(options: CommandData): Promise<CommandResult>
    getTempRemote(key: string): string | undefined
    uploadFiles(files: {
        local: string | vscode.Uri;
        remote: string;
    }[]): Promise<void>
    downloadFile(localFile: string | vscode.Uri, remoteFile: string): Promise<void>
}

export interface ConnectionData {
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey: string | null;
    keepaliveInterval: number;
}

export interface Parameters extends ConnectionProfile {
    host: string;
    autoClearTempData: boolean;
    connectionProfiles: ConnectionProfile[];
    autoSortIFSShortcuts: boolean;
    enableSQL: boolean;
    tempLibrary: string;
    tempDir: string;
    sourceASP: string;
    sourceFileCCSID: string;
    autoConvertIFSccsid: boolean;
    hideCompileErrors: string[];
    enableSourceDates: boolean;
    sourceDateMode: "edit" | "diff";
    sourceDateGutter: boolean;
    encodingFor5250: string;
    terminalFor5250: string;
    setDeviceNameFor5250: boolean;
    connectringStringFor5250: string;
    autoSaveBeforeAction: boolean;
    showDescInLibList: boolean;
    [name: string]: any;
}

export interface ObjectFilters {
    name: string
    library: string
    object: string
    types: string[]
    member: string
    memberType: string
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

export type PathContent = Record<string, string[]>

export interface Storage {
    getSourceList(): PathContent
    setSourceList(sourceList: PathContent): Promise<void>
    getLastProfile(): string | undefined
    setLastProfile(profile: string): Promise<void>
    setPreviousCurLibs(previousCurLibs: string[]): Promise<void>
    getDeployment(): PathContent
    setDeployment(existingPaths: PathContent): Promise<void>
}

export type DB2Row = Record<string, string | number | null>;

export interface IBMiContent {
    downloadStreamfile(remotePath: string, localPath: string): Promise<string>
    writeStreamfile(originalPath: string, content: string): Promise<void | string | CommandResult>
    downloadMemberContent(asp: string | undefined, library: string, sourceFile: string, member: string): Promise<string>
    uploadMemberContent(asp: string | undefined, library: string, sourceFile: string, member: string, content: string | Uint8Array): Promise<boolean>
    runSQL(statement: string): Promise<DB2Row[]>
    getTable(library: string, file: string, member: string, deleteTable: boolean): Promise<object>
    getLibraryList(libraries: string[]): Promise<IBMiObject[]>
    getObjectList(filters: {
        library: string
        object?: string
        types?: string[]
    }, sortOrder?: string): Promise<{
        library: string
        name: string
        type: string
        text: string
        attribute: string
        count?: number
    }[]>
    getMemberList(library: string, sourceFile: string, member?: string | undefined, extension?: string): Promise<{
        asp?: string
        library: string
        file: string
        name: string
        extension: string
        recordLength: number
        text: string
    }[]>
    getFileList(remotePath: string): Promise<{
        type: "directory" | "streamfile";
        name: string
        path: string
    }[]>
}

export interface CommandResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export interface IBMiObject {
    library: string,
    name: string,
    type: string,
    text: string,
    attribute?: string
}