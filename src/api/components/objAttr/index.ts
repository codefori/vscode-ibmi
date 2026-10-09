import path from "path";
import IBMi from "../../IBMi";
import { ComponentIdentification, IBMiComponent, SecureComponentState } from "../component";
import { getSource_objattr, OBJ_ATTR_RPGLE_SOURCE } from "./source";

export class ObjAttr implements IBMiComponent {
    static readonly ID = "obj_attr";
    static readonly VERSION = 1;
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
        const status = remoteVersion >= ObjAttr.VERSION ? "Installed" : "NeedsUpdate";
        const remoteSignature = await connection.getContent().getSQLRoutineSignature(
            library,
            ObjAttr.SPECIFIC_NAME,
            "FUNCTION"
        ) || ObjAttr.SIGNATURE;

        return { status, remoteSignature };
    }

    async update(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
        const library = connection.getConfig().tempLibrary.toUpperCase();

        return connection.withTempDirectory(async componentDir => {
            const rpglePath = path.posix.join(componentDir, `${ObjAttr.PGM_NAME}.RPGLE`);
            const sqlPath = path.posix.join(componentDir, `${ObjAttr.PGM_NAME}.SQL`);

            await connection.getContent().writeStreamfileRaw(rpglePath, OBJ_ATTR_RPGLE_SOURCE);
            await connection.getContent().writeStreamfileRaw(sqlPath, getSource_objattr(library, ObjAttr.VERSION));

            const compileResult = await connection.runCommand({
                command: `QSYS/CRTBNDRPG PGM(${library}/${ObjAttr.PGM_NAME}) SRCSTMF('${rpglePath}') OPTION(*EVENTF) DBGVIEW(*NONE) TGTCCSID(*JOB)`
            });
            if (compileResult.code !== 0) {
                throw new Error(`Failed to compile ${ObjAttr.PGM_NAME}: ${compileResult.stderr || compileResult.stdout}`);
            }

            const sqlResult = await connection.runCommand({
                command: `QSYS/RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SQL)`
            });
            if (sqlResult.code !== 0) {
                throw new Error(`Failed to install SQL routine ${library}.${ObjAttr.SPECIFIC_NAME}: ${sqlResult.stderr || sqlResult.stdout}`);
            }

            return this.getRemoteState(connection);
        });
    }
}
