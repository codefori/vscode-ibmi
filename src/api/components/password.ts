import { posix } from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { ComponentIdentification, ComponentState, IBMiComponent } from "./component";

export class PasswordManager implements IBMiComponent {
  static ID = "IBM i Password Manager";

  getIdentification(): ComponentIdentification {
    return { name: PasswordManager.ID, version: 1 };
  }

  async setInstallDirectory?(_installDirectory: string) {
    //Not used
  }

  getRemoteState(_connection: IBMi, _installDirectory: string): ComponentState {
    //Volatile component - procedure is created and removed when invoked
    return "Installed";
  }

  update(_connection: IBMi, _installDirectory: string): ComponentState {
    //Volatile component - procedure is created and removed when invoked
    return "Installed";
  }

  async getPasswordExpiration(connection: IBMi) {
    const [row] = (await connection.runSQL(`
      Select EXTRACT(EPOCH FROM (DATE_PASSWORD_EXPIRES)) * 1000 AS EXPIRATION,
      DAYS(DATE_PASSWORD_EXPIRES) - DAYS(current_timestamp) as DAYS_LEFT
      FROM TABLE (QSYS2.QSYUSRINFO('${connection.upperCaseName(connection.currentUser)}'))
    `));
    if (row && row.EXPIRATION) {
      return {
        expiration: new Date(Number(row.EXPIRATION)),
        daysLeft: Number(row.DAYS_LEFT)
      }
    }
  }

  async changePassword(connection: IBMi, oldPassword: string, newPassword: string) {
    return await connection.withTempDirectory(async directory => {
      const source = posix.join(directory, "CHGPWD.sql");
      const procedure = `${connection.getConfig().tempLibrary}.${Tools.makeid(8)}`;
      await connection.getContent().writeStreamfileRaw(source,`
        create or replace procedure ${procedure} ()
        language sql
        not deterministic
        begin atomic
          call QSYS.QSYCHGPW(
            '*CURRENT  ', '${oldPassword}', '${newPassword}',
            X'00000000',
            ${oldPassword.length}, 0, ${newPassword.length}, 0        
          );
        end;
        `);
      const compile = await connection.runCommand({
        command: `RUNSQLSTM SRCSTMF('${source}') COMMIT(*NONE) NAMING(*SQL) OPTION(*NOSRC)`,
        noLibList: true
      });
      if (compile.code !== 0) {
        throw Error(compile.stderr || compile.stdout);
      }

      try {
        await connection.runSQL(`call ${procedure};`)
      }
      catch (error: any) {
        if(error instanceof Error){
          throw error
        }
        throw Error(String(error));
      }
      finally {
        await connection.runSQL(`drop procedure if exists ${procedure}`);
      }
    });
  }
}