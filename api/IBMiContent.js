const IBMi = require('./IBMi');

const util = require('util');
var fs = require('fs');
const tmp = require('tmp');
const parse = require('csv-parse/lib/sync');

const tmpFile = util.promisify(tmp.file);
const readFileAsync = util.promisify(fs.readFile);

module.exports = class IBMiContent {
  /**
   * @param {IBMi} instance 
   */
  constructor(instance) {
    this.ibmi = instance;
  }

  /**
   * @param {string} remotePath 
   */
  async downloadStreamfile(remotePath) {
    const client = this.ibmi.client;

    var tmpobj = await tmpFile();
    await client.getFile(tmpobj, remotePath);
    return readFileAsync(tmpobj, 'utf8');
  }

  /**
   * Download the contents of a source member
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   */
  async downloadMemberContent(asp, lib, spf, mbr) {
    lib = lib.toUpperCase();
    spf = spf.toUpperCase();
    mbr = mbr.toUpperCase();

    const path = IBMi.qualifyPath(asp, lib, spf, mbr);
    const tempRmt = this.ibmi.getTempRemote(path);
    const tmpobj = await tmpFile();
    const client = this.ibmi.client;

    var retried = false;
    var retry = 1;

    while (retry > 0) {
      retry--;
      try {
        //If this command fails we need to try again after we delete the temp remote
        await this.ibmi.remoteCommand(
          `CPYTOSTMF FROMMBR('${path}') TOSTMF('${tempRmt}') STMFOPT(*REPLACE) STMFCCSID(1208)`, '.'
        );
      } catch (e) {
        if (e.startsWith("CPDA08A")) {
          if (!retried) {
            await this.ibmi.paseCommand(`rm -f ` + tempRmt, '.');
            retry++;
            retried = true;
          } else {
            throw e;
          }
        }
      }
    }
    
    await client.getFile(tmpobj, tempRmt);
    var body = await readFileAsync(tmpobj, 'utf8');

    return body;
  }

  /**
   * Download the contents of a table.
   * @param {string} lib 
   * @param {string} file 
   * @param {string} [mbr] Will default to file provided 
   */
  async getTable(lib, file, mbr) {
    if (!mbr) mbr = file; //Incase mbr is the same file

    const tempRmt = this.ibmi.getTempRemote(IBMi.qualifyPath(undefined, lib, file, mbr));

    await this.ibmi.remoteCommand(
      'QSYS/CPYTOIMPF FROMFILE(' +
        lib +
        '/' +
        file +
        ' ' +
        mbr +
        ') ' +
        "TOSTMF('" +
        tempRmt +
        "') MBROPT(*REPLACE) STMFCCSID(1208) RCDDLM(*CRLF) DTAFMT(*DLM) RMVBLANK(*TRAILING) ADDCOLNAM(*SQL)",
    );

    var result = await this.downloadStreamfile(tempRmt);

    return parse(result, {
      columns: true,
      skip_empty_lines: true,
    });
    
  }

  /**
   * @param {string} lib 
   * @param {string} spf
   * @returns {Promise<{library: string, file: string, name: string, extension: string, recordLength: number}[]>} List of members 
   */
  async getMemberList(lib, spf) {
    lib = lib.toUpperCase();
    spf = spf.toUpperCase();

    const tempLib = this.ibmi.tempLibrary;
    const TempName = IBMi.makeid();

    await this.ibmi.remoteCommand(`DSPFD FILE(${lib}/${spf}) TYPE(*MBR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
    const results = await this.getTable(tempLib, TempName, TempName);

    if (results.length === 1) {
      if (results[0].MBNAME.trim() === '') {
        return []
      }
    }

    return results.map(result => ({
      library: result.MBLIB,
      file: result.MLFILE,
      name: result.MBNAME,
      extension: result.MBSEU2,
      recordLength: Number(result.MBMXRL)
    }))
  }
}