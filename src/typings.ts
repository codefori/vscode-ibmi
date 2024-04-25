import { Ignore } from 'ignore';
import { ProviderResult, Range, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, WorkspaceFolder } from "vscode";
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
  memberCount?: number
  sourceLength?: number
  CCSID?: number
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

export type SpecialAuthorities = "*ALLOBJ" | "*AUDIT" | "*IOSYSCFG" | "*JOBCTL" | "*SAVSYS" | "*SECADM" | "*SERVICE" | "*SPLCTL";