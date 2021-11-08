const IBMi = require(`./IBMi`);

const path = require(`path`);
const util = require(`util`);
let fs = require(`fs`);
const tmp = require(`tmp`);
const parse = require(`csv-parse/lib/sync`);

const tmpFile = util.promisify(tmp.file);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

module.exports = class IBMiContent {
  /**
   * @param {IBMi} instance 
   */
  constructor(instance) {
    this.ibmi = instance;
  }

  /**
   * @param {string} remotePath 
   * @param {string} localPath 
   */
  async downloadStreamfile(remotePath, localPath = null) {
    const client = this.ibmi.client;

    if (localPath == null) localPath = await tmpFile();
    await client.getFile(localPath, remotePath);
    return readFileAsync(localPath, `utf8`);
  }

  async writeStreamfile(remotePath, content) {
    const client = this.ibmi.client;
    let tmpobj = await tmpFile();

    await writeFileAsync(tmpobj, content, `utf8`);
    return client.putFile(tmpobj, remotePath); // assumes streamfile will be UTF8
  }

  /**
   * Download the contents of a source member
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   */
  async downloadMemberContent(asp, lib, spf, mbr) {
    if (!asp) asp = this.ibmi.config.sourceASP;
    lib = lib.toUpperCase();
    spf = spf.toUpperCase();
    mbr = mbr.toUpperCase();

    const path = IBMi.qualifyPath(asp, lib, spf, mbr);
    const tempRmt = this.ibmi.getTempRemote(path);
    const tmpobj = await tmpFile();
    const client = this.ibmi.client;

    let retried = false;
    let retry = 1;

    while (retry > 0) {
      retry--;
      try {
        //If this command fails we need to try again after we delete the temp remote
        await this.ibmi.remoteCommand(
          `CPYTOSTMF FROMMBR('${path}') TOSTMF('${tempRmt}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.ibmi.config.sourceFileCCSID})`, `.`
        );
      } catch (e) {
        if (e.startsWith(`CPDA08A`)) {
          if (!retried) {
            await this.ibmi.paseCommand(`rm -f ` + tempRmt, `.`);
            retry++;
            retried = true;
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
    }
    
    await client.getFile(tmpobj, tempRmt);
    let body = await readFileAsync(tmpobj, `utf8`);

    return body;
  }

  /**
   * Upload to a member
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} mbr 
   * @param {string} content 
   */
  async uploadMemberContent(asp, lib, spf, mbr, content) {
    if (!asp) asp = this.ibmi.config.sourceASP;
    lib = lib.toUpperCase();
    spf = spf.toUpperCase();
    mbr = mbr.toUpperCase();

    const client = this.ibmi.client;
    const path = IBMi.qualifyPath(asp, lib, spf, mbr);
    const tempRmt = this.ibmi.getTempRemote(path);
    const tmpobj = await tmpFile();

    try {
      await writeFileAsync(tmpobj, content, `utf8`);

      await client.putFile(tmpobj, tempRmt);
      await this.ibmi.remoteCommand(
        `QSYS/CPYFRMSTMF FROMSTMF('${tempRmt}') TOMBR('${path}') MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.ibmi.config.sourceFileCCSID})`,
      );

      return true;
    } catch (error) {
      console.log(`Failed uploading member: ` + error);
      return Promise.reject(error);
    }
  }
  
  /**
   * Run an SQL statement
   * @param {string} statement 
   * @returns {Promise<any[]>} Result set
   */
  async runSQL(statement) {
    const command = this.ibmi.remoteFeatures.db2util;

    if (command) {
      statement = statement.replace(/"/g, `\\"`);
      let output = await this.ibmi.paseCommand(`DB2UTIL_JSON_CONTAINER=array ${command} -o json "${statement}"`);

      if (typeof output === `string`) {
        //Little hack for db2util returns blanks where it should be null.
        output = output.replace(new RegExp(`:,`, `g`), `:null,`);
        output = output.replace(new RegExp(`:}`, `g`), `:null}`);
        const rows = JSON.parse(output);
        for (let row of rows)
          for (let key in row) {
            if (typeof row[key] === `string`) row[key] = row[key].trim();
            if (row[key] === `null`) row[key] = null;
          }

        return rows;
      } else {
        return [];
      }
    } else {
      throw new Error(`db2util not installed on remote server.`);
    }
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
      `QSYS/CPYTOIMPF FROMFILE(` +
        lib +
        `/` +
        file +
        ` ` +
        mbr +
        `) ` +
        `TOSTMF('` +
        tempRmt +
        `') MBROPT(*REPLACE) STMFCCSID(1208) RCDDLM(*CRLF) DTAFMT(*DLM) RMVBLANK(*TRAILING) ADDCOLNAM(*SQL) FLDDLM(',') DECPNT(*PERIOD) `,
    );

    let result = await this.downloadStreamfile(tempRmt);

    return parse(result, {
      columns: true,
      skip_empty_lines: true,
    });
    
  }

  /**
   * @param {{library: string, object?: string, types?: string[]}} filters 
   * @returns {Promise<{library: string, name: string, type: string, text: string}[]>} List of members 
   */
  async getObjectList(filters) {
    const library = filters.library.toUpperCase();
    const object = (filters.object && filters.object !== `*` ? filters.object.toUpperCase() : `*ALL`);
    const sourceFilesOnly = (filters.types && filters.types.includes(`*SRCPF`));

    const tempLib = this.ibmi.config.tempLibrary;
    const TempName = IBMi.makeid();

    if (sourceFilesOnly) {
      await this.ibmi.remoteCommand(`DSPFD FILE(${library}/${object}) TYPE(*ATR) FILEATR(*PF) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);

      const results = await this.getTable(tempLib, TempName, TempName);

      if (results.length === 1) {
        if (results[0].PHFILE.trim() === ``) {
          return []
        }
      }

      return results
        .filter(object => object.PHDTAT === `S`)
        .map(object => ({
          library,
          name: object.PHFILE,
          type: `*FILE`,
          attribute: object.PHFILA,
          text: object.PHTXT
        }));

    } else {
      const objectTypes = (filters.types && filters.types.length > 0 ? filters.types.map(type => type.toUpperCase()).join(` `) : `*ALL`);

      await this.ibmi.remoteCommand(`DSPOBJD OBJ(${library}/${object}) OBJTYPE(${objectTypes}) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
      const results = await this.getTable(tempLib, TempName, TempName);

      if (results.length === 1) {
        if (results[0].ODOBNM.trim() === ``) {
          return []
        }
      }

      return results.map(object => ({
        library,
        name: object.ODOBNM,
        type: object.ODOBTP,
        attribute: object.ODOBAT,
        text: object.ODOBTX
      }));
    }
  }

  /**
   * @param {string} lib 
   * @param {string} spf
   * @param {string} [mbr]
   * @returns {Promise<{asp?: string, library: string, file: string, name: string, extension: string, recordLength: number, text: string}[]>} List of members 
   */
  async getMemberList(lib, spf, mbr = `*`) {
    const library = lib.toUpperCase();
    const sourceFile = spf.toUpperCase();
    let member = (mbr !== `*` ? mbr : null);

    let results;

    if (this.ibmi.remoteFeatures.db2util) {
      if (member && member.endsWith(`*`)) member = member.substring(0, member.length - 1) + `%`;

      results = await this.runSQL(`
        SELECT
          (b.avgrowsize - 12) as MBMXRL,
          a.iasp_number as MBASP,
          a.table_name AS MBFILE,
          b.system_table_member as MBNAME,
          b.source_type as MBSEU2,
          b.partition_text as MBMTXT
        FROM qsys2.systables AS a
          JOIN qsys2.syspartitionstat AS b
            ON b.table_schema = a.table_schema AND
              b.table_name = a.table_name
        WHERE
          a.table_schema = '${library}' 
          ${sourceFile !== `*ALL` ? `AND a.table_name = '${sourceFile}'` : ``}
          ${member ? `AND b.system_table_member like '${member}'` : ``}
      `)

    } else {
      const tempLib = this.ibmi.config.tempLibrary;
      const TempName = IBMi.makeid();

      await this.ibmi.remoteCommand(`DSPFD FILE(${library}/${sourceFile}) TYPE(*MBR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
      results = await this.getTable(tempLib, TempName, TempName);

      if (results.length === 1) {
        if (results[0].MBNAME.trim() === ``) {
          return []
        }
      }

      // There is no member parameter on the command so we have a slow filter.
      if (member) {
        results = results.filter(row => row.MBNAME.startsWith(member));
      }
    }

    if (results.length === 0) return [];

    const asp = this.ibmi.aspInfo[Number(results[0].MBASP)];

    return results.map(result => ({
      asp: asp,
      library: library,
      file: result.MBFILE,
      name: result.MBNAME,
      extension: result.MBSEU2,
      recordLength: Number(result.MBMXRL),
      text: `${result.MBMTXT || ``}${sourceFile === `*ALL` ? ` (${result.MBFILE})` : ``}`.trim()
    })).sort((a, b) => {
      if (a.name < b.name) { return -1; }
      if (a.name > b.name) { return 1; }
      return 0;
    });
  }

  /**
   * Get list of items in a path
   * @param {string} remotePath 
   * @return {Promise<{type: "directory"|"streamfile", name: string, path: string}[]>} Resulting list
   */
  async getFileList(remotePath) {
    const result = await this.ibmi.paseCommand(`ls -a -p ` + remotePath, undefined, 1);

    //@ts-ignore
    const fileList = result.stdout;

    if (typeof fileList === `string` && fileList !== ``) {
      let list = fileList.split(`\n`);

      //Remove current and dir up.
      list = list.filter(item => item !== `../` && item !== `./`);

      const items = list.map(item => {
        const type = ((item.substr(item.length - 1, 1) === `/`) ? `directory` : `streamfile`);

        return {
          type, 
          name: (type === `directory` ? item.substr(0, item.length - 1) : item),
          path: path.posix.join(remotePath, item)
        };
      });

      //@ts-ignore because it thinks "dictionary"|"streamfile" is a string from the sort call.
      return items.sort((a, b) => {
        if (a.name < b.name) { return -1; }
        if (a.name > b.name) { return 1; }
        return 0;
      });
    } else {
      return [];
    }
  }

  /**
   * @param {string} errorsString 
   * @returns {{code: string, text: string}[]} errors
   */
  parseIBMiErrors(errorsString) {
    let errors = [];

    let code, text;
    for (const error of errorsString.split(`\n`)) {
      [code, text] = error.split(`:`);
      errors.push({code, text});
    }

    return errors;
  }
}
