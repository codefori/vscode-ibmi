
import { IBMiMember, SearchHit, SearchResults } from '../typings';
import { GlobalConfiguration } from './Configuration';
import Instance from './Instance';
import { Tools } from './Tools';

export namespace Search {
  export async function searchMembers(instance: Instance, library: string, sourceFile: string, searchTerm: string, members: IBMiMember[] | string, readOnly?: boolean,): Promise<SearchResults> {
    const connection = instance.getConnection();
    const config = instance.getConfig();
    const content = instance.getContent();

    if (connection && config && content) {
      let memberFilter = connection.sysNameInAmerican(typeof members === 'string' ? `${members}.MBR` : members.map(member => `${member.name}.MBR`).join(" "));

      let postSearchFilter = (hit: SearchHit) => true;
      if (Array.isArray(members) && memberFilter.length > connection.maximumArgsLength) {
        //Failsafe: when searching on a complex filter, the member list may exceed the maximum admited arguments length (which is around 4.180.000 characters, roughly 298500 members),
        //          in this case, we fall back to a global search and manually filter the results afterwards/
        memberFilter = "*.MBR";
        postSearchFilter = (hit) => {
          const memberName = hit.path.split("/").at(-1);
          return members.find(member => member.name === memberName) !== undefined;
        }
      }

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
        command: `/usr/bin/grep -inHR -F "${sanitizeSearchTerm(searchTerm)}" ${memberFilter}`,
        directory: connection.sysNameInAmerican(`${asp}/QSYS.LIB/${library}.LIB/${sourceFile}.FILE`)
      });

      if (!result.stderr) {
        return {
          term: searchTerm,
          hits: (parseGrepOutput(result.stdout || '', readOnly || content.isProtectedPath(library),
            path => connection.sysNameInLocal(`${library}/${sourceFile}/${path.replace(/\.MBR$/, '')}`)))
            .filter(postSearchFilter)
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

      if (find) {
        const dirsToIgnore = GlobalConfiguration.get<string[]>(`grepIgnoreDirs`) || [];
        let ignoreString = ``;

        if (dirsToIgnore.length > 0) {
          ignoreString = dirsToIgnore.map(dir => `-type d -path '*/${dir}' -prune -o`).join(` `);
        }

        const findRes = await connection.sendCommand({
          command: `${find} ${Tools.escapePath(path)} ${ignoreString} -type f -iname '*${findTerm}*' -print`
        });

        if (findRes.code == 0 && findRes.stdout) {
          return {
            term: findTerm,
            hits: parseFindOutput(findRes.stdout)
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

  function parseFindOutput(output: string, readonly?: boolean, pathTransformer?: (path: string) => string): SearchHit[] {
    const results: SearchHit[] = [];
    for (const line of output.split('\n')) {
      const path = pathTransformer?.(line) || line;
      results.push(results.find(r => r.path === path) || { path, readonly, lines: [] });
    }
    return results;
  }

  function parseGrepOutput(output: string, readonly?: boolean, pathTransformer?: (path: string) => string): SearchHit[] {
    const results: SearchHit[] = [];
    for (const line of output.split('\n')) {
      if (line && !line.startsWith(`Binary`)) {
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