import { Ignore } from 'ignore';
import { ProviderResult, ThemeIcon, TreeItem, TreeItemCollapsibleState, WorkspaceFolder } from "vscode";
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
export interface RemoteCommand {
  title?: string;
  command: string;
  environment?: "ile" | "qsh" | "pase";
  cwd?: string;
  env?: Record<string, string>;
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

export type ActionType = "member" | "streamfile" | "object" | "file";
export type ActionEnvironment = "ile" | "qsh" | "pase";

export interface Action {
  name: string;
  command: string;
  type?: ActionType;
  environment: ActionEnvironment;
  extensions?: string[];
  deployFirst?: boolean;
  postDownload?: string[];
}

export interface ConnectionData {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
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
  library: string,
  name: string,
}

export interface IBMiObject extends QsysPath {
  type: string,
  text: string,
  attribute?: string
}

export interface IBMiFile extends IBMiObject {
  count?: number
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
  modified?: Date | string
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

export interface Library extends WithPath { }

export type FocusOptions = { select?: boolean; focus?: boolean; expand?: boolean | number }

export type BrowserItemParameters = {
  icon?: string
  state?: TreeItemCollapsibleState
  parent?: BrowserItem
}

export class BrowserItem extends TreeItem {
  constructor(label: string, readonly params?: BrowserItemParameters) {
    super(label, params?.state);
    this.iconPath = params?.icon ? new ThemeIcon(params.icon) : undefined;
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

export interface SourcePhysicalFileItem extends FilteredItem, WithPath {
  sourceFile: IBMiFile
}

export interface MemberItem extends FilteredItem, WithPath {
  member: IBMiMember
}