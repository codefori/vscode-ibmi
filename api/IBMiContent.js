const IBMi = require('./IBMi');

const util = require('util');
var fs = require('fs');
const tmp = require('tmp');

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
}