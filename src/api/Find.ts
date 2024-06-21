
import { GlobalConfiguration } from './Configuration';
import Instance from './Instance';
import { Tools } from './Tools';

export namespace Find {
  const QSYS_PATTERN = /(?:\/\w{1,10}\/QSYS\.LIB\/)|(?:\/QSYS\.LIB\/)|(?:\.LIB)|(?:\.FILE)|(?:\.MBR)/g;

  export interface Result {
    path: string
    readonly?: boolean
    label?: string
  }

  export async function findIFS(instance: Instance, path: string, findTerm: string): Promise<Result[]> {
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
          return parseFindOutput(findRes.stdout);
        }
        else {
          return [];
        }
      } else {
        throw new Error(`Find must be installed on the remote system.`);
      }
    }
    else {
      throw new Error("Please connect to an IBM i");
    }
  }

  function parseFindOutput(output: string, readonly?: boolean, pathTransformer?: (path: string) => string): Result[] {
    const results: Result[] = [];
    for (const line of output.split('\n')) {
      const path = pathTransformer?.(line) || line;
      let result = results.find(r => r.path === path);
      if (!result) {
        result = {
          path,
          readonly,
        };
        results.push(result);
      }
    }

    return results;
  }
}
