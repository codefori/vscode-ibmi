

interface StandardIO {
  onStdout?: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  stdin?: string;
}

interface CommandData extends StandardIO {
  command: string;
  directory?: string;
}

interface MemberParts {
  asp: string | undefined;
  library: string | undefined;
  file: string | undefined;
  member: string | undefined;
  extension: string | undefined;
  basename: string | undefined;
}

interface Action {
  name: string;
  command: string;
  type?: "member" | "streamfile" | "object" | "file";
  environment: "ile" | "qsh" | "pase";
  extensions: string[];
  deployFirst?: boolean;
  postDownload?: string[];
}

interface Server {
  name: string
}

interface Profile {
  profile: string
}