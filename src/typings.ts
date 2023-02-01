import { ExtensionContext, Uri } from "vscode";
import Instance from "./api/Instance";
import { Ignore } from 'ignore'

export interface CodeForIBMi {
  instance: Instance,
  baseContext: ExtensionContext,
  CustomUI: object, //CustomUI: typeof CustomUI
  Field: object //Field: typeof Field;
  deploy: (parameters: DeploymentParameters) => Promise<boolean>
  evfeventParser: (lines: string[]) => Map<string, FileError[]>
}

export enum DeploymentMethod {
  "all",
  "staged",
  "unstaged",
  "changed",
  "compare"
}

export interface DeploymentParameters {
  method: DeploymentMethod
  localFolder: Uri
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
  command: string;
  environment?: "ile" | "qsh" | "pase";
  cwd?: string;
  env?: { [name: string]: string };
}

export interface CommandData extends StandardIO {
  command: string;
  directory?: string;
  env?: { [name: string]: string };
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
  type?: "member" | "streamfile" | "object" | "file";
  environment: "ile" | "qsh" | "pase";
  extensions: string[];
  deployFirst?: boolean;
  postDownload?: string[];
}

export interface ConnectionData {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey: string | null;
  keepaliveInterval?: number;
}

export interface Server {
  name: string
}

export interface Profile {
  profile: string
}

export interface IBMiObject {
  library: string,
  name: string,
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
  recordLength: number
  text: string
  asp?: string
}

export interface IFSFile {
  type: "directory" | "streamfile"
  name: string
  path: string
}

export interface IBMiError{
  code: string
  text: string
}

export interface Filter{
  library: string,
  filter: string
}

export interface FileError {
  sev: number
  linenum: number
  column: number
  toColumn: number
  text: string
  code: string
}