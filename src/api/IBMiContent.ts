import { parse } from 'csv-parse/sync';
import fs from 'fs';
import path from 'path';
import tmp from 'tmp';
import util from 'util';
import { MarkdownString, window } from 'vscode';
import { ObjectTypes } from '../filesystems/qsys/Objects';
import { AttrOperands, CommandResult, IBMiError, IBMiMember, IBMiObject, IFSFile, QsysPath } from '../typings';
import { ConnectionConfiguration } from './Configuration';
import { FilterType, parseFilter, singleGenericName } from './Filter';
import { default as IBMi } from './IBMi';
import { Tools } from './Tools';
const tmpFile = util.promisify(tmp.file);
const readFileAsync = util.promisify(fs.readFile);
const writeFileAsync = util.promisify(fs.writeFile);

const UTF8_CCSIDS = [`819`, `1208`, `1252`];

type Authority = "*ADD" | "*DLT" | "*EXECUTE" | "*READ" | "*UPD" | "*NONE" | "*ALL" | "*CHANGE" | "*USE" | "*EXCLUDE" | "*AUTLMGT";
export type SortOrder = `name` | `type`;

export type SortOptions = {
  order: "name" | "date"
  ascending?: boolean
}

export default class IBMiContent {
  private chgJobCCSID: string | undefined = undefined;
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

  /**
   *
   * @param remotePath Remote IFS path
   * @param localPath Local path to download file to
   */
  async downloadStreamfileRaw(remotePath: string, localPath?: string) {
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
    const raw = await readFileAsync(localPath);
    return raw;
  }

  /**
   * @deprecated Use downloadStreamfileRaw instead
   */
  async downloadStreamfile(remotePath: string, localPath?: string) {
    const raw = await this.downloadStreamfileRaw(remotePath, localPath);
    return raw.toString(`utf8`);
  }

