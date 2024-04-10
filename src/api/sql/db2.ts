import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { SQLRunner } from "./runner";

export class Db2Runner extends SQLRunner {
  isAvailable(): boolean {
    return this.connection.remoteFeatures[`QZDFMDB2.PGM`] !== undefined; 
  }

  async runSql(statements: string): Promise<Tools.DB2Row[]> {
    const isAvailable = this.isAvailable();

    if (isAvailable) {
      const ccsidDetail = this.connection.getEncoding();
      const useCcsid = (ccsidDetail.fallback && !ccsidDetail.invalid ? ccsidDetail.ccsid : undefined);
      const possibleChangeCommand = (useCcsid ? `@CHGJOB CCSID(${useCcsid});\n` : '');

      const output = await this.connection.sendCommand({
        command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')"`,
        stdin: Tools.fixSQL(`${possibleChangeCommand}${statements}`)
      })

      if (output.stdout) {
        return Tools.db2Parse(output.stdout);
      } else {
        throw new Error(`There was an error running the SQL statement.`);
      }

    } else {
      throw new Error(`There is no way to run SQL on this system.`);
    }
  }
}