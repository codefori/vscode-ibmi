

interface StandardIO {
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  stdin?: string;
}

/**
 * External interface for extensions to call `code-for-ibmi.runCommand`
 */
interface RemoteCommand {
  command: string;
  environment?: "ile"|"qsh"|"pase";
  cwd?: string;
  env?: {[name: string]: string};
}

interface CommandData extends StandardIO {
  command: string;
  directory?: string;
  env?: {[name: string]: string};
}

interface CommandResult {
  code: number|null;
  stdout: string;
  stderr: string;
  command?: string;
}

interface MemberParts {
  asp: string|undefined;
  library: string|undefined;
  file: string|undefined;
  member: string|undefined;
  extension: string|undefined;
  basename: string|undefined;
}

interface Action {
  name: string;
  command: string;
  type: "member"|"streamfile"|"object"|"file";
  environment: "ile"|"qsh"|"pase";
  extensions: string[];
  deployFirst?: boolean;
  postDownload?: string[];
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