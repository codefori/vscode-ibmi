import { posix } from "path";
import IBMi from "../IBMi";
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
    //Virtual component, always installed
    return "Installed";
  }

  update(_connection: IBMi, _installDirectory: string): ComponentState {
    //Virtual component, always installed
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

  async changePassword(connection: IBMi, oldPassword: string, newPassword: string, additionalAuthenticationFactor?: string) {
    return await connection.withTempDirectory(async directory => {
      const source = posix.join(directory, "ChangePassword.java");
      const as400Class = connection.getConfig().secureSQL ? "SecureAS400" : "AS400"; //If Mapepire can/must use TLS, then this too.
      await connection.getContent().writeStreamfileRaw(source, `
        import com.ibm.as400.access.${as400Class};
        public class ChangePassword {
          public static void main(String[] args) throws Exception {
            try (final ${as400Class} ibmi = new ${as400Class}()){
              ibmi.changePassword("${oldPassword}".toCharArray(), "${newPassword}".toCharArray()${additionalAuthenticationFactor ? `, "${additionalAuthenticationFactor}".toCharArray()` : ""});
            }
            catch(Exception e){
              System.err.println(e.getMessage());
              System.exit(1);
            }
          }
        }
        `);
      const change = await connection.sendCommand({
        command: [
          `javac -cp /QIBM/ProdData/OS400/jt400/lib/jt400.jar ChangePassword.java`,
          `rm -f ChangePassword.java`,
          `java -cp /QIBM/ProdData/OS400/jt400/lib/jt400.jar:. ChangePassword`
        ].join(" && "),
        directory
      });
      if (change.code !== 0) {
        //Cleanup: AS400SecurityException usually ends with ":<user>" - we remove it
        throw Error((change.stderr || change.stdout).replaceAll(`:${connection.currentUser}`, ""));
      }
    });
  }
}