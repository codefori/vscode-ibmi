import { posix } from "path";
import IBMi from "../api/IBMi";
import { instance } from "../instantiate";
import { ComponentState, ComponentT } from "./component";

export class GetNewLibl implements ComponentT {
  public state: ComponentState = ComponentState.NotInstalled;
  public currentVersion: number = 1;

  constructor(public connection: IBMi) { }

  async getInstalledVersion(): Promise<number> {
    return (this.connection.remoteFeatures[`GETNEWLIBL.PGM`] ? 1 : 0);
  }

  async checkState(): Promise<boolean> {
    const installedVersion = await this.getInstalledVersion();

    if (installedVersion === this.currentVersion) {
      this.state = ComponentState.Installed;
      return true;
    }

    const config = this.connection.config!
    const content = instance.getContent();
    return this.connection.withTempDirectory(async tempDir => {
      const tempSourcePath = posix.join(tempDir, `getnewlibl.sql`);

      await content!.writeStreamfileRaw(tempSourcePath, getSource(config.tempLibrary));
      const result = await this.connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      });

      if (result.code === 0) {
        this.state = ComponentState.Installed;
      } else {
        this.state = ComponentState.Error;
      }

      return this.state === ComponentState.Installed;
    });
  }

  getState(): ComponentState {
    return this.state;
  }

  async getLibraryListFromCommand(ileCommand: string): Promise<{ currentLibrary: string; libraryList: string[]; } | undefined> {
    if (this.state === ComponentState.Installed) {
      const tempLib = this.connection.config!.tempLibrary;
      const resultSet = await this.connection.runSQL(`CALL ${tempLib}.GETNEWLIBL('${ileCommand.replace(new RegExp(`'`, 'g'), `''`)}')`);

      const result = {
        currentLibrary: `QGPL`,
        libraryList: [] as string[]
      };

      resultSet.forEach(row => {
        const libraryName = String(row.SYSTEM_SCHEMA_NAME);
        switch (row.PORTION) {
          case `CURRENT`:
            result.currentLibrary = libraryName;
            break;
          case `USER`:
            result.libraryList.push(libraryName);
            break;
        }
      })

      return result;
    }

    return undefined;
  }

}

function getSource(library: string) {
  return Buffer.from([
    `CREATE OR REPLACE PROCEDURE ${library}.GETNEWLIBL(IN COMMAND VARCHAR(2000))`,
    `DYNAMIC RESULT SETS 1 `,
    `BEGIN`,
    `  DECLARE clibl CURSOR FOR `,
    `    SELECT ORDINAL_POSITION, TYPE as PORTION, SYSTEM_SCHEMA_NAME`,
    `    FROM QSYS2.LIBRARY_LIST_INFO;`,
    `  CALL QSYS2.QCMDEXC(COMMAND);`,
    `  OPEN clibl;`,
    `END;`,
    ``,
    `call QSYS2.QCMDEXC( 'grtobjaut ${library}/GETNEWLIBL *PGM *PUBLIC *ALL' );`
  ].join(`\n`), "utf8");
}