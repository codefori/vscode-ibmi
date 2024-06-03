import { Ignore } from 'ignore';
import { MarkdownString, ProviderResult, Range, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, WorkspaceFolder } from "vscode";
import { ConnectionConfiguration } from './api/Configuration';
import { CustomUI } from "./api/CustomUI";
import Instance from "./api/Instance";
import { Tools } from "./api/Tools";
import { DeployTools } from "./api/local/deployTools";

export interface CodeForIBMi {
  instance: Instance,
  customUI: () => CustomUI,
  deployTools: typeof DeployTools,
  evfeventParser: (lines: string[]) => Map<string, FileError[]>,
  tools: typeof Tools
}

export type DeploymentMethod = "all" | "staged" | "unstaged" | "changed" | "compare";

export interface DeploymentParameters {
  method: DeploymentMethod
  workspaceFolder: WorkspaceFolder
  remotePath: string
  ignoreRules?: Ignore
}

export interface StandardIO {
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  stdin?: string;
}

/**
 * External interface for extensions to call `code-for-ibmi.runCommand`
 */
export type ActionType = "member" | "streamfile" | "object" | "file";
export type ActionRefresh = "no" | "parent" | "filter" | "browser";
export type ActionEnvironment = "ile" | "qsh" | "pase";

export enum CcsidOrigin {
  User = "user",
  System = "system",
};

export interface RemoteCommand {
  title?: string;
  command: string;
  environment?: ActionEnvironment;
  cwd?: string;
  env?: Record<string, string>;
  noLibList?: boolean
}

export interface CommandData extends StandardIO {
  command: string;
  directory?: string;
  env?: Record<string, string>;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  command?: string;
}

export interface Action {
  name: string;
  command: string;
  type?: ActionType;
  environment: ActionEnvironment;
  extensions?: string[];
  deployFirst?: boolean;
  postDownload?: string[];
  refresh?: ActionRefresh;
  runOnProtected?: boolean;
}

export interface ConnectionData {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  keepaliveInterval?: number;
}

export interface Server {
  name: string
}

export interface Profile {
  profile: string
}

export interface QsysPath {
  asp?: string,
  library: string,
  name: string,
}

export interface IBMiObject extends QsysPath {
  type: string,
  text: string,
  sourceFile?: boolean
  attribute?: string,
  sourceLength?: number
  size?: number
  created?: Date
  changed?: Date
  created_by?: string
  owner?: string
}

export interface IBMiMember {
  library: string
  file: string
  name: string
  extension: string
  recordLength?: number
  text?: string
  asp?: string
  lines?: number
  created?: Date
  changed?: Date
}

export interface IFSFile {
  type: "directory" | "streamfile"
  name: string
  path: string
  size?: number
  modified?: Date
  owner?: string
}

export interface IBMiError {
  code: string
  text: string
}

export interface FileError {
  sev: number
  lineNum: number
  toLineNum: number
  column: number
  toColumn: number
  text: string
  code: string
}

export interface QsysFsOptions {
  readonly?: boolean
}

export type IBMiEvent = "connected" | "disconnected" | "deployLocation" | "deploy"

export interface WithPath {
  path: string
}

export interface WithLibrary {
  library: string
}

export type FocusOptions = { select?: boolean; focus?: boolean; expand?: boolean | number }

export type BrowserItemParameters = {
  icon?: string
  color?: string
  state?: TreeItemCollapsibleState
  parent?: BrowserItem
}

export class BrowserItem extends TreeItem {
  constructor(label: string, readonly params?: BrowserItemParameters) {
    super(label, params?.state);
    this.iconPath = params?.icon ? new ThemeIcon(params.icon, params.color ? new ThemeColor(params.color) : undefined) : undefined;
  }

  get parent() {
    return this.params?.parent;
  }

  getChildren?(): ProviderResult<BrowserItem[]>;
  refresh?(): void;
  reveal?(options?: FocusOptions): Thenable<void>;
  getToolTip?(): Promise<MarkdownString | undefined>;
}

export interface FilteredItem {
  filter: ConnectionConfiguration.ObjectFilters
}

export interface ObjectItem extends FilteredItem, WithPath {
  object: IBMiObject
}

export interface MemberItem extends FilteredItem, WithPath {
  member: IBMiMember
}

export type IBMiMessage = {
  id: string
  text: string
}

export type IBMiMessages = {
  messages: IBMiMessage[]
  findId(id: string): IBMiMessage | undefined
}
export const OBJECT_BROWSER_MIMETYPE = "application/vnd.code.tree.objectbrowser";
export const IFS_BROWSER_MIMETYPE = "application/vnd.code.tree.ifsbrowser";

export type OpenEditableOptions = QsysFsOptions & { position?: Range };

export interface WrapResult {
  newStatements: string[];
  outStmf: string;
}

export type SpecialAuthorities = "*ALLOBJ" | "*AUDIT" | "*IOSYSCFG" | "*JOBCTL" | "*SAVSYS" | "*SECADM" | "*SERVICE" | "*SPLCTL";
export type AttrOperands = 'ACCESS_TIME' | 'ALLOC_SIZE' | 'ALLOC_SIZE_64' | 'ALWCKPWR' | 'ALWSAV' | 'ASP' | 'AUDIT' | 'AUTH_GROUP' | 'AUTH_LIST_NAME' | 'AUTH_OWNER' | 'AUTH_USERS' | 'CCSID' | 'CHANGE_TIME' | 'CHECKED_OUT' | 'CHECKED_OUT_USER' | 'CHECKED_OUT_TIME' | 'CODEPAGE' | 'CREATE_TIME' | 'CRTOBJAUD' | 'CRTOBJSCAN' | 'DATA_SIZE' | 'DATA_SIZE_64' | 'DIR_FORMAT' | 'DISK_STG_OPT' | 'EXTENDED_ATTR_SIZE' | 'FILE_FORMAT' | 'FILE_ID' | 'JOURNAL_APPLY_CHANGES' | 'JOURNAL_ID' | 'JOURNAL_LIBRARY' | 'JOURNAL_NAME' | 'JOURNAL_OPTIONS' | 'JOURNAL_RCVR_ASP' | 'JOURNAL_RCVR_LIBRARY' | 'JOURNAL_RCVR_NAME' | 'JOURNAL_ROLLBACK_ENDED' | 'JOURNAL_START_TIME' | 'JOURNAL_STATUS' | 'LOCAL_REMOTE' | 'MAIN_STG_OPT' | 'MODIFY_TIME' | 'MULT_SIGS' | 'OBJTYPE' | 'PC_ARCHIVE' | 'PC_HIDDEN' | 'PC_READ_ONLY' | 'PC_SYSTEM' | 'RSTDRNMUNL' | 'SCAN' | 'SCAN_BINARY' | 'SCAN_CCSID1' | 'SCAN_CCSID2' | 'SCAN_SIGS_DIFF' | 'SCAN_STATUS' | 'SGID' | 'SIGNED' | 'STG_FREE' | 'SUID' | 'SYSTEM_ARCHIVE' | 'SYSTEM_USE' | 'SYS_SIGNED' | 'UDFS_DEFAULT_FORMAT' | 'USAGE_DAYS_USED' | 'USAGE_LAST_USED_TIME' | 'USAGE_RESET_TIME';