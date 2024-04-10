// interface class for SQL runners

import IBMi from "../IBMi";
import { Tools } from "../Tools";

export abstract class SQLRunner {

  constructor(public connection: IBMi) { }

  abstract isAvailable(): boolean;
  
  abstract runSql(command: string): Promise<Tools.DB2Row[]>;
}