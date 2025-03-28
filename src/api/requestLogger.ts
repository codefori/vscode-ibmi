export interface RequestLog {
  start: number;
  end?: number;
  command: string;
  cwd?: string;
  stdin?: string;
  stdout?: string;
  stderr?: string;
}

export class RequestLogger {
  private collecting = false;
  private uniqueName: string|undefined;
  private log: RequestLog[] = [];

  public setId(uniqueName: string) {
    this.uniqueName = uniqueName;
    this.log = [];
  }

  setLoggingState(state: boolean) {
    this.collecting = state;
  }

  clear() {
    this.log = [];
  }

  public getLogs() {
    return this.log;
  }

  public new(command: string, cwd?: string, stdin?: string): RequestLog {
    const entry: RequestLog = {
      start: Date.now(),
      command,
      cwd,
      stdin
    };
    return entry;
  }

  end(entry: RequestLog, code: number, stdout?: string, stderr?: string): void {
    entry.end = Date.now();
    entry.stdout = stdout;
    entry.stderr = stderr;

    if (this.collecting) {
      this.log.push(entry);
    }
  }
}