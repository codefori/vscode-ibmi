import { instance } from "../../instantiate";
import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { SQLRunner } from "./runner";
import { parse } from 'csv-parse/sync';

export class ToCsvRunner extends SQLRunner {
  isAvailable(): boolean {
    return this.connection.remoteFeatures[`QZDFMDB2.PGM`] !== undefined; 
  }

  async runSql(statements: string): Promise<Tools.DB2Row[]> {
    const isAvailable = this.isAvailable();

    if (isAvailable) {
      const ccsidDetail = this.connection.getEncoding();
      const useCcsid = (ccsidDetail.fallback && !ccsidDetail.invalid ? ccsidDetail.ccsid : undefined);
      const possibleChangeCommand = (useCcsid ? `@CHGJOB CCSID(${useCcsid});\n` : '');

      let statementList = Tools.fixSQL(`${possibleChangeCommand}${statements}`).split(`\n`)
      let lastStatement = statementList[statementList.length - 1].trim();

      let getCsv;

      if (lastStatement.toUpperCase().startsWith(`SELECT`)) {
        if (lastStatement.endsWith(`;`)) {
          lastStatement = lastStatement.slice(0, -1);
        }

        // lastStatement = `CREATE OR REPLACE TABLE QTEMP.TEMP_DATA AS (${lastStatement}) WITH DATA;`;
        getCsv = this.connection.getTempRemote(Tools.makeid());

        // lastStatement = `CREATE OR REPLACE TABLE QTEMP.TEMP_DATA AS (${lastStatement}) WITH DATA;`;
        lastStatement = `CALL LIAMA.SQL_TO_CSV('${lastStatement.replaceAll(`'`, `''`)}', '${getCsv}');`
        statementList[statementList.length - 1] = lastStatement;
      }

      const output = await this.connection.sendCommand({
        command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')"`,
        stdin:  statementList.join(`\n`)
      })

      if (output.code === 0) {
        if (getCsv) {
          const content = instance.getContent();
          let result = await content?.downloadStreamfile(getCsv);
          if (result) {
            return parse(result, {
              columns: true,
              skip_empty_lines: true,
              cast: true,
              onRecord(record) {
                for (const key of Object.keys(record)) {
                  record[key] = record[key] === ` ` ? `` : record[key];
                }
                return record;
              }
            }) as Tools.DB2Row[];
          } else {
            throw new Error(`There was an error getting the SQL result.`);
          }
        } else {
          return Tools.db2Parse(output.stdout);
        }
      } else {
        throw new Error(`There was an error running the SQL statement.`);
      }

    } else {
      throw new Error(`There is no way to run SQL on this system.`);
    }
  }
}