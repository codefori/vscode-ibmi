import { posix } from "path";
import IBMi from "../IBMi";
import { ComponentState, IBMiComponent } from "./component";

export class GetNewLibl implements IBMiComponent {
  static ID = "GetNewLibl";
  private readonly procedureName = 'GETNEWLIBL';
  private readonly currentVersion = 1;
  private installedVersion = 0;

  reset() {
    this.installedVersion = 0;
  }

  getIdentification() {
    return { name: GetNewLibl.ID, version: this.currentVersion };
  }

  async getRemoteState(connection: IBMi): Promise<ComponentState> {
    const [result] = await connection.runSQL(`select cast(LONG_COMMENT as VarChar(200)) LONG_COMMENT from qsys2.sysprocs where routine_schema = '${connection.getConfig().tempLibrary.toUpperCase()}' and routine_name = '${this.procedureName}'`);
    if (result?.LONG_COMMENT) {
      const comment = result.LONG_COMMENT as string;
      const dash = comment.indexOf('-');
      if (dash > -1) {
        this.installedVersion = Number(comment.substring(0, dash).trim());
      }
    }
    if (this.installedVersion < this.currentVersion) {
      return `NeedsUpdate`;
    }

    return `Installed`;
  }

  update(connection: IBMi): Promise<ComponentState> {
    const config = connection.getConfig();
    return connection.withTempDirectory(async (tempDir): Promise<ComponentState> => {
      const tempSourcePath = posix.join(tempDir, `getnewlibl.sql`);

      await connection.getContent().writeStreamfileRaw(tempSourcePath, this.getSource(config.tempLibrary));
      const result = await connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true
      });

      if (!result.code) {
        this.installedVersion = this.currentVersion;
        return `Installed`;
      } else {
        return `Error`;
      }
    });
  }

  async getLibraryListFromCommand(connection: IBMi, ileCommand: string) {
    const tempLib = connection.config!.tempLibrary;
    const resultSet = await connection.runSQL(`CALL ${tempLib}.${this.procedureName}('${ileCommand.replace(new RegExp(`'`, 'g'), `''`)}')`);

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

  private getSource(library: string) {
    return Buffer.from([
      `CREATE OR REPLACE PROCEDURE ${library}.${this.procedureName}(IN COMMAND VARCHAR(2000))`,
      `DYNAMIC RESULT SETS 1 `,
      `BEGIN`,
      `  DECLARE clibl CURSOR FOR `,
      `    SELECT ORDINAL_POSITION, TYPE as PORTION, SYSTEM_SCHEMA_NAME`,
      `    FROM QSYS2.LIBRARY_LIST_INFO;`,
      `  CALL QSYS2.QCMDEXC(COMMAND);`,
      `  OPEN clibl;`,
      `END;`,
      ``,
      `comment on procedure ${library}.${this.procedureName} is '${this.currentVersion} - Validate member information';`,
      ``,
      `call QSYS2.QCMDEXC( 'grtobjaut ${library}/${this.procedureName} *PGM *PUBLIC *ALL' );`
    ].join(`\n`), "utf8");
  }
}