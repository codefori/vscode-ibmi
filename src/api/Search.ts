
import { SearchHit, SearchResults } from '../typings';
import { GlobalConfiguration } from './Configuration';
import Instance from './Instance';
import { Tools } from './Tools';

export namespace Search {
  const QSYS_PATTERN = /(?:\/\w{1,10}\/QSYS\.LIB\/)|(?:\/QSYS\.LIB\/)|(?:\.LIB)|(?:\.FILE)|(?:\.MBR)/g;

  export async function searchMembers(instance: Instance, library: string, sourceFile: string, memberFilter: string, searchTerm: string, readOnly?: boolean): Promise<SearchResults> {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    const content = instance.getContent();

    if (connection && config && content) {
      let asp = ``;
      if (config.sourceASP) {
        asp = `/${config.sourceASP}`;
      } else if (connection.enableSQL) {
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
        return {
          term: searchTerm,
          hits: parseGrepOutput(result.stdout || '', readOnly,
            path => connection.sysNameInLocal(path.replace(QSYS_PATTERN, ''))) //Transform QSYS path to URI 'member:' compatible path
        }
      }
      else {
        throw new Error(result.stderr);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  export async function searchIFS(instance: Instance, path: string, searchTerm: string): Promise<SearchResults | undefined> {
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
          stdin: searchTerm
        });

        if (grepRes.code == 0) {
          return {
            term: searchTerm,
            hits: parseGrepOutput(grepRes.stdout)
          }
        }
      } else {
        throw new Error(`Grep must be installed on the remote system.`);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  export async function findIFS(instance: Instance, path: string, findTerm: string): Promise<SearchResults | undefined> {
    const connection = instance.getConnection();
    if (connection) {
      const find = connection.remoteFeatures.find;
      const stat = connection.remoteFeatures.stat;

      if (find) {
        const dirsToIgnore = GlobalConfiguration.get<string[]>(`grepIgnoreDirs`) || [];
        let ignoreString = ``;

        if (dirsToIgnore.length > 0) {
          ignoreString = dirsToIgnore.map(dir => `-type d -path '*/${dir}' -prune -o`).join(` `);
        }

        const findExec = stat ? `-exec ${stat} --printf="%U\t%s\t%Y\t%n\n" {} +` : `-print`;
        const findRes = await connection.sendCommand({
          command: `${find} ${Tools.escapePath(path)} ${ignoreString} -type f -iname '*${findTerm}*' ${findExec}`
        });

        if (findRes.code == 0 && findRes.stdout) {
          return {
            term: findTerm,
            hits: parseFindOutput(findRes.stdout, undefined, (stat !== undefined))
          }
        }
      } else {
        throw new Error(`Find must be installed on the remote system.`);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  function parseFindOutput(output: string, readonly?: boolean, statOutput?: boolean, pathTransformer?: (path: string) => string): SearchHit[] {
    const results: SearchHit[] = [];
    for (const line of output.split('\n')) {
      if (statOutput) {
        let owner: string, size: string, modified: string, name: string;
        [owner, size, modified, name] = line.split(`\t`);
        results.push({
          path: name,
          lines: [],
          size: Number(size),
          modified: new Date(Number(modified) * 1000),
          owner: owner
        });
      } else {
        const path = pathTransformer?.(line) || line;
        results.push(results.find(r => r.path === path) || { path, readonly, lines: [] });
      }
    }
    return results;
  }

  function parseGrepOutput(output: string, readonly?: boolean, pathTransformer?: (path: string) => string): SearchHit[] {
    const results: SearchHit[] = [];
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

  function sanitizeSearchTerm(searchTerm: string): string {
    return searchTerm.replace(/\\/g, `\\\\`).replace(/"/g, `\\"`);
  }

  function nthIndex(aString: string, pattern: string, n: number) {
    let index = -1;
    while (n-- && index++ < aString.length) {
      index = aString.indexOf(pattern, index);
      if (index < 0) break;
    }
    return index;
  }
}