import * as path from 'path';
import { GetMemberInfo } from './components/getMemberInfo';
import { IBMiMember, SearchHit, SearchResults, CommandResult } from '../typings';
import { Tools } from './Tools';
import IBMi from './IBMi';

export namespace Search {
  export async function searchMembers(connection: IBMi, library: string, sourceFile: string, searchTerm: string, members: string|IBMiMember[], readOnly?: boolean,): Promise<SearchResults> {
    const config = connection.getConfig();
    const content = connection.getContent();

    if (connection && config && content) {
      let detailedMembers: IBMiMember[]|undefined;
      let memberFilter: string|undefined;

      const pfgrep = connection.remoteFeatures.pfgrep;

      if (typeof members === `string`) {
        memberFilter = connection.sysNameInAmerican(`${members}.MBR`);
      } else
      if (Array.isArray(members)) {
        if (members.length > connection.maximumArgsLength) {
          detailedMembers = members;
          memberFilter = "*.MBR";
        } else {
          memberFilter = members.map(member => `${member.name}.MBR`).join(` `);
        }
      }
 
      // First, let's fetch the ASP info
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

      // Then search the members
      var result: CommandResult | undefined = undefined;
      if (pfgrep) {
        // pfgrep vs. qshell grep difference: uses -r for recursion instead of -R
        // (GNU/BSD grep treat them the same); we don't use recursion yet though...
        // older versions before 0.4 need -t to trim whitespace, 0.4 inverts the flag
        const command = `${pfgrep} -inHr -F "${sanitizeSearchTerm(searchTerm)}" ${memberFilter}`;
        result = await connection.sendCommand({
          command: command,
          directory: connection.sysNameInAmerican(`${asp}/QSYS.LIB/${library}.LIB/${sourceFile}.FILE`)
        });
      } else {
        const command = `/usr/bin/grep -inHR -F "${sanitizeSearchTerm(searchTerm)}" ${memberFilter}`;
        result = await connection.sendQsh({
          command: command,
          directory: connection.sysNameInAmerican(`${asp}/QSYS.LIB/${library}.LIB/${sourceFile}.FILE`)
        });
      }

      if (!result.stderr) {
        let hits = parseGrepOutput(
          result.stdout || '', readOnly || content.isProtectedPath(library),
          path => connection.sysNameInLocal(`${library}/${sourceFile}/${path.replace(/\.MBR$/, '')}`)
        );

        if (detailedMembers) {
          // If the user provided a list of members, we need to filter the results to only include those members
          hits = hits.filter(hit => {
            const { name, dir } = path.parse(hit.path);
            const [lib, spf] = dir.split(`/`);
            return detailedMembers!.some(member => member.name === name && member.library === lib && member.file === spf);
          });

        } else {
          // Else, we need to fetch the member info for each hit so we can display the correct extension
          const infoComponent = connection?.getComponent<GetMemberInfo>(GetMemberInfo.ID);
          const memberInfos: IBMiMember[] = hits.map(hit => {
            const { name, dir } = path.parse(hit.path);
            const [library, file] = dir.split(`/`);

            return {
              name,
              library,
              file,
              extension: ``
            };
          });

          detailedMembers = await infoComponent?.getMultipleMemberInfo(connection, memberInfos);
        }

        // Then fix the extensions in the hit
        for (const hit of hits) {
          const { name, dir } = path.parse(hit.path);
          const [lib, spf] = dir.split(`/`);

          const foundMember = detailedMembers?.find(member => member.name === name && member.library === lib && member.file === spf);

          if (foundMember) {
            hit.path = connection.sysNameInLocal(`${lib}/${spf}/${name}.${foundMember.extension}`);
          }
        }

        return {
          term: searchTerm,
          hits: hits
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

  export async function searchIFS(connection: IBMi, path: string, searchTerm: string): Promise<SearchResults | undefined> {
    if (connection) {
      const grep = connection.remoteFeatures.grep;

      if (grep) {
        const dirsToIgnore = IBMi.connectionManager.get<string[]>(`grepIgnoreDirs`) || [];
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

  export async function findIFS(connection: IBMi, path: string, findTerm: string): Promise<SearchResults | undefined> {
    if (connection) {
      const find = connection.remoteFeatures.find;

      if (find) {
        const dirsToIgnore = IBMi.connectionManager.get<string[]>(`grepIgnoreDirs`) || [];
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
