import IBMi from "../api/IBMi";
import { ComponentState, ComponentT } from "./component";
import { Extension, extensions } from "vscode";
import { Db2i, SQLJob } from "../api/import/db2i";
import { Tools } from "../api/Tools";

export class Db2iExt implements ComponentT {
  public state: ComponentState = ComponentState.NotInstalled;
  public currentVersion: number = 1;
  private ext: Extension<Db2i>|undefined = undefined;
  private job: SQLJob|undefined = undefined;

  constructor(public connection: IBMi) { }

  async getInstalledVersion(): Promise<number> {
    return 1;
  }

  async checkState(): Promise<boolean> {
    this.ext = extensions.getExtension<Db2i>(`halcyontechltd.vscode-db2i`);

    if (this.ext && this.ext.isActive) {
      this.state = ComponentState.Installed;

      this.ensureJob();

      return true;
    }

    return false;
  }

  async ensureJob() {
    if (this.ext && !this.job) {
      try {
        const job = this.ext?.exports.sqlJob({});
        await job.connect();
        this.job = job;
      } catch (e) {
        this.state = ComponentState.Error;
        this.job = undefined;
      }
    }
  }

  isReady() {
    return this.state === ComponentState.Installed && this.job !== undefined;
  }

  /**
   * Only returns the result set of the last statement
   */
  async executeMany(statements: string[]) {
    const last = statements.length - 1;
    let i = 0;

    for (const statement of statements) {
      const result = await this.executeSingle(statement);

      if (i === last) {
        return result as Tools.DB2Row[];
      }
    }

    return [];
  }

  async executeSingle(statement: string) {
    statement = statement.replace(new RegExp(`for bit data`, `gi`), ``);

    const query = await this.job!.query(statement, {autoClose: true})
    const result = await query.run(99999);
    query.close();
    return result.data as Tools.DB2Row[];
  }

  getState(): ComponentState {
    return this.state;
  }
}