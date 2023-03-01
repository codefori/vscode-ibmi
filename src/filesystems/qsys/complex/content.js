let {default: IBMi} = require(`../../../api/IBMi`);
let {instance} = require(`../../../instantiate`);

const util = require(`util`);
const fs = require(`fs`);
const tmp = require(`tmp`);

const tmpFile = util.promisify(tmp.file);
const writeFileAsync = util.promisify(fs.writeFile);

const {calcNewSourceDates} = require(`./handlers/diffHandler`);

const DEFAULT_RECORD_LENGTH = 80;
let { baseDates, recordLengths, getAliasName, baseSource } = require(`./data`);

// Translate x'25' to x'2F' and back, or x'25' will become x'0A' (linefeed)!
const SEU_GREEN_UL_RI = `x'25'`;
const SEU_GREEN_UL_RI_temp = `x'2F'`;

module.exports = class IBMiContent {
  /**
   * Download the contents of a source member using SQL.
   * This option also stores the source dates internally.
   * @param {string|undefined} asp
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   */
  static async downloadMemberContentWithDates(asp, lib, spf, mbr) {
    const connection = instance.getConnection();
    const content = instance.getContent();
    const config = connection.config;

    lib = lib.toUpperCase();
    spf = spf.toUpperCase();
    mbr = mbr.toUpperCase();

    const tempLib = config.tempLibrary;
    const alias = getAliasName(lib, spf, mbr);
    const aliasPath = `${tempLib}.${alias}`;
  
    try {
      await content.runSQL(`CREATE OR REPLACE ALIAS ${aliasPath} for "${lib}"."${spf}"("${mbr}")`);
    } catch (e) {}

    if (recordLengths[alias] === undefined) {
      const result = await content.runSQL(`SELECT LENGTH(srcdta) as LENGTH FROM ${aliasPath} limit 1`);
      if (result.length > 0) {
        recordLengths[alias] = Number(result[0].LENGTH);
      } else {
        const result = await content.runSQL(`SELECT row_length-12 as LENGTH FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = '${lib}' and TABLE_NAME = '${spf}' limit 1`);
        if (result.length > 0) {
          recordLengths[alias] = Number(result[0].LENGTH);
        } else {
          recordLengths[alias] = DEFAULT_RECORD_LENGTH;
        }
      }
    }
  
    let rows = await content.runSQL(
      `select srcdat, rtrim(translate(srcdta, ${SEU_GREEN_UL_RI_temp}, ${SEU_GREEN_UL_RI})) as srcdta from ${aliasPath}`
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

    baseDates[alias] = sourceDates;

    if (config.sourceDateMode === `diff`) {
      baseSource[alias] = body;
    }

    return body;

  }

  /**
   * Upload to a member with source dates 
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   * @param {string} body 
   */
  static async uploadMemberContentWithDates(asp, lib, spf, mbr, body) {
    const connection = instance.getConnection();
    const setccsid = connection.remoteFeatures.setccsid;
    const config = connection.config;

    const tempLib = config.tempLibrary;
    const alias = getAliasName(lib, spf, mbr);
    const aliasPath = `${tempLib}.${alias}`;
    
    const sourceDates = config.sourceDateMode === `edit` ? baseDates[alias] : calcNewSourceDates(alias, body);

    const client = connection.client;
    const tempRmt = connection.getTempRemote(lib + spf + mbr);
    const tmpobj = await tmpFile();

    const sourceData = body.split(`\n`);
    const recordLength = recordLengths[alias] || DEFAULT_RECORD_LENGTH;

    const decimalSequence = sourceData.length >= 10000;

    let rows = [],
      sequence = 0;
    for (let i = 0; i < sourceData.length; i++) {
      sequence = decimalSequence ? ((i + 1) / 100) : i + 1;
      if (sourceData[i].length > recordLength) {
        sourceData[i] = sourceData[i].substring(0, recordLength);
      }
        
      rows.push(
        `(${sequence}, ${sourceDates[i] ? sourceDates[i].padEnd(6, `0`) : `0`}, translate('${this.escapeString(sourceData[i])}', ${SEU_GREEN_UL_RI}, ${SEU_GREEN_UL_RI_temp}))`,
      );
    }

    //We assume the alias still exists....
    const query = [];

    const rowGroups = this.sliceUp(rows, 5000);
    rowGroups.forEach(rowGroup => {
      query.push(`insert into ${aliasPath} values ${rowGroup.join(`,`)};`);
    });

    await writeFileAsync(tmpobj, query.join(`\n`), `utf8`);
    await client.putFile(tmpobj, tempRmt);

    await connection.remoteCommand(`CLRPFM FILE(${lib}/${spf}) MBR(${mbr})`);
    if (setccsid) await connection.paseCommand(`${setccsid} 1208 ${tempRmt}`);
    await connection.remoteCommand(
      `QSYS/RUNSQLSTM SRCSTMF('${tempRmt}') COMMIT(*NONE) NAMING(*SQL)`,
    );
  
    if (config.sourceDateMode === `diff`) {
      baseSource[alias] = body;
      baseDates[alias] = sourceDates;
    }
  }

  /**
   * 
   * @param {string} val 
   * @returns {string}
   */
  static escapeString(val) {
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
      case `\t`:
        return `\\t`;
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

  /**
   * @param {any[]} arr 
   * @param {number} size 
   * @returns {any[]}
   */
  static sliceUp(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}