  /**
   * @param originalPath
   * @param content Raw content
   * @param encoding Optional encoding to write.
   */
  async writeStreamfileRaw(originalPath: string, content: Uint8Array, encoding?: string) {
    const client = this.ibmi.client;
    const features = this.ibmi.remoteFeatures;
    const tmpobj = await tmpFile();

    let ccsid;
    if (this.config.autoConvertIFSccsid && features.attr) {
      // First, find the CCSID of the original file if not UTF-8
      ccsid = await this.getNotUTF8CCSID(features.attr, originalPath);
    }

    await writeFileAsync(tmpobj, content, encoding);

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
   * Write utf8 content to a streamfile
   * @deprecated Use writeStreamfileRaw instead
   */
  async writeStreamfile(originalPath: string, content: string) {
    const buffer = Buffer.from(content, `utf8`);
    return this.writeStreamfileRaw(originalPath, buffer);
  }

  /**
   * Download the contents of a source member
   */
  async downloadMemberContent(asp: string | undefined, library: string, sourceFile: string, member: string, localPath?: string) {
    asp = asp || this.config.sourceASP;
    library = this.ibmi.upperCaseName(library);
    sourceFile = this.ibmi.upperCaseName(sourceFile);
    member = this.ibmi.upperCaseName(member);

    let retry = false;
    let path = Tools.qualifyPath(library, sourceFile, member, asp);
    const tempRmt = this.getTempRemote(path);
    while (true) {
      let copyResult: CommandResult;
      if (this.ibmi.dangerousVariants && new RegExp(`[${this.ibmi.variantChars.local}]`).test(path)) {
        copyResult = { code: 0, stdout: '', stderr: '' };
        try {
          await this.ibmi.runSQL([
            `@QSYS/CPYF FROMFILE(${library}/${sourceFile}) TOFILE(QTEMP/QTEMPSRC) FROMMBR(${member}) TOMBR(TEMPMEMBER) MBROPT(*REPLACE) CRTFILE(*YES);`,
            `@QSYS/CPYTOSTMF FROMMBR('${Tools.qualifyPath("QTEMP", "QTEMPSRC", "TEMPMEMBER", undefined)}') TOSTMF('${tempRmt}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID});`
          ].join("\n"));
        } catch (error: any) {
          copyResult.code = -1;
          copyResult.stderr = String(error);
        }
      }
      else {
        copyResult = await this.ibmi.runCommand({
          command: `QSYS/CPYTOSTMF FROMMBR('${path}') TOSTMF('${tempRmt}') STMFOPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`,
          noLibList: true
        });
      }

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
              const result = await this.ibmi.sendCommand({ command: `rm -rf ${tempRmt}`, directory: `.` });
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
    library = this.ibmi.upperCaseName(library);
    sourceFile = this.ibmi.upperCaseName(sourceFile);
    member = this.ibmi.upperCaseName(member);

    const client = this.ibmi.client;
    const tmpobj = await tmpFile();

    let retry = false;
    try {
      await writeFileAsync(tmpobj, content, `utf8`);
      let path = Tools.qualifyPath(library, sourceFile, member, asp);
      const tempRmt = this.getTempRemote(path);
      await client.putFile(tmpobj, tempRmt);

      while (true) {
        let copyResult: CommandResult;
        if (this.ibmi.dangerousVariants && new RegExp(`[${this.ibmi.variantChars.local}]`).test(path)) {
          copyResult = { code: 0, stdout: '', stderr: '' };
          try {
            await this.ibmi.runSQL([
              `@QSYS/CPYF FROMFILE(${library}/${sourceFile}) FROMMBR(${member}) TOFILE(QTEMP/QTEMPSRC) TOMBR(TEMPMEMBER) MBROPT(*REPLACE) CRTFILE(*YES);`,
              `@QSYS/CPYFRMSTMF FROMSTMF('${tempRmt}') TOMBR('${Tools.qualifyPath("QTEMP", "QTEMPSRC", "TEMPMEMBER", undefined)}') MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`,
              `@QSYS/CPYF FROMFILE(QTEMP/QTEMPSRC) FROMMBR(TEMPMEMBER) TOFILE(${library}/${sourceFile}) TOMBR(${member}) MBROPT(*REPLACE);`
            ].join("\n"));
          } catch (error: any) {
            copyResult.code = -1;
            copyResult.stderr = String(error);
          }
        }
        else {
          copyResult = await this.ibmi.runCommand({
            command: `QSYS/CPYFRMSTMF FROMSTMF('${tempRmt}') TOMBR('${path}') MBROPT(*REPLACE) STMFCCSID(1208) DBFCCSID(${this.config.sourceFileCCSID})`,
            noLibList: true
          });
        }

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
   * @param statements Either an SQL statement or CL statement. CL statements start with @
   * @returns result set
   */
  runStatements(...statements: string[]): Promise<Tools.DB2Row[]> {
    return this.ibmi.runSQL(statements.map(s => s.trimEnd().endsWith(`;`) ? s : `${s};`).join(`\n`));
  }

  /**
   * Run SQL statements.
   * Each statement must be separated by a semi-colon and a new line (i.e. ;\n).
   * If a statement starts with @, it will be run as a CL command.
   *
   * @param statements
   * @returns a Result set
   * @deprecated Use {@linkcode IBMi.runSQL IBMi.runSQL} instead
   */
  runSQL(statements: string) {
    return this.ibmi.runSQL(statements);
  }

  /**
   * Download the contents of a member from a table.
   * @param library
   * @param file
   * @param member Will default to file provided
   * @param deleteTable Will delete the table after download
   */
  async getTable(library: string, file: string, member?: string, deleteTable?: boolean): Promise<Tools.DB2Row[]> {
    if (!member) member = file; //Incase mbr is the same file

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
          this.ibmi.sendCommand({ command: `rm -rf ${tempRmt}`, directory: `.` }),
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

  /**
   * Prepare a table in QTEMP using any number of preparation queries and return its content.
   * @param prepareQueries : SQL statements that should create a table in QTEMP
   * @param table : the name of the table expected to be found in QTEMP
   * @returns : the table's content
   */
  getQTempTable(prepareQueries: string[], table: string): Promise<Tools.DB2Row[]> {
    return this.runStatements(...prepareQueries, `select * from QTEMP.${table}`);
  }

  /**
   * Get list of libraries with description and attribute
   * @param libraries Array of libraries to retrieve
   * @returns an array of libraries as IBMiObject
   */
  async getLibraryList(libraries: string[]): Promise<IBMiObject[]> {
    let objects: IBMiObject[];
    if (this.ibmi.enableSQL) {
      const statement = `
        SELECT
          os.OBJNAME AS NAME,
          os.OBJTYPE AS TYPE,
          os.OBJATTRIBUTE AS ATTRIBUTE,
          OBJTEXT AS TEXT,
          os.IASP_NUMBER AS IASP_NUMBER,
          os.OBJSIZE AS SIZE,
          EXTRACT(EPOCH FROM (os.OBJCREATED)) * 1000 AS CREATED,
          EXTRACT(EPOCH FROM (os.CHANGE_TIMESTAMP)) * 1000 AS CHANGED,
          os.OBJOWNER AS OWNER,
          os.OBJDEFINER AS CREATED_BY
        from table( SYSTOOLS.SPLIT( INPUT_LIST => '${libraries.toString()}', DELIMITER => ',' ) ) libs,
        table( QSYS2.OBJECT_STATISTICS( OBJECT_SCHEMA => 'QSYS', OBJTYPELIST => '*LIB', OBJECT_NAME => libs.ELEMENT ) ) os
      `;
      const results = await this.ibmi.runSQL(statement);

      objects = results.map(object => ({
        library: 'QSYS',
        name: this.ibmi.sysNameInLocal(String(object.NAME)),
        type: String(object.TYPE),
        attribute: String(object.ATTRIBUTE),
        text: String(object.TEXT || ""),
        sourceFile: Boolean(object.IS_SOURCE),
        sourceLength: object.SOURCE_LENGTH !== undefined ? Number(object.SOURCE_LENGTH) : undefined,
        size: Number(object.SIZE),
        created: new Date(Number(object.CREATED)),
        changed: new Date(Number(object.CHANGED)),
        created_by: object.CREATED_BY,
        owner: object.OWNER,
        asp: this.ibmi.aspInfo[Number(object.IASP_NUMBER)]
      } as IBMiObject));
    } else {
      let results = await this.getQTempTable(libraries.map(library => `@DSPOBJD OBJ(QSYS/${library}) OBJTYPE(*LIB) DETAIL(*TEXTATR) OUTPUT(*OUTFILE) OUTFILE(QTEMP/LIBLIST) OUTMBR(*FIRST *ADD)`), "LIBLIST");
      if (results.length === 1 && !results[0].ODOBNM?.toString().trim()) {
        return [];
      }
      results = results.filter(object => libraries.includes(this.ibmi.sysNameInLocal(String(object.ODOBNM))));

      objects = results.map(object => ({
        library: 'QSYS',
        type: '*LIB',
        name: this.ibmi.sysNameInLocal(String(object.ODOBNM)),
        attribute: object.ODOBAT,
        text: object.ODOBTX
      } as IBMiObject));
    };

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

    const sanitized = Tools.sanitizeLibraryNames(newLibl);

    const result = await this.ibmi.sendQsh({
      command: [
        `liblist -d ` + Tools.sanitizeLibraryNames(this.ibmi.defaultUserLibraries).join(` `),
        ...sanitized.map(lib => `liblist -a ` + lib)
      ].join(`; `)
    });

    if (result.stderr) {
      const lines = result.stderr.split(`\n`);

      lines.forEach(line => {
        const isNotFound = line.includes(`CPF2110`);
        if (isNotFound) {
          const libraryReference = sanitized.find(lib => line.includes(lib));

          // If there is an error about the library, remove it
          if (libraryReference) {
            badLibs.push(libraryReference);
          }
        }
      });
    }

    return badLibs;
  }

  async getLibraries(filters: { library: string; filterType?: FilterType }) {
    return this.getObjectList({ library: "QSYS", object: filters.library, types: ["*LIB"], filterType: filters.filterType });
  }

  /**
   * @param filters
   * @param sortOrder
   * @returns an array of IBMiObject
   */
  async getObjectList(filters: { library: string; object?: string; types?: string[]; filterType?: FilterType }, sortOrder?: SortOrder): Promise<IBMiObject[]> {
    const library = this.ibmi.upperCaseName(filters.library);
    if (!await this.checkObject({ library: "QSYS", name: library, type: "*LIB" })) {
      throw new Error(`Library ${library} does not exist.`);
    }

    const singleEntry = filters.filterType !== 'regex' ? singleGenericName(filters.object) : undefined;
    const nameFilter = parseFilter(filters.object, filters.filterType);
    const objectFilter = filters.object && (nameFilter.noFilter || singleEntry) && filters.object !== `*` ? this.ibmi.upperCaseName(filters.object) : undefined;
    const objectNameLike = () => objectFilter ? ` and t.SYSTEM_TABLE_NAME ${(objectFilter.includes('*') ? ` like ` : ` = `)} '${objectFilter.replace('*', '%')}'` : '';
    const objectName = () => objectFilter ? `, OBJECT_NAME => '${objectFilter}'` : '';

    const typeFilter = filters.types && filters.types.length > 1 ? (t: string) => filters.types?.includes(t) : undefined;
    const type = filters.types && filters.types.length === 1 && filters.types[0] !== '*' ? filters.types[0] : '*ALL';

    const sourceFilesOnly = filters.types && filters.types.length === 1 && filters.types.includes(`*SRCPF`);
    const withSourceFiles = ['*ALL', '*SRCPF', '*FILE'].includes(type);

    let createOBJLIST: string[];
    if (sourceFilesOnly) {
      //DSPFD only
      createOBJLIST = [
        `select `,
        `  t.SYSTEM_TABLE_NAME as NAME,`,
        `  '*FILE'             as TYPE,`,
        `  'PF'                as ATTRIBUTE,`,
        `  t.TABLE_TEXT        as TEXT,`,
        `  1                   as IS_SOURCE,`,
        `  t.ROW_LENGTH        as SOURCE_LENGTH,`,
        `  t.IASP_NUMBER       as IASP_NUMBER`,
        `from QSYS2.SYSTABLES as t`,
        `where t.table_schema = '${library}' and t.file_type = 'S'${objectNameLike()}`,
      ];
    } else if (!withSourceFiles) {
      //DSPOBJD only
      createOBJLIST = [
        `select `,
        `  OBJNAME          as NAME,`,
        `  OBJTYPE          as TYPE,`,
        `  OBJATTRIBUTE     as ATTRIBUTE,`,
        `  OBJTEXT          as TEXT,`,
        `  0                as IS_SOURCE,`,
        `  IASP_NUMBER      as IASP_NUMBER,`,
        `  OBJSIZE          as SIZE,`,
        `  extract(epoch from (OBJCREATED))*1000       as CREATED,`,
        `  extract(epoch from (CHANGE_TIMESTAMP))*1000 as CHANGED,`,
        `  OBJOWNER         as OWNER,`,
        `  OBJDEFINER       as CREATED_BY`,
        `from table(QSYS2.OBJECT_STATISTICS(OBJECT_SCHEMA => '${library.padEnd(10)}', OBJTYPELIST => '${type}'${objectName()}))`,
      ];
    }
    else {
      //Both DSPOBJD and DSPFD
      createOBJLIST = [
        `with SRCPF as (`,
        `  select `,
        `    t.SYSTEM_TABLE_NAME as NAME,`,
        `    '*FILE'             as TYPE,`,
        `    'PF'                as ATTRIBUTE,`,
        `    t.TABLE_TEXT        as TEXT,`,
        `    1                   as IS_SOURCE,`,
        `    t.ROW_LENGTH        as SOURCE_LENGTH`,
        `  from QSYS2.SYSTABLES as t`,
        `  where t.table_schema = '${library}' and t.file_type = 'S'${objectNameLike()}`,
        `), OBJD as (`,
        `  select `,
        `    OBJNAME           as NAME,`,
        `    OBJTYPE           as TYPE,`,
        `    OBJATTRIBUTE      as ATTRIBUTE,`,
        `    OBJTEXT           as TEXT,`,
        `    0                 as IS_SOURCE,`,
        `    IASP_NUMBER       as IASP_NUMBER,`,
        `    OBJSIZE           as SIZE,`,
        `    extract(epoch from (OBJCREATED))*1000       as CREATED,`,
        `    extract(epoch from (CHANGE_TIMESTAMP))*1000 as CHANGED,`,
        `    OBJOWNER          as OWNER,`,
        `    OBJDEFINER        as CREATED_BY`,
        `  from table(QSYS2.OBJECT_STATISTICS(OBJECT_SCHEMA => '${library.padEnd(10)}', OBJTYPELIST => '${type}'${objectName()}))`,
        `  )`,
        `select`,
        `  o.NAME,`,
        `  o.TYPE,`,
        `  o.ATTRIBUTE,`,
        `  o.TEXT,`,
        `  case when s.IS_SOURCE is not null then s.IS_SOURCE else o.IS_SOURCE end as IS_SOURCE,`,
        `  s.SOURCE_LENGTH,`,
        `  o.IASP_NUMBER,`,
        `  o.SIZE,`,
        `  o.CREATED,`,
        `  o.CHANGED,`,
        `  o.OWNER,`,
        `  o.CREATED_BY`,
        `from OBJD o left join SRCPF s on o.NAME = s.NAME`,
      ];
    }

    const objects = (await this.runStatements(createOBJLIST.join(`\n`)));

    return objects.map(object => ({
      library,
      name: this.ibmi.sysNameInLocal(String(object.NAME)),
      type: String(object.TYPE),
      attribute: String(object.ATTRIBUTE),
      text: String(object.TEXT || ""),
      sourceFile: Boolean(object.IS_SOURCE),
      sourceLength: object.SOURCE_LENGTH !== undefined ? Number(object.SOURCE_LENGTH) : undefined,
      size: Number(object.SIZE),
      created: new Date(Number(object.CREATED)),
      changed: new Date(Number(object.CHANGED)),
      created_by: object.CREATED_BY,
      owner: object.OWNER,
      asp: this.ibmi.aspInfo[Number(object.IASP_NUMBER)]
    } as IBMiObject))
      .filter(object => !typeFilter || typeFilter(object.type))
      .filter(object => objectFilter || nameFilter.test(object.name))
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

  /**
   *
   * @param filter: the criterias used to list the members
   * @returns
   */
  async getMemberList(filter: { library: string, sourceFile: string, members?: string, extensions?: string, sort?: SortOptions, filterType?: FilterType }): Promise<IBMiMember[]> {
    const sort = filter.sort || { order: 'name' };
    const library = this.ibmi.upperCaseName(filter.library);
    const sourceFile = this.ibmi.upperCaseName(filter.sourceFile);

    const memberFilter = parseFilter(filter.members, filter.filterType);
    const singleMember = memberFilter.noFilter && filter.members && !filter.members.includes(",") ? this.ibmi.upperCaseName(filter.members).replace(/[*]/g, `%`) : undefined;

    const memberExtensionFilter = parseFilter(filter.extensions, filter.filterType);
    const singleMemberExtension = memberExtensionFilter.noFilter && filter.extensions && !filter.extensions.includes(",") ? this.ibmi.upperCaseName(filter.extensions).replace(/[*]/g, `%`) : undefined;

    const statement =
      `With MEMBERS As (
        SELECT
          rtrim(cast(a.system_table_schema as char(10) for bit data)) as LIBRARY,
          b.avgrowsize as RECORD_LENGTH,
          a.iasp_number as ASP,
          rtrim(cast(a.system_table_name as char(10) for bit data)) AS SOURCE_FILE,
          rtrim(cast(b.system_table_member as char(10) for bit data)) as NAME,
          coalesce(rtrim(cast(b.source_type as varchar(10) for bit data)), '') as TYPE,
          coalesce(rtrim(varchar(b.partition_text)), '') as TEXT,
          b.NUMBER_ROWS as LINES,
          extract(epoch from (b.CREATE_TIMESTAMP))*1000 as CREATED,
          extract(epoch from (b.LAST_SOURCE_UPDATE_TIMESTAMP))*1000 as CHANGED
        FROM qsys2.systables AS a
          JOIN qsys2.syspartitionstat AS b
            ON b.table_schema = a.table_schema AND
              b.table_name = a.table_name
      )
      Select * From MEMBERS
      Where LIBRARY = '${library}'
        ${sourceFile !== `*ALL` ? `And SOURCE_FILE = '${sourceFile}'` : ``}
        ${singleMember ? `And NAME Like '${singleMember}'` : ''}
        ${singleMemberExtension ? `And TYPE Like '${singleMemberExtension}'` : ''}
      Order By ${sort.order === 'name' ? 'NAME' : 'CHANGED'} ${!sort.ascending ? 'DESC' : 'ASC'}`;

    const results = await this.ibmi.runSQL(statement);
    if (results.length) {
      const asp = this.ibmi.aspInfo[Number(results[0].ASP)];
      return results.map(result => ({
        asp,
        library,
        file: String(result.SOURCE_FILE),
        name: String(result.NAME),
        extension: String(result.TYPE),
        recordLength: Number(result.RECORD_LENGTH) - 12,
        text: `${result.TEXT || ``}${sourceFile === `*ALL` ? ` (${result.SOURCE_FILE})` : ``}`.trim(),
        lines: Number(result.LINES),
        created: new Date(result.CREATED ? Number(result.CREATED) : 0),
        changed: new Date(result.CHANGED ? Number(result.CHANGED) : 0)
      } as IBMiMember))
        .filter(member => memberFilter.test(member.name))
        .filter(member => memberExtensionFilter.test(member.extension));
    }
    else {
      return [];
    }
  }

  /**
   *
   * @param filter: the criterias used to list the members
   * @returns
   */
  async getMemberInfo(library: string, sourceFile: string, member: string): Promise<IBMiMember | undefined> {
    if (this.ibmi.remoteFeatures[`GETMBRINFO.SQL`]) {
      const tempLib = this.config.tempLibrary;
      const statement = `select * from table(${tempLib}.GETMBRINFO('${library}', '${sourceFile}', '${member}'))`;

      let results: Tools.DB2Row[] = [];
      if (this.config.enableSQL) {
        try {
          results = await this.runSQL(statement);
        } catch (e) { }; // Ignore errors, will return undefined.
      }
      else {
        results = await this.getQTempTable([`create table QTEMP.MEMBERINFO as (${statement}) with data`], "MEMBERINFO");
      }

      if (results.length === 1 && results[0].ISSOURCE === 'Y') {
        const result = results[0];
        const asp = this.ibmi.aspInfo[Number(results[0].ASP)];
        return {
          library: result.LIBRARY,
          file: result.FILE,
          name: result.MEMBER,
          extension: result.EXTENSION,
          text: result.DESCRIPTION,
          created: new Date(result.CREATED ? Number(result.CREATED) : 0),
          changed: new Date(result.CHANGED ? Number(result.CHANGED) : 0)
        } as IBMiMember
      }
      else {
        return undefined;
      }
    }
  }

  /**
   * Get list of items in a path
   * @param remotePath
   * @return an array of IFSFile
   */
  async getFileList(remotePath: string, sort: SortOptions = { order: "name" }, onListError?: (errors: string[]) => void): Promise<IFSFile[]> {
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
    const inAmerican = (s: string) => { return this.ibmi.sysNameInAmerican(s) };
    const inLocal = (s: string) => { return this.ibmi.sysNameInLocal(s) };

    // Escape names for shell
    const pathList = files
      .map(file => {
        const asp = file.asp || this.config.sourceASP;
        if (asp && asp.length > 0) {
          return [
            Tools.qualifyPath(inAmerican(file.library), inAmerican(file.name), inAmerican(member), asp, true),
            Tools.qualifyPath(inAmerican(file.library), inAmerican(file.name), inAmerican(member), undefined, true)
          ].join(` `);
        } else {
          return Tools.qualifyPath(inAmerican(file.library), inAmerican(file.name), inAmerican(member), undefined, true);
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
          const simplePath = inLocal(Tools.unqualifyPath(firstMost));

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
    const command = `for f in ${libraries.map(lib => `/QSYS.LIB/${this.ibmi.sysNameInAmerican(lib)}.LIB/${this.ibmi.sysNameInAmerican(object)}.*`).join(` `)}; do if [ -f $f ] || [ -d $f ]; then echo $f; break; fi; done`;

    const result = await this.ibmi.sendCommand({
      command,
    });

    if (result.code === 0) {
      const firstMost = result.stdout;

      if (firstMost) {
        const lib = this.ibmi.sysNameInLocal(Tools.unqualifyPath(firstMost));

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
   * @param errorsString; several lines of `code:text`...
   * @returns errors
   */
  parseIBMiErrors(errorsString: string): IBMiError[] {
    return errorsString.split(`\n`)
      .map(error => error.split(':'))
      .map(codeText => ({ code: codeText[0], text: codeText[1] }));
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

  async checkObject(object: { library: string, name: string, type: string, member?: string }, authorities: Authority[] = [`*NONE`]) {
    return (await this.ibmi.runCommand({
      command: this.toCl(`CHKOBJ`, {
        obj: `${this.ibmi.upperCaseName(object.library)}/${this.ibmi.upperCaseName(object.name)}`,
        objtype: object.type.toLocaleUpperCase(),
        aut: authorities.join(" "),
        mbr: object.member
      }),
      noLibList: true
    })).code === 0;
  }

  async testStreamFile(path: string, right: "f" | "d" | "r" | "w" | "x") {
    return (await this.ibmi.sendCommand({ command: `test -${right} ${Tools.escapePath(path)}` })).code === 0;
  }

  isProtectedPath(path: string) {
    if (path.startsWith('/')) { //IFS path
      return this.config.protectedPaths.some(p => path.startsWith(p));
    }
    else { //QSYS path
      const qsysObject = Tools.parseQSysPath(path);
      return this.config.protectedPaths.includes(this.ibmi.upperCaseName(qsysObject.library));
    }
  }

  /**
   *
   * @param command Optionally qualified CL command
   * @param parameters A key/value object of parameters
   * @returns Formatted CL string
   */
  toCl(command: string, parameters: { [parameter: string]: string | number | undefined }) {
    let cl = command;

    for (const [key, value] of Object.entries(parameters)) {
      let parmValue;

      if (value !== undefined) {
        if (typeof value === 'string') {
          if (value === this.ibmi.upperCaseName(value)) {
            parmValue = value;
          } else {
            parmValue = value.replace(/'/g, `''`);
            parmValue = `'${parmValue}'`;
          }
        } else {
          parmValue = String(value);
        }

        cl += ` ${key.toUpperCase()}(${parmValue})`;
      }
    }

    return cl;
  }

  async getAttributes(path: string | (QsysPath & { member?: string }), ...operands: AttrOperands[]) {
    const target = (path = typeof path === 'string' ? path : Tools.qualifyPath(path.library, path.name, path.member, path.asp));
    const result = await this.ibmi.sendCommand({ command: `${this.ibmi.remoteFeatures.attr} -p ${target} ${operands.join(" ")}` });
    if (result.code === 0) {
      return result.stdout
        .split('\n')
        .map(line => line.split('='))
        .reduce((attributes, [key, value]) => {
          attributes[key] = value;
          return attributes;
        }, {} as Record<string, string>)
    }
  }

  async countMembers(path: QsysPath) {
    return this.countFiles(Tools.qualifyPath(path.library, path.name, undefined, path.asp))
  }

  async countFiles(directory: string) {
    return Number((await this.ibmi.sendCommand({ command: `cd ${directory} && (ls | wc -l)` })).stdout.trim());
  }

  objectToToolTip(path: string, object: IBMiObject) {
    const tooltip = new MarkdownString(Tools.generateTooltipHtmlTable(path, {
      type: object.type,
      attribute: object.attribute,
      text: object.text,
      size: object.size,
      created: object.created?.toISOString().slice(0, 19).replace(`T`, ` `),
      changed: object.changed?.toISOString().slice(0, 19).replace(`T`, ` `),
      created_by: object.created_by,
      owner: object.owner,
      iasp: object.asp
    }));
    tooltip.supportHtml = true;
    return tooltip;
  }

  async sourcePhysicalFileToToolTip(path: string, object: IBMiObject) {
    const tooltip = new MarkdownString(Tools.generateTooltipHtmlTable(path, {
      text: object.text,
      members: await this.countMembers(object),
      length: object.sourceLength,
      CCSID: (await this.getAttributes(object, "CCSID"))?.CCSID || '?',
      iasp: object.asp
    }));
    tooltip.supportHtml = true;
    return tooltip;
  }

  memberToToolTip(path: string, member: IBMiMember) {
    const tooltip = new MarkdownString(Tools.generateTooltipHtmlTable(path, {
      text: member.text,
      lines: member.lines,
      created: member.created?.toISOString().slice(0, 19).replace(`T`, ` `),
      changed: member.changed?.toISOString().slice(0, 19).replace(`T`, ` `)
    }));
    tooltip.supportHtml = true;
    return tooltip;
  }

  ifsFileToToolTip(path: string, ifsFile: IFSFile) {
    const tooltip = new MarkdownString(Tools.generateTooltipHtmlTable(path, {
      size: ifsFile.size,
      modified: ifsFile.modified ? new Date(ifsFile.modified.getTime() - ifsFile.modified.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 19).replace(`T`, ` `) : ``,
      owner: ifsFile.owner ? ifsFile.owner.toUpperCase() : ``
    }));
    tooltip.supportHtml = true;
    return tooltip;
  }
}