import path from "path";
import IBMi from "../../IBMi";
import { ComponentIdentification, IBMiComponent, SecureComponentState } from "../component";
import { buildMbrAttrSqlSource, MBR_ATTR_RPGLE_SOURCE } from "./source";

export class MbrAttr implements IBMiComponent {
    static readonly ID = "mbr_attr";
    static readonly VERSION = 1;
    static readonly SIGNATURE = `MBR_ATTR:${MbrAttr.VERSION}`;
    static readonly PGM_NAME = "MBR_ATTR";
    static readonly SPECIFIC_NAME = "MBR_ATTR";

    getIdentification(): ComponentIdentification {
        return {
            name: MbrAttr.ID,
            version: MbrAttr.VERSION,
            signature: MbrAttr.SIGNATURE
        };
    }

    async getRemoteState(connection: IBMi): Promise<SecureComponentState> {
        const library = connection.getConfig().tempLibrary.toUpperCase();
        const [row] = await connection.runSQL(/* sql */`
      select cast(long_comment as varchar(200)) as LONG_COMMENT
      from qsys2.sysroutines
      where routine_type = 'FUNCTION'
        and routine_schema = '${library}'
        and specific_name = '${MbrAttr.SPECIFIC_NAME}'
      fetch first row only
    `);

        if (!row) {
            return { status: "NotInstalled", remoteSignature: MbrAttr.SIGNATURE };
        }

        const longComment = String(row.LONG_COMMENT || "").trim();
        const remoteVersion = Number(longComment.match(/^(\d+)/)?.[1] || -1);
        const status = remoteVersion >= MbrAttr.VERSION ? "Installed" : "NeedsUpdate";

        return { status, remoteSignature: MbrAttr.SIGNATURE };
    }

    async update(connection: IBMi, installDirectory: string): Promise<SecureComponentState> {
        const library = connection.getConfig().tempLibrary.toUpperCase();
        const componentDir = path.posix.join(installDirectory, "mbr_attr");
        const rpglePath = path.posix.join(componentDir, `${MbrAttr.PGM_NAME}.RPGLE`);
        const sqlPath = path.posix.join(componentDir, `${MbrAttr.PGM_NAME}.SQL`);

        await connection.sendCommand({ command: `mkdir -p ${componentDir}` });

        await connection.getContent().writeStreamfileRaw(rpglePath, MBR_ATTR_RPGLE_SOURCE);
        await connection.getContent().writeStreamfileRaw(sqlPath, buildMbrAttrSqlSource(library, MbrAttr.VERSION));

        const compileResult = await connection.runCommand({
            command: `QSYS/CRTBNDRPG PGM(${library}/${MbrAttr.PGM_NAME}) SRCSTMF('${rpglePath}') OPTION(*EVENTF) DBGVIEW(*NONE) TGTCCSID(*JOB)`
        });
        if (compileResult.code !== 0) {
            throw new Error(`Failed to compile ${MbrAttr.PGM_NAME}: ${compileResult.stderr || compileResult.stdout}`);
        }

        const sqlResult = await connection.runCommand({
            command: `QSYS/RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SQL)`
        });
        if (sqlResult.code !== 0) {
            throw new Error(`Failed to install SQL routine ${library}.${MbrAttr.SPECIFIC_NAME}: ${sqlResult.stderr || sqlResult.stdout}`);
        }

        return this.getRemoteState(connection);
    }
}
