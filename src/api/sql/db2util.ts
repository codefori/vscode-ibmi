import IBMi from "../IBMi";
import { Tools } from "../Tools";
import { SQLRunner } from "./runner";

export class Db2UtilRunner extends SQLRunner {
  isAvailable(): boolean {
    return this.connection.remoteFeatures[`db2util`] !== undefined; 
  }

  async runSql(statements: string): Promise<Tools.DB2Row[]> {
    const isAvailable = this.isAvailable();
    const tempLib = this.connection.config?.tempLibrary!;

    if (isAvailable) {
      const statementList = Tools.fixSQL(statements)
        .split(`\n`)
        .map(s => s.trim())
        .filter(l => !l.startsWith(`--`)) //Remove comments
        .join(` `) // Then join the statements back up
        .split(`;`) //then split them
        .map(s => s.replaceAll(`QTEMP`, tempLib).replace(new RegExp(`for bit data`, "ig"), ``).trim()) // Then replace QTEMP with our temp library since that's the way it goes 
        .filter(s => s.length > 0); // And remove any empty statements
      
      // Loop through all but the last statement to execute them
      for (let i = 0; i < statementList.length - 1; i++) {
        const currentOutput = await this.connection.sendCommand({
          command: `${this.connection.remoteFeatures[`db2util`]} -o json "${statementList[i]}"`,
        })

        if (currentOutput.stderr) {
          throw this.getError(currentOutput.stderr)
        }
      }
      
      // Then run the last statement
      const last = statementList[statementList.length - 1];

      const output = await this.connection.sendCommand({
        command: `${this.connection.remoteFeatures[`db2util`]} -o json "${last}"`,
      })

      if (output.stderr) {
        throw this.getError(output.stderr)
      } else {
        const asJSON = JSON.parse(output.stdout);
        return asJSON.records as unknown as Tools.DB2Row[];
      }

    } else {
      throw new Error(`There is no way to run SQL on this system.`);
    }
  }

  private getError(output: string) {
    const startOfState = output.indexOf(`SQLSTATE`);
    if (startOfState === -1) {
      return new Tools.SqlError(output);
    }

    const errorText = output.substring(0, startOfState).trim();
    const errorValuesText = output.substring(startOfState).split(` `);

    const errorValues = errorValuesText.map(value => {
      const pair = value.split(`=`);
      return { key: pair[0], value: pair[1] };
    })
    
    const sqlState = errorValues.find(v => v.key === `SQLSTATE`);

    if (sqlState && sqlState.value) {
      let sqlError = new Tools.SqlError(`${errorText} (${sqlState.value})`);
      sqlError.sqlstate = sqlState.value;
      return sqlError;
    }

    return new Tools.SqlError(output);

  }
}