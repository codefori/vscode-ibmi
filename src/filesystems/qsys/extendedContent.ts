import fs from "fs";
import tmp from "tmp";
import util from "util";
import { GlobalConfiguration } from "../../api/Configuration";
import { instance } from "../../instantiate";
import { getAliasName, SourceDateHandler } from "./sourceDateHandler";

const tmpFile = util.promisify(tmp.file);
const writeFileAsync = util.promisify(fs.writeFile);

const DEFAULT_RECORD_LENGTH = 80;

// Translate x'25' to x'2F' and back, or x'25' will become x'0A' (linefeed)!
const SEU_GREEN_UL_RI = `x'25'`;
const SEU_GREEN_UL_RI_temp = `x'2F'`;

export class ExtendedIBMiContent {
  constructor(readonly sourceDateHandler: SourceDateHandler) {

  }

  /**
   * Download the contents of a source member using SQL.
   * This option also stores the source dates internally.
   * @param {string|undefined} asp
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   */
  async downloadMemberContentWithDates(asp: string | undefined, lib: string, spf: string, mbr: string) {
    const content = instance.getContent();
    const config = instance.getConfig();
    const connection = instance.getConnection();
    if (connection && config && content) {
      lib = connection.upperCaseName(lib);
      spf = connection.upperCaseName(spf);
      mbr = connection.upperCaseName(mbr);

      const sourceColourSupport = GlobalConfiguration.get<boolean>(`showSeuColors`);
      const tempLib = config.tempLibrary;
      const alias = getAliasName(lib, spf, mbr);
      const aliasPath = `${tempLib}.${alias}`;

      try {
        await content.runSQL(`CREATE OR REPLACE ALIAS ${aliasPath} for "${lib}"."${spf}"("${mbr}")`);
      } catch (e) { }

      if (!this.sourceDateHandler.recordLengths.has(alias)) {
        let recordLength = await this.getRecordLength(aliasPath, lib, spf);
        this.sourceDateHandler.recordLengths.set(alias, recordLength);
      }

      let rows;
      if (sourceColourSupport)
        rows = await connection.runSQL(
          `select srcdat, rtrim(translate(srcdta, ${SEU_GREEN_UL_RI_temp}, ${SEU_GREEN_UL_RI})) as srcdta from ${aliasPath}`
        );
      else
        rows = await connection.runSQL(
          `select srcdat, srcdta from ${aliasPath}`
        );

      if (rows.length === 0) {
        rows.push({
          SRCDAT: 0,
          SRCDTA: ``,
        });
      }

      const sourceDates = rows.map(row => String(row.SRCDAT).padStart(6, `0`));
      const body = rows
        .map(row => row.SRCDTA)
        .join(`\n`);

      this.sourceDateHandler.baseDates.set(alias, sourceDates);

      if (this.sourceDateHandler.sourceDateMode === `diff`) {
        this.sourceDateHandler.baseSource.set(alias, body);
      }

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
    const content = instance.getContent();
    let recordLength: number = DEFAULT_RECORD_LENGTH;

    if (content) {
      const result = await content.runSQL(`SELECT LENGTH(srcdta) as LENGTH FROM ${aliasPath} limit 1`);
      if (result.length > 0) {
        recordLength = Number(result[0].LENGTH);
      } else {
        const result = await content.runSQL(`SELECT row_length-12 as LENGTH FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = '${lib}' and TABLE_NAME = '${spf}' limit 1`);
        if (result.length > 0) {
          recordLength = Number(result[0].LENGTH);
        }
      }
    }

    return recordLength;
  }

  /**
   * Upload to a member with source dates 
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   * @param {string} body 
   */
  async uploadMemberContentWithDates(asp: string | undefined, lib: string, spf: string, mbr: string, body: string) {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    if (connection && config) {
      const setccsid = connection.remoteFeatures.setccsid;

      const tempLib = config.tempLibrary;
      const alias = getAliasName(lib, spf, mbr);
      const aliasPath = `${tempLib}.${alias}`;

      const sourceDates = this.sourceDateHandler.sourceDateMode === `edit` ? this.sourceDateHandler.baseDates.get(alias) || [] : this.sourceDateHandler.calcNewSourceDates(alias, body);

      const client = connection.client;
      const tempRmt = connection.getTempRemote(lib + spf + mbr);
      if (tempRmt) {
        const sourceColourSupport = GlobalConfiguration.get<boolean>(`showSeuColors`);
        const tmpobj = await tmpFile();

        const sourceData = body.split(`\n`);
        const recordLength = this.sourceDateHandler.recordLengths.get(alias) || await this.getRecordLength(aliasPath, lib, spf);

        const decimalSequence = sourceData.length >= 10000;

        let rows = [],
          sequence = 0;
        for (let i = 0; i < sourceData.length; i++) {
          sequence = decimalSequence ? ((i + 1) / 100) : i + 1;
          if (sourceData[i].length > recordLength) {
            sourceData[i] = sourceData[i].substring(0, recordLength);
          }

          // We only want to do the translate when source colours at enabled.
          // For large sources, translate adds a bunch of time to the saving process.
          if (sourceColourSupport)
            rows.push(
              `(${sequence}, ${sourceDates[i] ? sourceDates[i].padEnd(6, `0`) : `0`}, translate('${escapeString(sourceData[i])}', ${SEU_GREEN_UL_RI}, ${SEU_GREEN_UL_RI_temp}))`,
            );
          else
            rows.push(
              `(${sequence}, ${sourceDates[i] ? sourceDates[i].padEnd(6, `0`) : `0`}, '${escapeString(sourceData[i])}')`,
            );

        }

        //We assume the alias still exists....
        const tempTable = `QTEMP.NEWMEMBER`;
        const query: string[] = [
          `CREATE TABLE ${tempTable} LIKE "${lib}"."${spf}";`,
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
          `CALL QSYS2.QCMDEXC('CLRPFM FILE(${lib}/${spf}) MBR(${mbr})');`,
          `insert into ${aliasPath} (select * from ${tempTable});`
        )

        await writeFileAsync(tmpobj, query.join(`\n`), `utf8`);
        await client.putFile(tmpobj, tempRmt);

        if (setccsid) {
          await connection.sendCommand({ command: `${setccsid} 1208 ${tempRmt}` });
        }

        const insertResult = await connection.runCommand({
          command: `QSYS/RUNSQLSTM SRCSTMF('${tempRmt}') COMMIT(*NONE) NAMING(*SQL)`,
          noLibList: true
        });

        if (insertResult.code !== 0) {
          throw new Error(`Failed to save member: ` + insertResult.stderr);
        }

        if (this.sourceDateHandler.sourceDateMode === `diff`) {
          this.sourceDateHandler.baseSource.set(alias, body);
          this.sourceDateHandler.baseDates.set(alias, sourceDates);
        }
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