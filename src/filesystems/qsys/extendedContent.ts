import fs from "fs";
import tmp from "tmp";
import util from "util";
import vscode from "vscode";
import IBMi from "../../api/IBMi";
import { Tools } from "../../api/Tools";
import { instance } from "../../instantiate";
import { getAliasName, SourceDateHandler } from "./sourceDateHandler";
import { CommandResult } from "../../api/types";

const tmpFile = util.promisify(tmp.file);
const writeFileAsync = util.promisify(fs.writeFile);

const DEFAULT_RECORD_LENGTH = 80;

export class ExtendedIBMiContent {
  constructor(readonly sourceDateHandler: SourceDateHandler) {

  }

  /**
   * Download the contents of a source member using SQL.
   * This option also stores the source dates internally.
   * @param {vscode.Uri} uri
   */
  async downloadMemberContentWithDates(uri: vscode.Uri) {
    const connection = instance.getConnection();
    if (connection) {
      const content = connection.getContent();
      const config = connection.getConfig();
      const tempLib = config.tempLibrary;
      const alias = getAliasName(uri);
      const aliasPath = `${tempLib}.${alias}`;
      const { library, file, name } = connection.parserMemberPath(uri.path);
      try {
        await connection.runSQL(`CREATE OR REPLACE ALIAS ${aliasPath} for "${library}"."${file}"("${name}")`);
      } catch (e) {
        console.log(e);
      }

      if (!this.sourceDateHandler.recordLengths.has(alias)) {
        let recordLength = await this.getRecordLength(aliasPath, library, file);
        this.sourceDateHandler.recordLengths.set(alias, recordLength);
      }

      let rows = await connection.runSQL(
        `select case when locate('40',hex(srcdat)) > 0 then 0 else srcdat end as srcdat, srcseq, srcdta from ${aliasPath}`,
        {forceSafe: true}
      ) as {SRCDAT: number, SRCDTA: string, SRCSEQ: number}[];

      if (rows.length === 0) {
        rows.push({
          SRCDAT: 0,
          SRCDTA: ``,
          SRCSEQ: 0
        });
      }

      const sourceDates = rows.map(row => String(row.SRCDAT).padStart(6, `0`));
      const body = rows
        .map(row => row.SRCDTA.includes(`\\\t`) ? row.SRCDTA.replaceAll(`\\\t`, `\t`) : row.SRCDTA)
        .join(`\n`);
      const sequences = rows.map(row => Number(row.SRCSEQ));

      this.sourceDateHandler.baseDates.set(alias, sourceDates);
      this.sourceDateHandler.baseSource.set(alias, body);
      this.sourceDateHandler.baseSequences.set(alias, sequences);

      return body;
    }
  }

  /**
   * Determine the member record length 
   * @param {string} aliasPath member sql alias path e.g. ILEDITOR.QGPL_QRPGLESC_MYRPGPGM
   * @param {string} lib
   * @param {string} spf
   */
  private async getRecordLength(aliasPath: string, lib: string, spf: string): Promise<number> {
    const connection = instance.getConnection();
    let recordLength: number = DEFAULT_RECORD_LENGTH;

    if (connection) {
      const result = await connection.runSQL(`select length(SRCDTA) as LENGTH from ${aliasPath} limit 1`);
      if (result.length > 0) {
        recordLength = Number(result[0].LENGTH);
      } else {
        const result = await connection.runSQL(`select row_length-12 as LENGTH
                                               from QSYS2.SYSTABLES
                                              where SYSTEM_TABLE_SCHEMA = '${connection.sysNameInAmerican(lib)}' and SYSTEM_TABLE_NAME = '${connection.sysNameInAmerican(spf)}'
                                              limit 1`);
        if (result.length > 0) {
          recordLength = Number(result[0].LENGTH);
        }
      }
    }

    return recordLength;
  }

