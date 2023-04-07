import { default as IBMi } from './IBMi';

import path from 'path';
import util from 'util';
import tmp from 'tmp';
import { parse } from 'csv-parse/sync';
import { Tools } from './Tools';
import { ObjectTypes } from '../schemas/Objects';
import fs from 'fs';
import { ConnectionConfiguration } from './Configuration';
import { IBMiError, IBMiFile, IBMiMember, IBMiObject, IFSFile, QsysPath } from '../typings';
const tmpFile = util.promisify(tmp.file);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const UTF8_CCSIDS = [`819`, `1208`, `1252`];

export default class IBMiContent {

  constructor(readonly ibmi: IBMi) { }

  private get config(): ConnectionConfiguration.Parameters {
    if (!this.ibmi.config) {
      throw new Error("Please connect to an IBM i");
    }
    else {
      return this.ibmi.config;
    }
  }

  private getTempRemote(path: string) {
    const tempRemote = this.ibmi.getTempRemote(path);
    if (!tempRemote) {
      throw new Error(`Could not compute temporary remote location for ${path}`);
    }
    return tempRemote;
  }

  private async getNotUTF8CCSID(attr: string, remotePath: string): Promise<string> {
    const result = await this.ibmi.sendCommand({ command: `${attr} "${remotePath}" CCSID` });
    if (result.code === 0) {
      //What's the point of converting 1208?
      let ccsid = result.stdout.trim();
      if (!UTF8_CCSIDS.includes(ccsid)) {
        return ccsid.padStart(3, `0`);
      }
    }
    return "";
  }

  private async convertToUTF8(iconv: string, from: string, to: string, ccsid: string) {
    const result = await this.ibmi.sendCommand({ command: `${iconv} -f IBM-${ccsid} -t UTF-8 "${from}" > ${to}` });
    if (result.code === 0) {
      return result.stdout;
    }
    else {
      throw new Error(`Failed to convert ${from} to UTF-8: ${result.stderr}`);
    }
  }

  async downloadStreamfile(remotePath: string, localPath?: string) {
    const client = this.ibmi.client;
    const features = this.ibmi.remoteFeatures;

    if (this.config.autoConvertIFSccsid && features.attr && features.iconv) {
      // If it's not 1208, generate a temp file with the converted content
      const ccsid = await this.getNotUTF8CCSID(features.attr, remotePath);
      if (ccsid) {
        const newTempFile = this.getTempRemote(remotePath);
        await this.convertToUTF8(features.iconv, remotePath, newTempFile, ccsid);
        remotePath = newTempFile;
      }
    }

    if (!localPath) {
      localPath = await tmpFile();
    }
    await client.getFile(localPath, remotePath); //TODO: replace with downloadfile
    return readFileAsync(localPath, `utf8`);
  }

  async writeStreamfile(originalPath: any, content: any) {
    const client = this.ibmi.client;
    const features = this.ibmi.remoteFeatures;
    const tmpobj = await tmpFile();

    let ccsid;
    if (this.config.autoConvertIFSccsid && features.attr) {
      // First, find the CCSID of the original file if not UTF-8
      ccsid = await this.getNotUTF8CCSID(features.attr, originalPath);
    }

    await writeFileAsync(tmpobj, content, `utf8`);

    if (ccsid && features.iconv) {
      // Upload our file to the same temp file, then write convert it back to the original ccsid
      const tempFile = this.getTempRemote(originalPath);
      await client.putFile(tmpobj, tempFile); //TODO: replace with uploadFiles
      return await this.convertToUTF8(features.iconv, tempFile, originalPath, ccsid);
    } else {
      return client.putFile(tmpobj, originalPath);
    }
  }

