
import { isProtectedFilter } from '../filesystems/qsys/QSysFs';
import { GlobalConfiguration } from './Configuration';
import Instance from './Instance';
import { Tools } from './Tools';
import { CommandResult } from "../typings";

export namespace Search {
  const QSYS_PATTERN = /(?:\/\w{1,10}\/QSYS\.LIB\/)|(?:\/QSYS\.LIB\/)|(?:\.LIB)|(?:\.FILE)|(?:\.MBR)/g;

  export interface Result {
    path: string
    lines: Line[]
    readonly?: boolean
    label?: string
    contextValue?: string
  }

  export interface Line {
    number: number
    content: string
  }

  export async function searchMembers(instance: Instance, library: string, sourceFile: string, memberFilter: string, searchTerm: string, filter?: string): Promise<Result[]> {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    const content = instance.getContent();

    if (connection && config && content) {
      let asp = ``;
      if (config.sourceASP) {
        asp = `/${config.sourceASP}`;
      } else if (config.enableSQL) {
        try {
          const [row] = await content.runSQL(`SELECT IASP_NUMBER FROM TABLE(QSYS2.LIBRARY_INFO('${library}'))`);
          const iaspNumber = row?.IASP_NUMBER;
          if (iaspNumber && typeof iaspNumber === 'number' && connection.aspInfo[iaspNumber]) {
            asp = `/${connection.aspInfo[iaspNumber]}`;
          }
        } catch (e) { }
      }

      const result = await connection.sendQsh({
        command: `/usr/bin/grep -inHR -F "${sanitizeSearchTerm(searchTerm)}" ${asp}/QSYS.LIB/${connection.sysNameInAmerican(library)}.LIB/${connection.sysNameInAmerican(sourceFile)}.FILE/${memberFilter ? connection.sysNameInAmerican(memberFilter) : `*`}`,
      });

      if (!result.stderr) {
        return parseGrepOutput(result.stdout || '', filter,
          path => connection.sysNameInLocal(path.replace(QSYS_PATTERN, ''))); //Transform QSYS path to URI 'member:' compatible path
      }
      else {
        throw new Error(result.stderr);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  export async function searchUserSpooledFiles(instance: Instance, searchTerm: string, filter: string): Promise<Result[]> {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    const content = instance.getContent();

    if (connection && config && content) {
      const objects = await content.getUserSpooledFileList(filter);
      const largeString = JSON.stringify(objects);
      // let result[];
      const rows = await content.runSQL(`with USER_SPOOLED_FILES (SFUSER, OUTQ, QJOB, SFILE, SFILE_NUMBER) as (
        select "user", "queue", "qualified_job_name", "name", "number" from JSON_Table(
        '${largeString}' 
        ,'lax $'
        COLUMNS( 
         "user" char(10) 
        ,"name" char(10) 
        ,"number" int 
        ,"status" char(10) 
        ,"creation_timestamp" timestamp 
        ,"user_data" char(10) 
        ,"size" int 
        ,"total_pages" int 
        ,"qualified_job_name" char(28) 
        ,"job_name" char(10) 
        ,"job_user" char(10) 
        ,"job_number" char(10)
        ,"form_type" char(10) 
        ,"queue_library" char(10) 
        ,"queue" char(10) 
        )) as SPLF
        )
        ,ALL_USER_SPOOLED_FILE_DATA (SFUSER, OUTQ, QJOB, SFILE, SFILE_NUMBER, SPOOL_DATA, ORDINAL_POSITION) as (
              select SFUSER, OUTQ, QJOB, SFILE, SFILE_NUMBER, SPOOLED_DATA, SD.ORDINAL_POSITION
                from USER_SPOOLED_FILES
                ,table (SYSTOOLS.SPOOLED_FILE_DATA(JOB_NAME => QJOB, SPOOLED_FILE_NAME => SFILE, SPOOLED_FILE_NUMBER => SFILE_NUMBER)) SD )
          select trim(SFUSER)||'/'||trim(OUTQ)||'/'||trim(SFILE)||'~'||replace(trim(QJOB),'/','~')||'~'||trim(SFILE_NUMBER)||'.splf'||':'||char(ORDINAL_POSITION)||':'||varchar(trim(SPOOL_DATA),132) SEARCH_RESULT
            from ALL_USER_SPOOLED_FILE_DATA AMD
            where upper(SPOOL_DATA) like upper('%${sanitizeSearchTerm(searchTerm)}%')`);
      // var resultString = rows.join("\\n");
      var resultString = rows.map(function(elem){ return elem.SEARCH_RESULT; }).join("\n");
      // this.resourceUri = getSpooledFileUri(object, parent.protected ? { readonly: true } : undefined);
      var result = {
        code: 0,
        stdout: `${resultString}`,
        stderr: ``,
        command: ``
      } as CommandResult;
      if (!result.stderr) {
        // path: "/${user}/QEZJOBLOG/QPJOBLOG_D000D2034A_${user}_849412_1.splf" <- path should be like this
        // TODO: Path issue with part names with underscores in them.  Need a different job separator token or can we use more sub parts to the path??
        return parseGrepOutput(result.stdout || '', filter,
          path => connection.sysNameInLocal(path)); 
      }
      else {
        throw new Error(result.stderr);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }
  
  export async function searchIFS(instance: Instance, path: string, searchTerm: string): Promise<Result[]> {
    const connection = instance.getConnection();
    if (connection) {
      const grep = connection.remoteFeatures.grep;

      if (grep) {
        const dirsToIgnore = GlobalConfiguration.get<string[]>(`grepIgnoreDirs`) || [];
        let ignoreString = ``;

        if (dirsToIgnore.length > 0) {
          ignoreString = dirsToIgnore.map(dir => `--exclude-dir=${dir}`).join(` `);
        }

        const grepRes = await connection.sendCommand({
          command: `${grep} -inr -F -f - ${ignoreString} ${Tools.escapePath(path)}`,
          stdin: sanitizeSearchTerm(searchTerm)
        });

        if (grepRes.code == 0) {
          return parseGrepOutput(grepRes.stdout);
        }
        else {
          return [];
        }
      } else {
        throw new Error(`Grep must be installed on the remote system.`);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  function parseGrepOutput(output: string, filter?: string, pathTransformer?: (path: string) => string): Result[] {
    const results: Result[] = [];
    const readonly = isProtectedFilter(filter);
    for (const line of output.split('\n')) {
      if (!line.startsWith(`Binary`)) {
        const parts = line.split(`:`); //path:line
        const path = pathTransformer?.(parts[0]) || parts[0];
        let result = results.find(r => r.path === path);
        if (!result) {
          result = {
            path,
            lines: [],
            readonly,
          };
          results.push(result);
        }

        const contentIndex = nthIndex(line, `:`, 2);
        if (contentIndex >= 0) {
          const curContent = line.substring(contentIndex + 1);

          result.lines.push({
            number: Number(parts[1]),
            content: curContent
          })
        }
      }
    }

    return results;
  }
}

function sanitizeSearchTerm(searchTerm: string): string {
  return searchTerm.replace(/\\/g, `\\\\`).replace(/"/g, `\\\\"`);
}

function nthIndex(aString: string, pattern: string, n: number) {
  let index = -1;
  while (n-- && index++ < aString.length) {
    index = aString.indexOf(pattern, index);
    if (index < 0) break;
  }
  return index;
}