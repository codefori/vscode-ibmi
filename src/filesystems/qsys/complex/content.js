let IBMi = require(`../../../api/IBMi`);
let instance = require(`../../../Instance`);

const util = require(`util`);
const fs = require(`fs`);
const tmp = require(`tmp`);

const tmpFile = util.promisify(tmp.file);
const writeFileAsync = util.promisify(fs.writeFile);

let allSourceDates = require(`./sourceDates`);

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
    const rfile = connection.remoteFeatures.Rfile;

    lib = lib.toUpperCase();
    spf = spf.toUpperCase();
    mbr = mbr.toUpperCase();

    if (rfile) {
      const alias = `${lib}_${spf}_${mbr.replace(/\./g, `_`)}`;
  
      const path = IBMi.qualifyPath(asp, lib, spf, mbr);

      /** @type {string} */
      // @ts-ignore
      const data = await connection.paseCommand(
        `${rfile} -sr ${path}`
      );

      const rows = data.split(`\n`);
  
      const sourceDates = rows.map(row => row.substr(6, 6));
      const body = rows
        .map(row => row.substr(12))
        .join(`\n`);

      allSourceDates[alias] = sourceDates;

      return body;

    } else {
      throw new Error(`rfile not installed on remote server.`);
    }
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
    const rfile = connection.remoteFeatures.Rfile;

    if (rfile) {
      const alias = `${lib}_${spf}_${mbr.replace(/\./g, `_`)}`;
      const sourceDates = allSourceDates[alias];

      const client = connection.client;
      const tempRmt = connection.getTempRemote(lib + spf + mbr);
      const tmpobj = await tmpFile();
  
      const path = IBMi.qualifyPath(asp, lib, spf, mbr);

      const sourceData = body.split(`\n`);

      let rows = [],
        sequence = 0;
      for (let i = 0; i < sourceData.length; i++) {
        sequence = i + 1;
        rows.push(
          `${String(sequence).padStart(6, `0`)}${sourceDates[i]}${sourceData[i]}`
        );
      }

      await writeFileAsync(tmpobj, rows.join(`\n`), `utf8`);
      await client.putFile(tmpobj, tempRmt);

      //await connection.remoteCommand(`CLRPFM FILE(${lib}/${spf}) MBR(${mbr})`);
      await connection.paseCommand(
        `${rfile} -sw ${path} < ${tempRmt}`,
      );
  
    } else {
      throw new Error(`db2util not installed on remote server.`);
    }
  }
}