  /**
   * Upload to a member with source dates 
   * @param {vscode.Uri} uri
   * @param {string} body 
   */
  async uploadMemberContentWithDates(uri: vscode.Uri, body: string) {
    const connection = instance.getConnection();
    if (connection) {
      const config = connection.getConfig();
      const setccsid = connection.remoteFeatures.setccsid;

      const tempLib = config.tempLibrary;
      const alias = getAliasName(uri);
      const aliasPath = `${tempLib}.${alias}`;

      let sourceDates;

      if (!this.sourceDateHandler.baseSource.has(alias)) {
        await this.downloadMemberContentWithDates(uri);
      }
      sourceDates = this.sourceDateHandler.calcNewSourceDates(alias, body);

      const client = connection.client!;

      const { library, file, name } = connection.parserMemberPath(uri.path);
      const tempRmt = connection.getTempRemote(library + file + name);
      if (tempRmt) {
        const tmpobj = await tmpFile();

        const sourceData = body.split(`\n`);
        const recordLength = this.sourceDateHandler.recordLengths.get(alias) || await this.getRecordLength(aliasPath, library, file);

        const decimalSequence = sourceData.length >= 10000;

        let rows = [],
          sequence = 0;
        for (let i = 0; i < sourceData.length; i++) {
          sequence = decimalSequence ? ((i + 1) / 100) : i + 1;
          sourceData[i] = sourceData[i].trimEnd();
          if (sourceData[i].length > recordLength) {
            sourceData[i] = sourceData[i].substring(0, recordLength);
          }

          rows.push(
            `(${sequence}, ${sourceDates[i] ? sourceDates[i].padEnd(6, `0`) : `0`}, '${escapeString(sourceData[i])}')`,
          );

        }

        //We assume the alias still exists....
        const tempTable = `QTEMP.NEWMEMBER`;
        const query: string[] = [
          `CREATE OR REPLACE TABLE ${tempTable} LIKE "${library}"."${file}" ON REPLACE DELETE ROWS;`,
        ];

        // Row length is the length of the SQL string used to insert each row
        const rowLength = recordLength + 55;
        // 450000 is just below the maxiumu length for each insert.
        const perInsert = Math.floor(400000 / rowLength);

        const rowGroups = sliceUp(rows, perInsert);
        rowGroups.forEach(rowGroup => {
          query.push(`insert into ${tempTable} values ${rowGroup.join(`,`)};`);
        });

        query.push(
          `CALL QSYS2.QCMDEXC('CLRPFM FILE(${library}/${file}) MBR(${name})');`,
          `insert into ${aliasPath} (select * from ${tempTable});`
        )

        await writeFileAsync(tmpobj, query.join(`\n`), `utf8`);
        await client.putFile(tmpobj, tempRmt);

        if (setccsid) {
          await connection.sendCommand({ command: `${setccsid} 1208 ${tempRmt}` });
        }

        // Fetch source file CCSID and determine if conversion is needed
        const memberPath = { library, name: file, member: name };
        const attr = await connection.getContent().getAttributes(memberPath, "CCSID");
        const sourceCcsid = Number(attr?.["CCSID"]) || 0;
        const [requiresConversion, targetCcsid] = Tools.determineCcsidConversion(sourceCcsid, config);

        let insertResult: CommandResult = { code: 0, stdout: '', stderr: '' };
        if (requiresConversion) {
          await connection.runSQL([
            `@QSYS/CPY OBJ('${tempRmt}') TOOBJ('${tempRmt}') TOCCSID(${targetCcsid}) DTAFMT(*TEXT) REPLACE(*YES)`
          ].join("\n")).catch(e => {
            insertResult.code = -1;
            insertResult.stderr = String(e);
          });
          
          if (insertResult.code === 0) {
            insertResult = await connection.runCommand({
              command: `QSYS/RUNSQLSTM SRCSTMF('${tempRmt}') COMMIT(*NONE) NAMING(*SQL)`,
              noLibList: true
            });
          }
        } else {
          insertResult = await connection.runCommand({
            command: `QSYS/RUNSQLSTM SRCSTMF('${tempRmt}') COMMIT(*NONE) NAMING(*SQL)`,
            noLibList: true
          });
        }

        if (insertResult.code !== 0) {
          throw new Error(`Failed to save member: ` + insertResult.stderr);
        }

        this.sourceDateHandler.baseSource.set(alias, body);
        this.sourceDateHandler.baseDates.set(alias, sourceDates);
        this.sourceDateHandler.baseSequences.delete(alias);
      }
    }
  }
}

function sliceUp(arr: any[], size: number): any[] {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function escapeString(val: string): string {
  val = val.replace(/[\0\n\r\b\t'\x1a]/g, function (s) {
    switch (s) {
      case `\0`:
        return `\\0`;
      case `\n`:
        return `\\n`;
      case `\r`:
        return ``;
      case `\b`:
        return `\\b`;
      case `\x1a`:
        return `\\Z`;
      case `'`:
        return `''`;
      default:
        return `\\` + s;
    }
  });

  return val;
}