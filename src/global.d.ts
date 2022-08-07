interface ConnectionInfo {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string,
  privateKey?: string;
  keepaliveInterval?: number
}

interface PaseCommand { 
  command: string;
  directory?: string;
  stdin?: string;
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
}

/**
 * Used in the runCommand API.
 */
interface CommandInfo {
  /** describes what environment the command will be executed. Is optional and defaults to `ile` */
  environment?: `pase`|`ile`|`qsh`;
  /** set this as the working directory for the command when it is executed. Is optional and defaults to the users working directory in Code for IBM i. */
  cwd?: string;
  command: string;
}

interface CommandResponse {
  code: number;
  stdout: string;
  stderr: string;
  command?: string;
}

interface MemberPathData {
  asp?: string;
  library: string;
  file: string;
  member: string;
  extension?: string;
  basename: string;
}

interface EventfInfo {
  asp?: string;
  lib: string;
  object: string;
  ext?: string;
  workspace?: number;
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