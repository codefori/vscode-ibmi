
interface StandardIO {
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  stdin?: string;
}

interface CommandData extends StandardIO {
  command: string;
  directory?: string;
}

interface CommandResult {
  code: number|null;
  stdout: string;
  stderr: string;
}

interface MemberParts {
  asp: string|undefined;
  library: string|undefined;
  file: string|undefined;
  member: string|undefined;
  extension: string|undefined;
  basename: string|undefined;
}

type DeployResult = false | DeploySuccessData;
interface DeploySuccessData {workspace: number, remoteRoot: string}

interface RemoteDebugConfig {
  type: "node";
  /** @type {vscode.WorkspaceFolder} */
  workspace: any;
  address: string;
  port: number;
  remoteRoot: string;
}

interface Action {
  name: string;
  command: string;
  type?: "member"|"streamfile"|"object"|"file";
  environment: "ile"|"qsh"|"pase";
  extensions: string[];
  deployFirst?: boolean;
  postDownload?: string[];
  debug?: "node"
}

interface ConnectionData {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey: string|null;
  keepaliveInterval: number;
}

interface Server {
  name : string
}

interface Profile {
  profile : string
}