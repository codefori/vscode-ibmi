const {default: IBMi} = require(`./IBMi`);

const path = require(`path`);
const util = require(`util`);
let fs = require(`fs`);
const tmp = require(`tmp`);
const csv = require(`csv/sync`);
const Tools = require(`./Tools`);

const tmpFile = util.promisify(tmp.file);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const UTF8_CCSIDS = [`819`, `1208`, `1252`];

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
    const features = this.ibmi.remoteFeatures;
    const config = this.ibmi.config;
    const client = this.ibmi.client;

    if (config.autoConvertIFSccsid && features.attr && features.iconv) {
      // If it's not 1208, generate a temp file with the converted content
      let ccsid = await this.ibmi.paseCommand(`${features.attr} "${remotePath}" CCSID`);
      if (typeof ccsid === `string`) {
        //What's the point of converting 1208?
        if (!UTF8_CCSIDS.includes(ccsid)) {
          ccsid = ccsid.padStart(3, `0`);
          const newTempFile = this.ibmi.getTempRemote(remotePath);
          await this.ibmi.paseCommand(`${features.iconv} -f IBM-${ccsid} -t UTF-8 "${remotePath}" > ${newTempFile}`);
          remotePath = newTempFile;
        }
      }
    }

    if (localPath == null) localPath = await tmpFile();
    await client.getFile(localPath, remotePath);
    return readFileAsync(localPath, `utf8`);
  }

  async writeStreamfile(originalPath, content) {
    const client = this.ibmi.client;
    const features = this.ibmi.remoteFeatures;
    const config = this.ibmi.config;

    let tmpobj = await tmpFile();

    let ccsid;

    if (config.autoConvertIFSccsid && features.attr && features.iconv) {
      // First, find the CCSID of the original file
      ccsid = await this.ibmi.paseCommand(`${features.attr} "${originalPath}" CCSID`);
      if (typeof ccsid === `string`) {
        if (UTF8_CCSIDS.includes(ccsid)) {
          ccsid = undefined; // Don't covert...
        } else {
          ccsid = ccsid.padStart(3, `0`);
        }
      }
    }

    await writeFileAsync(tmpobj, content, `utf8`);

    if (ccsid) {
      // Upload our file to the same temp file, then write convert it back to the original ccsid
      const tempFile = this.ibmi.getTempRemote(originalPath);
      await client.putFile(tmpobj, tempFile);
      return this.ibmi.paseCommand(`${features.iconv} -f UTF-8 -t IBM-${ccsid} "${tempFile}" > ${originalPath}`);

    } else {
      return client.putFile(tmpobj, originalPath);
    }
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

    const path = Tools.qualifyPath(asp, lib, spf, mbr);
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
   * @param {string|Uint8Array} content 
   */
  async uploadMemberContent(asp, lib, spf, mbr, content) {
    if (!asp) asp = this.ibmi.config.sourceASP;
    lib = lib.toUpperCase();
    spf = spf.toUpperCase();
    mbr = mbr.toUpperCase();

    const client = this.ibmi.client;
    const path = Tools.qualifyPath(asp, lib, spf, mbr);
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
    const { 'QZDFMDB2.PGM': QZDFMDB2 } = this.ibmi.remoteFeatures;

    if (QZDFMDB2) {
      // Well, the fun part about db2 is that it always writes to standard out.
      // It does not write to standard error at all.

      // We join all new lines together
      //statement = statement.replace(/\n/g, ` `);

      const output = await this.ibmi.sendCommand({
        command: `LC_ALL=EN_US.UTF-8 system "call QSYS/QZDFMDB2 PARM('-d' '-i' '-t')"`,
        stdin: statement,
      })

      if (output.stdout) {
        return Tools.db2Parse(output.stdout);
      } else {
        throw new Error(`There was an error running the SQL statement.`);
      }

    } else {
      throw new Error(`There is no way to run SQL on this system.`);
    }
  }

  /**
   * Download the contents of a table.
   * @param {string} lib 
   * @param {string} file 
   * @param {string} [mbr] Will default to file provided 
   * @param {boolean} [deleteTable] Will delete the table after download
   */
  async getTable(lib, file, mbr, deleteTable) {
    if (!mbr) mbr = file; //Incase mbr is the same file

    if (file === mbr && this.ibmi.config.enableSQL) {
      const data = await this.runSQL(`SELECT * FROM ${lib}.${file}`);
      
      if (deleteTable && this.ibmi.config.autoClearTempData) {
        this.ibmi.remoteCommand(`DLTOBJ OBJ(${lib}/${file}) OBJTYPE(*FILE)`, `.`);
      }

      return data;

    } else {
      const tempRmt = this.ibmi.getTempRemote(Tools.qualifyPath(undefined, lib, file, mbr));

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

      if (this.ibmi.config.autoClearTempData) {
        this.ibmi.paseCommand(`rm -f ` + tempRmt, `.`);
        if (deleteTable)
          this.ibmi.remoteCommand(`DLTOBJ OBJ(${lib}/${file}) OBJTYPE(*FILE)`, `.`);
      }

      return csv.parse(result, {
        columns: true,
        skip_empty_lines: true,
      });
    }
    
  }

  /**
   * Get list of libraries with description and attribute
   * @param {string[]} libraries Array of libraries to retrieve
   * @returns {Promise<{name: string, text: string, attribute: string}[]>} List of libraries
   */
  async getLibraryList(libraries) {
    const config = this.ibmi.config;
    const tempLib = this.ibmi.config.tempLibrary;
    const TempName = Tools.makeid();
    let results;

    if (config.enableSQL) {
      const statement = `
        select os.OBJNAME as ODOBNM
             , coalesce(os.OBJTEXT, '') as ODOBTX
             , os.OBJATTRIBUTE as ODOBAT
          from table( SYSTOOLS.SPLIT( INPUT_LIST => '${libraries.toString()}', DELIMITER => ',' ) ) libs
             , table( QSYS2.OBJECT_STATISTICS( OBJECT_SCHEMA => 'QSYS', OBJTYPELIST => '*LIB', OBJECT_NAME => libs.ELEMENT ) ) os
      `;
      results = await this.runSQL(statement);
    } else {
      await this.ibmi.remoteCommand(`DSPOBJD OBJ(QSYS/*ALL) OBJTYPE(*LIB) DETAIL(*TEXTATR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
      results = await this.getTable(tempLib, TempName, TempName, true);

      if (results.length === 1) {
        if (results[0].ODOBNM.trim() === ``) {
          return []
        }
      };

      results = results.filter(object => (libraries.includes(this.ibmi.sysNameInLocal(object.ODOBNM))));
    };

    results = results.map(object => ({
      name: config.enableSQL ? object.ODOBNM : this.ibmi.sysNameInLocal(object.ODOBNM),
      attribute: object.ODOBAT,
      text: object.ODOBTX
    }));

    return libraries.map(lib => {
      const index = results.findIndex(info => info.name === lib);
      if (index >= 0) {
        return results[index];
      } else {
        return {
          name: lib,
          attribute: ``,
          text: `*** NOT FOUND ***`
        };
      }
    });
  }

  /**
   * @param {{library: string, object?: string, types?: string[]}} filters 
   * @param {string?} sortOrder
   * @returns {Promise<{library: string, name: string, type: string, text: string, attribute: string, count?: number}[]>} List of members 
   */
  async getObjectList(filters, sortOrder = `name`) {
    const library = filters.library.toUpperCase();
    const object = (filters.object && filters.object !== `*` ? filters.object.toUpperCase() : `*ALL`);
    const sourceFilesOnly = (filters.types && filters.types.includes(`*SRCPF`));

    const tempLib = this.ibmi.config.tempLibrary;
    const TempName = Tools.makeid();

    if (sourceFilesOnly) {
      await this.ibmi.remoteCommand(`DSPFD FILE(${library}/${object}) TYPE(*ATR) FILEATR(*PF) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);

      const results = await this.getTable(tempLib, TempName, TempName, true);
      if (results.length === 1) {
        if (results[0].PHFILE.trim() === ``) {
          return []
        }
      }

      return results
        .filter(object => object.PHDTAT === `S`)
        .map(object => ({
          library,
          name: this.ibmi.sysNameInLocal(object.PHFILE),
          type: `*FILE`,
          attribute: object.PHFILA,
          text: object.PHTXT,
          count: object.PHNOMB,
        }))
        .sort((a, b) => {
          if (a.library.localeCompare(b.library) != 0) return a.library.localeCompare(b.library)
          else return a.name.localeCompare(b.name);
        });

    } else {
      const objectTypes = (filters.types && filters.types.length > 0 ? filters.types.map(type => type.toUpperCase()).join(` `) : `*ALL`);

      await this.ibmi.remoteCommand(`DSPOBJD OBJ(${library}/${object}) OBJTYPE(${objectTypes}) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
      const results = await this.getTable(tempLib, TempName, TempName, true);

      if (results.length === 1) {
        if (results[0].ODOBNM.trim() === ``) {
          return []
        }
      }

      const internalObjType = this.getObjectTypeMap();

      return results
        .map(object => ({
          library,
          name: this.ibmi.sysNameInLocal(object.ODOBNM),
          type: object.ODOBTP,
          attribute: object.ODOBAT,
          text: object.ODOBTX
        }))
        .sort((a, b) => {
          if (a.library.localeCompare(b.library) != 0) return a.library.localeCompare(b.library)
          else if (sortOrder === `name`) return a.name.localeCompare(b.name)
          else {
            if (internalObjType.get(a.type) < internalObjType.get(b.type)) return -1;
            else if (internalObjType.get(a.type) > internalObjType.get(b.type)) return 1;
            else return a.name.localeCompare(b.name);
          }
        });
    }
  }

  /**
   * @param {string} lib 
   * @param {string} spf
   * @param {string} [mbr]
   * @returns {Promise<{asp?: string, library: string, file: string, name: string, extension: string, recordLength: number, text: string}[]>} List of members 
   */
  async getMemberList(lib, spf, mbr = `*`, ext = `*`) {
    const config = this.ibmi.config;
    const library = lib.toUpperCase();
    const sourceFile = spf.toUpperCase();
    let member = (mbr !== `*` ? mbr : null);
    let memberExt = (ext !== `*` ? ext : null);

    let results;

    if (config.enableSQL) {
      if (member) member = member.replace(/[*]/g, `%`);
      if (memberExt) memberExt = memberExt.replace(/[*]/g, `%`);

      const statement = `
        SELECT
          (b.avgrowsize - 12) as MBMXRL,
          a.iasp_number as MBASP,
          cast(a.system_table_name as char(10) for bit data) AS MBFILE,
          cast(b.system_table_member as char(10) for bit data) as MBNAME,
          coalesce(cast(b.source_type as varchar(10) for bit data), '') as MBSEU2,
          coalesce(b.partition_text, '') as MBMTXT
        FROM qsys2.systables AS a
          JOIN qsys2.syspartitionstat AS b
            ON b.table_schema = a.table_schema AND
              b.table_name = a.table_name
        WHERE
          cast(a.system_table_schema as char(10) for bit data) = '${library}' 
          ${sourceFile !== `*ALL` ? `AND cast(a.system_table_name as char(10) for bit data) = '${sourceFile}'` : ``}
          ${member ? `AND rtrim(cast(b.system_table_member as char(10) for bit data)) like '${member}'` : ``}
          ${memberExt ? `AND rtrim(coalesce(cast(b.source_type as varchar(10) for bit data), '')) like '${memberExt}'` : ``}
      `;
      results = await this.runSQL(statement);

    } else {
      const tempLib = config.tempLibrary;
      const TempName = Tools.makeid();

      await this.ibmi.remoteCommand(`DSPFD FILE(${library}/${sourceFile}) TYPE(*MBR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
      results = await this.getTable(tempLib, TempName, TempName, true);

      if (results.length === 1) {
        if (results[0].MBNAME.trim() === ``) {
          return []
        }
      }

      if (member || memberExt) {
        let pattern, patternExt;
        if (member) pattern = new RegExp(`^` + member.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
        if (memberExt) patternExt = new RegExp(`^` + memberExt.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
        results = results.filter(row => ((pattern === undefined || pattern.test(row.MBNAME)) && (patternExt === undefined || patternExt.test(row.MBSEU2))));
      }
    }
    
    if (results.length === 0) return [];

    results = results.sort((a, b) => {
      return a.MBNAME.localeCompare(b.MBNAME);
    });

    const asp = this.ibmi.aspInfo[Number(results[0].MBASP)];

    return results.map(result => ({
      asp: asp,
      library: library,
      file: result.MBFILE,
      name: result.MBNAME,
      extension: result.MBSEU2,
      recordLength: Number(result.MBMXRL),
      text: `${result.MBMTXT || ``}${sourceFile === `*ALL` ? ` (${result.MBFILE})` : ``}`.trim()
    }));
  }

  /**
   * Get list of items in a path
   * @param {string} remotePath 
   * @return {Promise<{type: "directory"|"streamfile", name: string, path: string}[]>} Resulting list
   */
  async getFileList(remotePath) {
    const result = await this.ibmi.sendCommand({
      command: `ls -a -p -L ${Tools.escapePath(remotePath)}`
    });

    //@ts-ignore
    const fileList = result.stdout;

    if (fileList !== ``) {
      let list = fileList.split(`\n`);

      //Remove current and dir up.
      list = list.filter(item => item !== `../` && item !== `./`);

      const items = list.map(item => {
        const type = (item.endsWith(`/`) ? `directory` : `streamfile`);

        return {
          type, 
          name: (type === `directory` ? item.substring(0, item.length - 1) : item),
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

  /**
   * @returns {Map([])} objTypes
   */
  getObjectTypeMap() {
    // https://www.ibm.com/docs/api/v1/content/ssw_ibm_i_73/rbam6/rbam6objecttypes.htm
    return new Map([
      [`*ALRTBL`, 0x0E09],
      [`*AUTL`,   0x1B01],
      [`*BNDDIR`, 0x1937],
      [`*CFGL`,   0x1918],
      [`*CHTFMT`, 0x190D],
      [`*CLD`,    0x190B],
      [`*CLS`,    0x1904],
      [`*CMD`,    0x1905],
      [`*CNNL`,   0x1701],
      [`*COSD`,   0x1401],
      [`*CRG`,    0x192C],
      [`*CRQD`,   0x0E0F],
      [`*CSI`,    0x1935],
      [`*CSPMAP`, 0x1922],
      [`*CSPTBL`, 0x1923],
      [`*CTLD`,   0x1201],
      [`*DEVD`,   0x1001],
      [`*DTAARA`, 0x190A],
      [`*DTADCT`, 0x1920],
      [`*DTAQ`,   0x0A01],
      [`*EDTD`,   0x1908],
      [`*EXITRG`, 0x1913],
      [`*FCT`,    0x0E04],
      [`*FILE`,   0x1901],
      [`*FNTRSC`, 0x1926],
      [`*FNTTBL`, 0x192B],
      [`*FORMDF`, 0x1928],
      [`*FTR`,    0x0E0B],
      [`*GSS`,    0x190C],
      [`*IGCDCT`, 0x0E06],
      [`*IGCSRT`, 0x191A],
      [`*IGCTBL`, 0x1910],
      [`*IMGCLG`, 0x192E],
      [`*IPXD`,   0x191E],
      [`*JOBD`,   0x1903],
      [`*JOBQ`,   0x0E01],
      [`*JOBSCD`, 0x0E0C],
      [`*JRN`,    0x0901],
      [`*JRNRCV`, 0x0701],
      [`*LIB`,    0x0401],
      [`*LIND`,   0x1101],
      [`*LOCALE`, 0x1921],
      [`*MEDDFN`, 0x191C],
      [`*MENU`,   0x1916],
      [`*MGTCOL`, 0x192D],
      [`*MODD`,   0x1501],
      [`*MODULE`, 0x0301],
      [`*MSGF`,   0x0E03],
      [`*MSGQ`,   0x1902],
      [`*M36`,    0x1E04],
      [`*M36CFG`, 0x1924],
      [`*NODGRP`, 0x192A],
      [`*NODL`,   0x0E0E],
      [`*NTBD`,   0x1914],
      [`*NWID`,   0x1601],
      [`*NWSCFG`, 0x1939],
      [`*NWSD`,   0x1D01],
      [`*OUTQ`,   0x0E02],
      [`*OVL`,    0x1929],
      [`*PAGDFN`, 0x1936],
      [`*PAGSEG`, 0x1927],
      [`*PDFMAP`, 0x0E11],
      [`*PDG`,    0x1930],
      [`*PGM`,    0x0201],
      [`*PNLGRP`, 0x1915],
      [`*PRDAVL`, 0x1933],
      [`*PRDDFN`, 0x191B],
      [`*PRDLOD`, 0x191D],
      [`*PSFCFG`, 0x1925],
      [`*QMFORM`, 0x1932],
      [`*QMQRY`,  0x1931],
      [`*QRYDFN`, 0x1911],
      [`*RCT`,    0x0E08],
      [`*SBSD`,   0x1909],
      [`*SCHIDX`, 0x0E07],
      [`*SPADCT`, 0x1C01],
      [`*SQLPKG`, 0x0202],
      [`*SQLUDT`, 0x191F],
      [`*SQLXSR`, 0x1949],
      [`*SRVPGM`, 0x0203],
      [`*SSND`,   0x0E05],
      [`*SVRSTG`, 0x1917],
      [`*S36`,    0x1919],
      [`*TBL`,    0x1906],
      [`*TIMZON`, 0x192F],
      [`*USRIDX`, 0x0E0A],
      [`*USRPRF`, 0x0801],
      [`*USRQ`,   0x0A02],
      [`*USRSPC`, 0x1934],
      [`*VLDL`,   0x0E10],
      [`*WSCST`,  0x1938]
      ]);
  }
}
