import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import tmp from 'tmp';
import util from 'util';
import { window } from 'vscode';
import { ObjectTypes } from '../filesystems/qsys/Objects';
import { CommandResult, IBMiError, IBMiFile, IBMiMember, IBMiObject, IFSFile, QsysPath } from '../typings';
import { ConnectionConfiguration } from './Configuration';
import { default as IBMi } from './IBMi';
import { Tools } from './Tools';
const tmpFile = util.promisify(tmp.file);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const UTF8_CCSIDS = [`819`, `1208`, `1252`];

type Authority = "*ADD" | "*DLT" | "*EXECUTE" | "*READ" | "*UPD" | "*NONE" | "*ALL" | "*CHANGE" | "*USE" | "*EXCLUDE" | "*AUTLMGT";
export type SortOrder = `name` | `type`;

export type SortOptions = {
  order: "name" | "date" | "?"
  ascending?: boolean
}

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
    await this.ibmi.downloadFile(localPath, remotePath);
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
  async downloadMemberContent(asp: string | undefined, library: string, sourceFile: string, member: string, localPath?: string) {
    asp = asp || this.config.sourceASP;
    library = library.toUpperCase();
    sourceFile = sourceFile.toUpperCase();
    member = member.toUpperCase();

    let retry = false;
    let path = Tools.qualifyPath(library, sourceFile, member, asp);
    const tempRmt = this.getTempRemote(path);
    while (true) {
      const copyResult = await this.ibmi.runCommand({
        command: `CPYTOSTMF FROMMBR('${path}') TOSTMF('${tempRmt}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`,
        noLibList: true
      });

      if (copyResult.code === 0) {
        if (!localPath) {
          localPath = await tmpFile();
        }
        await this.ibmi.downloadFile(localPath, tempRmt);
        return await readFileAsync(localPath, `utf8`);
      } else {
        if (!retry) {
          const messageID = String(copyResult.stdout).substring(0, 7);
          switch (messageID) {
            case "CPDA08A":
              //We need to try again after we delete the temp remote
              const result = await this.ibmi.sendCommand({ command: `rm -f ${tempRmt}`, directory: `.` });
              retry = !result.code || result.code === 0;
              break;
            case "CPFA0A9":
              //The member may be located on SYSBAS
              if (asp) {
                path = Tools.qualifyPath(library, sourceFile, member);
                retry = true;
              }
              break;
            default:
              retry = false;
              break;
          }
        }

        if (!retry) {
          throw new Error(`Failed downloading member: ${copyResult.stderr}`);
        }
      }
    }
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
    const tmpobj = await tmpFile();

    let retry = false;
    try {
      await writeFileAsync(tmpobj, content, `utf8`);
      let path = Tools.qualifyPath(library, sourceFile, member, asp);
      const tempRmt = this.getTempRemote(path);
      await client.putFile(tmpobj, tempRmt);

      while (true) {
        const copyResult = await this.ibmi.runCommand({
          command: `QSYS/CPYFRMSTMF FROMSTMF('${tempRmt}') TOMBR('${path}') MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`,
          noLibList: true
        });

        if (copyResult.code === 0) {
          const messages = Tools.parseMessages(copyResult.stderr);
          if (messages.findId("CPIA083")) {
            window.showWarningMessage(`${library}/${sourceFile}(${member}) was saved with truncated records!`);
          }
          return true;
        } else {
          if (!retry) {
            const messages = Tools.parseMessages(copyResult.stderr);
            if (messages.findId("CPFA0A9")) {
              //The member may be located on SYSBAS
              if (asp) {
                path = Tools.qualifyPath(library, sourceFile, member);
                retry = true;
              }
            }
            else {
              throw new Error(`Failed uploading member: ${copyResult.stderr}`);
            }
          }
        }
      }
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
   * @param ileCommand Command that would change the library list, like CHGLIBL
   */
  async getLibraryListFromCommand(ileCommand: string): Promise<{ currentLibrary: string; libraryList: string[]; } | undefined> {
    if (this.ibmi.remoteFeatures[`GETNEWLIBL.PGM`]) {
      const tempLib = this.config.tempLibrary;
      const resultSet = await this.runSQL(`CALL ${tempLib}.GETNEWLIBL('${ileCommand.replace(new RegExp(`'`, 'g'), `''`)}')`);

      let result = {
        currentLibrary: `QGPL`,
        libraryList: [] as string[]
      };

      resultSet.forEach(row => {
        const libraryName = String(row.SYSTEM_SCHEMA_NAME);
        switch (row.PORTION) {
          case `CURRENT`:
            result.currentLibrary = libraryName;
            break;
          case `USER`:
            result.libraryList.push(libraryName);
            break;
        }
      })

      return result;
    }

    return undefined;
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
        await this.ibmi.runCommand({
          command: `DLTOBJ OBJ(${library}/${file}) OBJTYPE(*FILE)`,
          noLibList: true
        });
      }

      return data;

    } else {
      const tempRmt = this.getTempRemote(Tools.qualifyPath(library, file, member));
      const copyResult = await this.ibmi.runCommand({
        command: `QSYS/CPYTOIMPF FROMFILE(${library}/${file} ${member}) ` +
          `TOSTMF('${tempRmt}') ` +
          `MBROPT(*REPLACE) STMFCCSID(1208) RCDDLM(*CRLF) DTAFMT(*DLM) RMVBLANK(*TRAILING) ADDCOLNAM(*SQL) FLDDLM(',') DECPNT(*PERIOD)`,
        noLibList: true
      });

      if (copyResult.code === 0) {
        let result = await this.downloadStreamfile(tempRmt);

        if (this.config.autoClearTempData) {
          Promise.allSettled([
            this.ibmi.sendCommand({ command: `rm -f ${tempRmt}`, directory: `.` }),
            deleteTable ? this.ibmi.runCommand({ command: `DLTOBJ OBJ(${library}/${file}) OBJTYPE(*FILE)`, noLibList: true }) : Promise.resolve()
          ]);
        }

        return parse(result, {
          columns: true,
          skip_empty_lines: true,
          cast: true,
          onRecord(record) {
            for (const key of Object.keys(record)) {
              record[key] = record[key] === ` ` ? `` : record[key];
            }
            return record;
          }
        });

      } else {
        throw new Error(`Failed fetching table: ${copyResult.stderr}`);
      }
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
      await this.ibmi.runCommand({
        command: `DSPOBJD OBJ(QSYS/*ALL) OBJTYPE(*LIB) DETAIL(*TEXTATR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`,
        noLibList: true
      });
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
        `liblist -d ` + Tools.sanitizeLibraryNames(this.ibmi.defaultUserLibraries).join(` `),
        ...newLibl.map(lib => `liblist -a ` + Tools.sanitizeLibraryNames([lib]))
      ].join(`; `)
    });

    if (result.stderr) {
      const lines = result.stderr.split(`\n`);

      lines.forEach(line => {
        const badLib = newLibl.find(lib => line.includes(`ibrary ${lib} `) || line.includes(`ibrary ${Tools.sanitizeLibraryNames([lib])} `));

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
  async getObjectList(filters: { library: string; object?: string; types?: string[]; }, sortOrder?: SortOrder): Promise<IBMiFile[]> {
    const library = filters.library.toUpperCase();
    if (!await this.checkObject({ library: "QSYS", name: library, type: "*LIB" })) {
      throw new Error(`Library ${library} does not exist.`);
    }

    const object = (filters.object && filters.object !== `*` ? filters.object.toUpperCase() : `*ALL`);
    const sourceFilesOnly = (filters.types && filters.types.includes(`*SRCPF`));

    const tempLib = this.config.tempLibrary;
    const tempName = Tools.makeid();

    if (sourceFilesOnly) {
      await this.ibmi.runCommand({
        command: `DSPFD FILE(${library}/${object}) TYPE(*ATR) FILEATR(*PF) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${tempName})`,
        noLibList: true
      });

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

      await this.ibmi.runCommand({
        command: `DSPOBJD OBJ(${library}/${object}) OBJTYPE(${objectTypes}) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${tempName})`,
        noLibList: true
      });
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
  async getMemberList(lib: string, spf: string, mbr: string = `*`, ext: string = `*`, sort: SortOptions = { order: "name" }): Promise<IBMiMember[]> {
    sort.order = sort.order === '?' ? 'name' : sort.order;

    const library = lib.toUpperCase();
    const sourceFile = spf.toUpperCase();
    let member = (mbr !== `*` ? mbr.toUpperCase() : null);
    let memberExt = (ext !== `*` ? ext.toUpperCase() : null);

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
          b.avgrowsize as MBMXRL,
          a.iasp_number as MBASP,
          cast(a.system_table_name as char(10) for bit data) AS MBFILE,
          cast(b.system_table_member as char(10) for bit data) as MBNAME,
          coalesce(cast(b.source_type as varchar(10) for bit data), '') as MBSEU2,
          coalesce(b.partition_text, '') as MBMTXT,
          b.NUMBER_ROWS as MBNRCD,
          extract(epoch from (b.CREATE_TIMESTAMP))*1000 as CREATED,
          extract(epoch from (b.LAST_SOURCE_UPDATE_TIMESTAMP))*1000 as CHANGED
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

      await this.ibmi.runCommand({
        command: `DSPFD FILE(${library}/${sourceFile}) TYPE(*MBR) OUTPUT(*OUTFILE) OUTFILE(${tempLib}/${TempName})`,
        noLibList: true
      });
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
          (!patternExt || patternExt.test(String(row.MBSEU2)))))
      }

      results.forEach(element => {
        element.CREATED = this.getDspfdDate(String(element.MBCCEN), String(element.MBCDAT), String(element.MBCTIM)).valueOf();
        element.CHANGED = this.getDspfdDate(String(element.MBMRCN), String(element.MBMRDT), String(element.MBMRTM)).valueOf();
      });
    }

    if (results.length === 0) {
      return [];
    }

    results = results.sort((a, b) => String(a.MBNAME).localeCompare(String(b.MBNAME)));

    const asp = this.ibmi.aspInfo[Number(results[0].MBASP)];

    let sorter: (r1: IBMiMember, r2: IBMiMember) => number;
    if (sort.order === 'name') {
      sorter = (r1, r2) => r1.name.localeCompare(r2.name);
    }
    else {
      sorter = (r1, r2) => r1.changed!.valueOf() - r2.changed!.valueOf();
    }

    const members = results.map(result => ({
      asp: asp,
      library: library,
      file: String(result.MBFILE),
      name: String(result.MBNAME),
      extension: String(result.MBSEU2),
      recordLength: Number(result.MBMXRL) - 12,
      text: `${result.MBMTXT || ``}${sourceFile === `*ALL` ? ` (${result.MBFILE})` : ``}`.trim(),
      lines: Number(result.MBNRCD),
      created: new Date(result.CREATED ? Number(result.CREATED) : 0),
      changed: new Date(result.CHANGED ? Number(result.CHANGED) : 0)
    } as IBMiMember)).sort(sorter);

    if (sort.ascending === false) {
      members.reverse();
    }

    return members;
  }

  /**
   * Get list of items in a path
   * @param remotePath 
   * @return an array of IFSFile
   */
  async getFileList(remotePath: string, sort: SortOptions = { order: "name" }, onListError?: (errors: string[]) => void): Promise<IFSFile[]> {
    sort.order = sort.order === '?' ? 'name' : sort.order;
    const { 'stat': STAT } = this.ibmi.remoteFeatures;
    const { 'sort': SORT } = this.ibmi.remoteFeatures;

    const items: IFSFile[] = [];
    let fileListResult: CommandResult;

    if (STAT && SORT) {
      fileListResult = (await this.ibmi.sendCommand({
        command: `cd '${remotePath}' && ${STAT} --dereference --printf="%A\t%h\t%U\t%G\t%s\t%Y\t%n\n" * .* ${sort.order === `date` ? `| ${SORT} --key=6` : ``} ${(sort.order === `date` && !sort.ascending) ? ` --reverse` : ``}`
      }));

      if (fileListResult.stdout !== '') {
        const fileStatList = fileListResult.stdout;
        const fileList = fileStatList.split(`\n`);

        //Remove current and dir up.
        fileList.forEach(item => {
          let auth: string, hardLinks: string, owner: string, group: string, size: string, modified: string, name: string;
          [auth, hardLinks, owner, group, size, modified, name] = item.split(`\t`);

          if (name !== `..` && name !== `.`) {
            const type = (auth.startsWith(`d`) ? `directory` : `streamfile`);
            items.push({
              type: type,
              name: name,
              path: path.posix.join(remotePath, name),
              size: Number(size),
              modified: new Date(Number(modified) * 1000),
              owner: owner
            });
          };
        });
      }
    } else {
      fileListResult = (await this.ibmi.sendCommand({
        command: `${this.ibmi.remoteFeatures.ls} -a -p -L ${sort.order === "date" ? "-t" : ""} ${(sort.order === 'date' && sort.ascending) ? "-r" : ""} ${Tools.escapePath(remotePath)}`
      }));

      if (fileListResult.stdout !== '') {
        const fileList = fileListResult.stdout;

        //Remove current and dir up.
        fileList.split(`\n`)
          .filter(item => item !== `../` && item !== `./`)
          .forEach(item => {
            const type = (item.endsWith(`/`) ? `directory` : `streamfile`);
            items.push({
              type: type,
              name: (type === `directory` ? item.substring(0, item.length - 1) : item),
              path: path.posix.join(remotePath, item)
            });
          });
      }
    }

    if (sort.order === "name") {
      items.sort((f1, f2) => f1.name.localeCompare(f2.name));
      if (sort.ascending === false) {
        items.reverse();
      }
    }

    if (fileListResult.code !== 0) {
      //Filter out the errors occurring when stat is run on a directory with no hidden or regular files
      const errors = fileListResult.stderr.split("\n")
        .filter(e => !e.toLowerCase().includes("cannot stat '*'") && !e.toLowerCase().includes("cannot stat '.*'"))
        .filter(Tools.distinct);

      if (errors.length) {
        onListError ? onListError(errors) : errors.forEach(console.log);
      }
    }

    return items;
  }

  async memberResolve(member: string, files: QsysPath[]): Promise<IBMiMember | undefined> {
    // Escape names for shell
    const pathList = files
      .map(file => {
        const asp = file.asp || this.config.sourceASP;
        if (asp && asp.length > 0) {
          return [
            Tools.qualifyPath(file.library, file.name, member, asp, true),
            Tools.qualifyPath(file.library, file.name, member, undefined, true)
          ].join(` `);
        } else {
          return Tools.qualifyPath(file.library, file.name, member, undefined, true);
        }
      })
      .join(` `)
      .toUpperCase();

    const command = `for f in ${pathList}; do if [ -f $f ]; then echo $f; break; fi; done`;
    const result = await this.ibmi.sendCommand({
      command,
    });

    if (result.code === 0) {
      const firstMost = result.stdout;

      if (firstMost) {
        try {
          const simplePath = Tools.unqualifyPath(firstMost);

          // This can error if the path format is wrong for some reason.
          // Not that this would ever happen, but better to be safe than sorry
          return this.ibmi.parserMemberPath(simplePath);
        } catch (e) {
          console.log(e);
        }
      }
    }

    return undefined;
  }

  async objectResolve(object: string, libraries: string[]): Promise<string | undefined> {
    const command = `for f in ${libraries.map(lib => `/QSYS.LIB/${lib.toUpperCase()}.LIB/${object.toUpperCase()}.*`).join(` `)}; do if [ -f $f ] || [ -d $f ]; then echo $f; break; fi; done`;

    const result = await this.ibmi.sendCommand({
      command,
    });

    if (result.code === 0) {
      const firstMost = result.stdout;

      if (firstMost) {
        const lib = Tools.unqualifyPath(firstMost);

        return lib.split('/')[1];
      }
    }

    return undefined;
  }

  async streamfileResolve(names: string[], directories: string[]): Promise<string | undefined> {
    const command = `for f in ${directories.flatMap(dir => names.map(name => `"${path.posix.join(dir, name)}"`)).join(` `)}; do if [ -f "$f" ]; then echo $f; break; fi; done`;

    const result = await this.ibmi.sendCommand({
      command,
    });

    if (result.code === 0 && result.stdout) {
      const firstMost = result.stdout;

      return firstMost;
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

  /**
   * @param century; century code (1=20xx, 0=19xx)
   * @param dateString: string in YYMMDD
   * @param timeString: string in HHMMSS
   * @returns date
   */
  getDspfdDate(century: string = `0`, YYMMDD: string = `010101`, HHMMSS: string = `000000`): Date {
    let year: string, month: string, day: string, hours: string, minutes: string, seconds: string;
    let dateString: string = (century === `1` ? `20` : `19`).concat(YYMMDD.padStart(6, `0`)).concat(HHMMSS.padStart(6, `0`));
    [, year, month, day, hours, minutes, seconds] = /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(dateString) || [];
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)));
  }

  /**
   * Return `true` if `remotePath` denotes a directory
   * 
   * @param remotePath: a remote IFS path
   */
  async isDirectory(remotePath: string) {
    return (await this.ibmi.sendCommand({
      command: `cd ${remotePath}`
    })).code === 0;
  }

  async checkObject(object: { library: string, name: string, type: string }, authorities: Authority[] = [`*NONE`]) {
    return (await this.ibmi.runCommand({
      command: `CHKOBJ OBJ(${object.library.toLocaleUpperCase()}/${object.name.toLocaleUpperCase()}) OBJTYPE(${object.type.toLocaleUpperCase()}) AUT(${authorities.join(" ")})`,
      noLibList: true
    })).code === 0;
  }

  async testStreamFile(path: string, right: "r" | "w" | "x") {
    return (await this.ibmi.sendCommand({ command: `test -${right} ${Tools.escapePath(path)}` })).code === 0;
  }

  isProtectedPath(path: string) {
    if (path.startsWith('/')) { //IFS path
      return this.config.protectedPaths.some(p => path.startsWith(p));
    }
    else { //QSYS path      
      const qsysObject = Tools.parseQSysPath(path);
      return this.config.protectedPaths.includes(qsysObject.library.toLocaleUpperCase());
    }
  }
}
