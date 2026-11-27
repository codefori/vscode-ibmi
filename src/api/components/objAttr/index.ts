import path from "path";
import IBMi from "../../IBMi";
import { ComponentIdentification, IBMiComponent, SecureComponentState } from "../component";
import { getSource_objattr } from "./source";

const OBJ_ATTR_RPGLE_SOURCE = require("./OBJ_ATTR.rpgle");

export class ObjAttr implements IBMiComponent {
  static readonly ID = "obj_attr";
  static readonly VERSION = 3;
  static readonly SIGNATURE = `OBJ_ATTR:${ObjAttr.VERSION}`;
  static readonly PGM_NAME = "OBJ_ATTR";
  static readonly SPECIFIC_NAME = "OBJ_ATTR";

  getIdentification(): ComponentIdentification {
    return {
      name: ObjAttr.ID,
      version: ObjAttr.VERSION,
      signature: ObjAttr.SIGNATURE
    };
  }

  async getRemoteState(connection: IBMi): Promise<SecureComponentState> {
    const library = connection.getConfig().tempLibrary.toUpperCase();

    //Check program object
    const [pgmRow] = await connection.runSQL(/* sql */`select OBJTEXT from table(QSYS2.OBJECT_STATISTICS('${library}', 'PGM', 'OBJ_ATTR'))`);
    if (!pgmRow) {
      return { status: "NotInstalled", remoteSignature: "" };
    }
    const pgmVersion = Number(String(pgmRow.OBJTEXT).match(/^(\d+)/)?.[1] || -1);
    if(pgmVersion < ObjAttr.VERSION){
      return { status: "NeedsUpdate", remoteSignature: "" };
    }

    //Check SQL function definition
    const [row] = await connection.runSQL(/* sql */`
        select cast(long_comment as varchar(200)) as LONG_COMMENT
        from qsys2.sysroutines
        where routine_type = 'FUNCTION'
            and routine_schema = '${library}'
            and specific_name = '${ObjAttr.SPECIFIC_NAME}'
        fetch first row only
    `);

    if (!row) {
      return { status: "NotInstalled", remoteSignature: "" };
    }

    const longComment = String(row.LONG_COMMENT || "").trim();
    const remoteVersion = Number(longComment.match(/^(\d+)/)?.[1] || -1);
    const routineSignature = await connection.getContent().getSQLRoutineSignature(library, ObjAttr.SPECIFIC_NAME, "FUNCTION");
    const expectedExternalName = `${library}/${ObjAttr.PGM_NAME}`;
    const signatureMatches = routineSignature?.toUpperCase() === expectedExternalName;
    const status = remoteVersion >= ObjAttr.VERSION && signatureMatches ? "Installed" : "NeedsUpdate";

    return { status, remoteSignature: signatureMatches ? ObjAttr.SIGNATURE : routineSignature || "" };
  }

  async update(connection: IBMi, _installDirectory: string): Promise<SecureComponentState> {
    const library = connection.getConfig().tempLibrary.toUpperCase();
    const currentState = await this.getRemoteState(connection);
    const action = currentState.status === "NotInstalled" ? "Installing" : "Updating";
    connection.appendOutput(`${action} component ${ObjAttr.ID} (${ObjAttr.VERSION}) in ${library}\n`);

    return connection.withTempDirectory(async componentDir => {
      const rpglePath = path.posix.join(componentDir, `${ObjAttr.PGM_NAME}.RPGLE`);
      const sqlPath = path.posix.join(componentDir, `${ObjAttr.PGM_NAME}.SQL`);

      connection.appendOutput(`\t${action} ${ObjAttr.PGM_NAME} sources in ${componentDir}\n`);
      await connection.getContent().writeStreamfileRaw(rpglePath, OBJ_ATTR_RPGLE_SOURCE);
      await connection.getContent().writeStreamfileRaw(sqlPath, getSource_objattr(library, ObjAttr.VERSION));

      connection.appendOutput(`\tCompiling program ${library}/${ObjAttr.PGM_NAME} (CRTBNDRPG)\n`);
      try {
        const compileResult = await connection.runCL(`QSYS/CRTBNDRPG PGM(${library}/${ObjAttr.PGM_NAME}) TEXT('${ObjAttr.VERSION} - Retrieve Object Attributes') SRCSTMF('${rpglePath}') OPTION(*EVENTF) DBGVIEW(*NONE) TGTCCSID(*JOB)`);
        if (!compileResult.success) {
          throw new Error(`Failed to compile ${ObjAttr.PGM_NAME}: ${compileResult.error}`);
        }
      }
      finally {
        await connection.runCL(`DLTF FILE(${library}/EVFEVENT)`);
      }

      connection.appendOutput(`\t${action} routine ${library}.${ObjAttr.SPECIFIC_NAME} (RUNSQLSTM)\n`);
      const sqlResult = await connection.runCL(`QSYS/RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SYS) OPTION(*ERRLIST)`);
      if (!sqlResult.success) {
        throw new Error(`Failed to install SQL routine ${library}.${ObjAttr.SPECIFIC_NAME}: ${sqlResult.error}`);
      }

      const completedAction = action === "Installing" ? "Installed" : "Updated";
      connection.appendOutput(`\t${completedAction} component ${ObjAttr.ID} (${ObjAttr.SIGNATURE})\n`);

      return this.getRemoteState(connection);
    });
  }
}