  /**
   * Download the contents of a source member
   */
  async downloadMemberContent(asp: string | undefined, library: string, sourceFile: string, member: string) {
    asp = asp || this.config.sourceASP;
    library = library.toUpperCase();
    sourceFile = sourceFile.toUpperCase();
    member = member.toUpperCase();

    const path = Tools.qualifyPath(library, sourceFile, member, asp);
    const tempRmt = this.getTempRemote(path);
    const tmpobj = await tmpFile();
    const client = this.ibmi.client;

    let retried = false;
    let retry = 1;

    while (retry > 0) {
      retry--;
      try {
        //If this command fails we need to try again after we delete the temp remote
        await this.ibmi.remoteCommand(
          `CPYTOSTMF FROMMBR('${path}') TOSTMF('${tempRmt}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`, `.`
        );
      } catch (e) {
        if (String(e).startsWith(`CPDA08A`)) {
          if (!retried) {
            await this.ibmi.sendCommand({ command: `rm -f ${tempRmt}`, directory: `.` });
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
    return await readFileAsync(tmpobj, `utf8`);
  }

  /**
   * Upload to a member
   */
  async uploadMemberContent(asp: string | undefined, library: string, sourceFile: string, member: string, content: string | Uint8Array) {
    asp = asp || this.config.sourceASP;
    library = library.toUpperCase();
    sourceFile = sourceFile.toUpperCase();
    member = member.toUpperCase();

    const client = this.ibmi.client;
    const path = Tools.qualifyPath(library, sourceFile, member, asp);
    const tempRmt = this.getTempRemote(path);
    const tmpobj = await tmpFile();

    try {
      await writeFileAsync(tmpobj, content, `utf8`);

      await client.putFile(tmpobj, tempRmt);
      await this.ibmi.remoteCommand(
        `QSYS/CPYFRMSTMF FROMSTMF('${tempRmt}') TOMBR('${path}') MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`,
      );

      return true;
    } catch (error) {
      console.log(`Failed uploading member: ` + error);
      return Promise.reject(error);
    }
  }

  /**
   * Run an SQL statement
   * @param statement
   * @returns a Result set
   */
  async runSQL(statement: string): Promise<Tools.DB2Row[]> {
    const { 'QZDFMDB2.PGM': QZDFMDB2 } = this.ibmi.remoteFeatures;

    if (QZDFMDB2) {
      // Well, the fun part about db2 is that it always writes to standard out.
      // It does not write to standard error at all.

      // if comments present in sql statement, sql string needs to be checked
      if (statement.search(`--`) > -1) {
        statement = this.fixCommentsInSQLString(statement);
      }

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
   * @param library 
   * @param file 
   * @param member Will default to file provided 
   * @param deleteTable Will delete the table after download
   */
  async getTable(library: string, file: string, member: string, deleteTable?: boolean): Promise<Tools.DB2Row[]> {
    if (!member) member = file; //Incase mbr is the same file

    if (file === member && this.config.enableSQL) {
      const data = await this.runSQL(`SELECT * FROM ${library}.${file}`);

      if (deleteTable && this.config.autoClearTempData) {
        this.ibmi.remoteCommand(`DLTOBJ OBJ(${library}/${file}) OBJTYPE(*FILE)`, `.`);
      }

      return data;

    } else {
      const tempRmt = this.getTempRemote(Tools.qualifyPath(library, file, member));
      await this.ibmi.remoteCommand(
        `QSYS/CPYTOIMPF FROMFILE(${library}/${file} ${member}) ` +
        `TOSTMF('${tempRmt}') ` +
        `MBROPT(*REPLACE) STMFCCSID(1208) RCDDLM(*CRLF) DTAFMT(*DLM) RMVBLANK(*TRAILING) ADDCOLNAM(*SQL) FLDDLM(',') DECPNT(*PERIOD)`
      );

      let result = await this.downloadStreamfile(tempRmt);

      if (this.config.autoClearTempData) {
        await this.ibmi.sendCommand({ command: `rm -f ${tempRmt}`, directory: `.` });
        if (deleteTable) {
          this.ibmi.remoteCommand(`DLTOBJ OBJ(${library}/${file}) OBJTYPE(*FILE)`, `.`);
        }
      }

      return parse(result, {
        columns: true,
        skip_empty_lines: true,
        cast: true,
      });
    }

  }

  /**
   * Get list of libraries with description and attribute
   * @param libraries Array of libraries to retrieve
   * @returns an array of libraries as IBMiObject
   */
  async getLibraryList(libraries: string[]): Promise<IBMiObject[]> {
    const config = this.ibmi.config;
    const tempLib = this.config.tempLibrary;
    const TempName = Tools.makeid();
    let results: Tools.DB2Row[];

    if (this.config.enableSQL) {
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

      if (results.length === 1 && !results[0].ODOBNM?.toString().trim()) {
        return [];
      }

      results = results.filter(object => libraries.includes(this.ibmi.sysNameInLocal(String(object.ODOBNM))));
    };

    const objects = results.map(object => ({
      library: 'QSYS',
      type: '*LIB',
      name: this.config.enableSQL ? object.ODOBNM : this.ibmi.sysNameInLocal(String(object.ODOBNM)),
      attribute: object.ODOBAT,
      text: object.ODOBTX
    } as IBMiObject));

    return libraries.map(library => {
      return objects.find(info => info.name === library) ||
      {
        library: 'QSYS',
        type: '*LIB',
        name: library,
        attribute: ``,
        text: `*** NOT FOUND ***`
      };
    });
  }

  /**
   * Validates a list of libraries
   * @param newLibl Array of libraries to validate
   * @returns Bad libraries
   */
  async validateLibraryList(newLibl: string[]): Promise<string[]> {
    let badLibs: string[] = [];

    newLibl = newLibl.filter(lib => {
      if (lib.match(/^\d/)) {
        badLibs.push(lib);
        return false;
      }

      if (lib.length > 10) {
        badLibs.push(lib);
        return false;
      }

      return true;
    });

    const result = await this.ibmi.sendQsh({
      command: [
        `liblist -d ` + this.ibmi.defaultUserLibraries.join(` `).replace(/\$/g, `\\$`),
        ...newLibl.map(lib => `liblist -a ` + lib.replace(/\$/g, `\\$`))
      ].join(`; `)
    });

    if (result.stderr) {
      const lines = result.stderr.split(`\n`);

      lines.forEach(line => {
        const badLib = newLibl.find(lib => line.includes(`ibrary ${lib}`));

        // If there is an error about the library, remove it
        if (badLib) badLibs.push(badLib);
      });
    }

    return badLibs;
  }

  /**
   * @param filters 
   * @param sortOrder
   * @returns an array of IBMiFile 
   */
  async getObjectList(filters: { library: string; object?: string; types?: string[]; }, sortOrder?: `name` | `type`): Promise<IBMiFile[]> {
    const library = filters.library.toUpperCase();
    const object = (filters.object && filters.object !== `*` ? filters.object.toUpperCase() : `*ALL`);
    const sourceFilesOnly = (filters.types && filters.types.includes(`*SRCPF`));

    const tempLib = this.config.tempLibrary;
    const tempName = Tools.makeid();

    if (sourceFilesOnly) {
      await this.ibmi.remoteCommand(`DSPFD FILE(${library}/${object}) TYPE(*ATR) FILEATR(*PF) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${tempName})`);

      const results = await this.getTable(tempLib, tempName, tempName, true);
      if (results.length === 1 && !results[0].PHFILE?.toString().trim()) {
        return [];
      }

      return results.filter(object => object.PHDTAT === `S`)
        .map(object => ({
          library,
          name: this.ibmi.sysNameInLocal(String(object.PHFILE)),
          type: `*FILE`,
          attribute: String(object.PHFILA),
          text: String(object.PHTXT),
          count: Number(object.PHNOMB),
        } as IBMiFile))
        .sort((a, b) => a.library.localeCompare(b.library) || a.name.localeCompare(b.name));
    } else {
      const objectTypes = (filters.types && filters.types.length ? filters.types.map(type => type.toUpperCase()).join(` `) : `*ALL`);

      await this.ibmi.remoteCommand(`DSPOBJD OBJ(${library}/${object}) OBJTYPE(${objectTypes}) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${tempName})`);
      const results = await this.getTable(tempLib, tempName, tempName, true);

      if (results.length === 1 && !results[0].ODOBNM?.toString().trim()) {
        return [];
      }

      return results.map(object => ({
        library,
        name: this.ibmi.sysNameInLocal(String(object.ODOBNM)),
        type: String(object.ODOBTP),
        attribute: String(object.ODOBAT),
        text: String(object.ODOBTX)
      } as IBMiFile))
        .sort((a, b) => {
          if (a.library.localeCompare(b.library) != 0) {
            return a.library.localeCompare(b.library)
          }
          else if (sortOrder === `name`) {
            return a.name.localeCompare(b.name)
          }
          else {
            return ((ObjectTypes.get(a.type) || 0) - (ObjectTypes.get(b.type) || 0)) || a.name.localeCompare(b.name);
          }
        });
    }
  }

  /**
   * @param lib 
   * @param spf
   * @param mbr
   * @returns an array of IBMiMember 
   */
  async getMemberList(lib: string, spf: string, mbr: string = `*`, ext: string = `*`): Promise<IBMiMember[]> {
    const library = lib.toUpperCase();
    const sourceFile = spf.toUpperCase();
    let member = (mbr !== `*` ? mbr : null);
    let memberExt = (ext !== `*` ? ext : null);

    let results: Tools.DB2Row[];

    if (this.config.enableSQL) {
      if (member) {
        member = member.replace(/[*]/g, `%`);
      }

      if (memberExt) {
        memberExt = memberExt.replace(/[*]/g, `%`);
      }

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
      const tempLib = this.config.tempLibrary;
      const TempName = Tools.makeid();

      await this.ibmi.remoteCommand(`DSPFD FILE(${library}/${sourceFile}) TYPE(*MBR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`);
      results = await this.getTable(tempLib, TempName, TempName, true);

      if (results.length === 1 && String(results[0].MBNAME).trim() === ``) {
        return [];
      }

      if (member || memberExt) {
        let pattern: RegExp | undefined, patternExt: RegExp | undefined;
        if (member) {
          pattern = new RegExp(`^` + member.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
        }
        if (memberExt) {
          patternExt = new RegExp(`^` + memberExt.replace(/[*]/g, `.*`).replace(/[$]/g, `\\$`) + `$`);
        }

        results = results.filter(row => (
          (!pattern || pattern.test(String(row.MBNAME))) &&
          (!patternExt || patternExt.test(String(row.MBSEU2)))));
      }
    }

    if (results.length === 0) {
      return [];
    }

    results = results.sort((a, b) => String(a.MBNAME).localeCompare(String(b.MBNAME)));

    const asp = this.ibmi.aspInfo[Number(results[0].MBASP)];

    return results.map(result => ({
      asp: asp,
      library: library,
      file: String(result.MBFILE),
      name: String(result.MBNAME),
      extension: String(result.MBSEU2),
      recordLength: Number(result.MBMXRL),
      text: `${result.MBMTXT || ``}${sourceFile === `*ALL` ? ` (${result.MBFILE})` : ``}`.trim()
    }));
  }

  /**
   * Get list of items in a path
   * @param remotePath 
   * @return an array of IFSFile
   */
  async getFileList(remotePath: string): Promise<IFSFile[]> {
    const items: IFSFile[] = [];

    const fileListResult = (await this.ibmi.sendCommand({
      command: `ls -a -p -L ${Tools.escapePath(remotePath)}`
    }));

    if (fileListResult.code === 0) {
      const fileList = fileListResult.stdout;

      //Remove current and dir up.
      fileList.split(`\n`)
        .filter(item => item !== `../` && item !== `./`)
        .forEach(item => {
          const type = (item.endsWith(`/`) ? `directory` : `streamfile`);
          items.push({
            type,
            name: (type === `directory` ? item.substring(0, item.length - 1) : item),
            path: path.posix.join(remotePath, item)
          });
        });

      return items.sort((a, b) => a.name.localeCompare(b.name));

    } else {
      throw new Error(fileListResult.stderr);
    }

  }

  async memberResolve(member: string, files: QsysPath[]): Promise<IBMiMember|undefined> {
    const find = this.ibmi.remoteFeatures.find;
    if (find) {
      const command = [
        find,
        // TODO: think about how to get the ASP for each library?
        ...files.map(file => `/QSYS.LIB/${file.library.toUpperCase()}.LIB/${file.name.toUpperCase()}.FILE`),
        `-name '${member.toUpperCase()}.*'`
      ].join(` `);

      const result = await this.ibmi.sendCommand({
        command,
      });

      if (result.code === 0) {
        const [firstMost] = result.stdout.split(`\n`);

        try {
          // This can error if the path format is wrong for some reason.
          // Not that this would ever happen, but better to be safe than sorry
          return this.ibmi.parserMemberPath(firstMost);
        } catch (e) {
          console.log(e);
        }
      }
    }

    return undefined;
  }

  async streamfileResolve(names: string[], directories: QsysPath[]): Promise<string|undefined> {
    const find = this.ibmi.remoteFeatures.find;
    if (find) {
      const command = [
        find,
        ...directories,
        names.map(name => `-name '${name}'`).join(` -o `)
      ].join(` `);

      const result = await this.ibmi.sendCommand({
        command,
      });

      if (result.code === 0 && result.stdout) {
        const [firstMost] = result.stdout.split(`\n`);

        return firstMost;
      }
    }

    return undefined;
  }

  /**
   * Fix Comments in an SQL string so that the comments always start at position 0 of the line.
   * Required to work with QZDFMDB2.
   * @param inSql; sql statement
   * @returns correctly formattted sql string containing comments
   */
  private fixCommentsInSQLString(inSql: string): string {
    const newLine: string = `\n`;
    let parsedSql: string = ``;

    inSql.split(newLine)
      .forEach(item => {
        let goodLine = item + newLine;

        const pos = item.search(`--`);
        if (pos > 0) {
          goodLine = item.slice(0, pos) + 
                     newLine +
                     item.slice(pos) +
                     newLine;
        }
        parsedSql += goodLine;
        
      });

    return parsedSql;
  }

  /**
   * @param errorsString; several lines of `code:text`...
   * @returns errors
   */
  parseIBMiErrors(errorsString: string): IBMiError[] {
    return errorsString.split(`\n`)
      .map(error => error.split(':'))
      .map(codeText => ({ code: codeText[0], text: codeText[1] }));
  }
}
