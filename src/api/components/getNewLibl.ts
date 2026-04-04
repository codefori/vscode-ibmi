import { posix } from "path";
import IBMi from "../IBMi";
import { IBMiComponent, SecureComponentState } from "./component";

export class GetNewLibl implements IBMiComponent {
  static readonly ID = "GetNewLibl";
  private static readonly VERSION = 2;
  private static readonly SIGNATURE = "";
  private static readonly PROCEDURE_NAME = `NWLIBL${this.VERSION.toString().padStart(4, '0')}`;

  getIdentification() {
    return { name: GetNewLibl.ID, version: GetNewLibl.VERSION, signature: GetNewLibl.SIGNATURE };
  }

  async getRemoteState(connection: IBMi): Promise<SecureComponentState> {
    const remoteSignature = await connection.getContent().getSQLRoutineSignature(connection.getConfig().tempLibrary.toUpperCase(), GetNewLibl.PROCEDURE_NAME, "PROCEDURE");
    return { status: remoteSignature ? "Installed" : "NotInstalled", remoteSignature };
  }

  update(connection: IBMi): Promise<SecureComponentState> {
    const config = connection.getConfig();
    return connection.withTempDirectory(async (tempDir): Promise<SecureComponentState> => {
      const tempSourcePath = posix.join(tempDir, `getnewlibl.sql`);

      await connection.getContent().writeStreamfileRaw(tempSourcePath, this.getSource(config.tempLibrary));
      const result = await connection.runCommand({
        command: `QSYS/RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
        cwd: `/`,
        noLibList: true,
        getSpooledFiles: true
      });

      if (result.code !== 0) {
        throw Error(result.stderr || result.stdout);
      }

      return this.getRemoteState(connection);
    });
  }

  async getLibraryListFromCommand(connection: IBMi, ileCommand: string) {
    const tempLib = connection.getConfig().tempLibrary;
    const resultSet = await connection.runSQL(`CALL ${tempLib}.${GetNewLibl.PROCEDURE_NAME}('${ileCommand.replace(new RegExp(`'`, 'g'), `''`)}')`);

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
    return Buffer.from(
      /* sql */ `
      CREATE OR REPLACE PROCEDURE ${library}.${GetNewLibl.PROCEDURE_NAME}(IN COMMAND VARCHAR(2000))
      DYNAMIC RESULT SETS 1
      SET OPTION USRPRF=*USER, DYNUSRPRF=*USER
      BEGIN
        DECLARE clibl CURSOR FOR 
          SELECT ORDINAL_POSITION, TYPE as PORTION, SYSTEM_SCHEMA_NAME
          FROM QSYS2.LIBRARY_LIST_INFO;
        CALL QSYS2.QCMDEXC(COMMAND);
        OPEN clibl;
      END;
      
      comment on procedure ${library}.${GetNewLibl.PROCEDURE_NAME} is '${GetNewLibl.VERSION} - Validate member information';
      grant execute on procedure ${library}.${GetNewLibl.PROCEDURE_NAME} to public;
      call QSYS2.QCMDEXC('CHGOBJOWN OBJ(${library}/${GetNewLibl.PROCEDURE_NAME}) OBJTYPE(*PGM) NEWOWN(QUSER)');`,
      "utf8");
  }
}