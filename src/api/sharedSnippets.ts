import path from "path";
import vscode, { l10n } from "vscode";
import IBMi from "./IBMi";
import { Tools } from "./Tools";
import { SharedSnippet } from "./types";

const SNIPPETS_DIRECTORY = `/etc/vscode/snippets`;
const GLOBAL_SNIPPETS = `global`;
const LISTING_TTL = 30000;

const NEW_FILE_CONTENT = [
  `{`,
  `\t// Place your shared snippets here. Each snippet is defined under a snippet name`,
  `\t// and has a "prefix", a "body" and an optional "description".`,
  `\t// See https://code.visualstudio.com/docs/editing/userdefinedsnippets`,
  `\t// Example:`,
  `\t// "Print to console": {`,
  `\t// \t"prefix": "log",`,
  `\t// \t"body": [`,
  `\t// \t\t"console.log('$1');",`,
  `\t// \t\t"$2"`,
  `\t// \t],`,
  `\t// \t"description": "Log output to console"`,
  `\t// }`,
  `}`
].join(`\n`);

export type NamedSharedSnippet = SharedSnippet & {
  name: string
};

export type SharedSnippetsFile = {
  path: string
  languageId?: string
  snippets: NamedSharedSnippet[]
};

type CachedFile = {
  modified?: number
  file: SharedSnippetsFile
};

type Cache = {
  listedAt: number
  files: Map<string, CachedFile>
};

const cache = new WeakMap<IBMi, Cache>();

/**
 * Manages the shared snippets files, stored in the /etc/vscode/snippets IFS folder using the same
 * layout as https://code.visualstudio.com/docs/editing/userdefinedsnippets
 */
export namespace SharedSnippets {

  export function getFilePath(languageId?: string) {
    return path.posix.join(SNIPPETS_DIRECTORY, `${languageId || GLOBAL_SNIPPETS}.json`);
  }

  export function getLanguageId(filePath: string) {
    const basename = path.posix.basename(filePath, `.json`);
    return basename === GLOBAL_SNIPPETS ? undefined : basename;
  }

  export function isSnippetsFile(filePath: string) {
    return path.posix.dirname(filePath) === SNIPPETS_DIRECTORY && filePath.toLocaleLowerCase().endsWith(`.json`);
  }

  export function invalidate(connection: IBMi) {
    cache.delete(connection);
  }

  /** Only the files that changed since the last listing are read again. */
  export async function getSnippetsFiles(connection: IBMi, options?: { forceReload?: boolean }): Promise<SharedSnippetsFile[]> {
    const cached = cache.get(connection);
    if (!options?.forceReload && cached && cached.listedAt + LISTING_TTL >= Date.now()) {
      return toFiles(cached);
    }

    const content = connection.getContent();
    const files = new Map<string, CachedFile>();

    if (await content.testStreamFile(SNIPPETS_DIRECTORY, `d`)) {
      for (const found of await content.getFileList(SNIPPETS_DIRECTORY)) {
        if (found.type === `streamfile` && isSnippetsFile(found.path)) {
          const modified = found.modified?.getTime();
          const previous = cached?.files.get(found.path);
          if (previous && modified !== undefined && previous.modified === modified) {
            files.set(found.path, previous);
          }
          else {
            files.set(found.path, { modified, file: await read(connection, found.path) });
          }
        }
      }
    }

    const newCache = { listedAt: Date.now(), files };
    cache.set(connection, newCache);
    return toFiles(newCache);
  }

  export async function createSnippetsFile(connection: IBMi, languageId?: string) {
    const filePath = getFilePath(languageId);
    const content = connection.getContent();

    if (!await content.testStreamFile(filePath, `e`)) {
      // Everyone reads, the owner writes; same as /etc/vscode/settings.json. Sys admins can fine tune afterwards.
      const directory = await connection.sendCommand({ command: `mkdir -p "${Tools.escapePath(SNIPPETS_DIRECTORY, true)}" && chmod 755 "${Tools.escapePath(SNIPPETS_DIRECTORY, true)}"` });
      if (directory.code !== 0) {
        throw new Error(l10n.t("Could not create {0}: {1}", SNIPPETS_DIRECTORY, directory.stderr));
      }

      await content.createStreamFile(filePath);
      await content.writeStreamfileRaw(filePath, NEW_FILE_CONTENT, `utf8`);
      await connection.sendCommand({ command: `chmod 644 "${Tools.escapePath(filePath, true)}"` });
      invalidate(connection);
    }

    return filePath;
  }

  /**
   * Where and what to insert to add a snippet to a snippets file. It goes at the top of the file,
   * so the rest of it - comments and formatting included - stays untouched.
   */
  export function buildInsertion(fileContent: string, name: string, snippet: SharedSnippet) {
    const existing = Object.keys(parseJsonWithComments(fileContent));
    if (existing.some(existingName => existingName.toLocaleUpperCase() === name.toLocaleUpperCase())) {
      throw new Error(l10n.t("This name is already used by another shared snippet"));
    }

    const brace = findSnippetsBrace(fileContent);
    if (brace < 0) {
      throw new Error(l10n.t("No snippets object found in the file."));
    }

    const entry = JSON.stringify({ [name]: snippet }, undefined, `\t`)
      .split(`\n`)
      .slice(1, -1) //the wrapping braces are the file's own
      .join(`\n`);

    const followingContent = fileContent.substring(brace + 1);
    return {
      offset: brace + 1,
      text: `\n${entry}${existing.length ? `,` : ``}${/^\r?\n/.test(followingContent) ? `` : `\n`}`
    };
  }

  function findSnippetsBrace(content: string) {
    for (let i = 0; i < content.length; i++) {
      const current = content[i];
      const next = content[i + 1];

      if (current === `/` && next === `/`) {
        while (i < content.length && content[i] !== `\n`) {
          i++;
        }
      }
      else if (current === `/` && next === `*`) {
        i += 2;
        while (i < content.length && !(content[i] === `*` && content[i + 1] === `/`)) {
          i++;
        }
        i++;
      }
      else if (current === `{`) {
        return i;
      }
      else if (!/\s/.test(current)) {
        return -1;
      }
    }

    return -1;
  }

  async function read(connection: IBMi, filePath: string): Promise<SharedSnippetsFile> {
    const snippets: NamedSharedSnippet[] = [];

    try {
      const raw = await connection.getContent().downloadStreamfileRaw(filePath);
      const parsed = parseJsonWithComments(raw.toString(`utf8`));

      // Maybe one day replace this with real schema validation
      if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) {
        for (const [name, snippet] of Object.entries<any>(parsed)) {
          if (snippet && typeof snippet === `object` && (typeof snippet.body === `string` || Array.isArray(snippet.body))) {
            snippets.push({ ...snippet, name });
          }
          else {
            throw new Error(l10n.t("Invalid shared snippet '{0}'.", name));
          }
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(l10n.t("Error parsing {0}: {1}", filePath, error.message));
    }

    return { path: filePath, languageId: getLanguageId(filePath), snippets };
  }

  function toFiles(cached: Cache) {
    return [...cached.files.values()].map(entry => entry.file);
  }

  /** VS Code allows comments and trailing commas in snippets files, and its own template is made of comments. */
  function parseJsonWithComments(content: string) {
    let json = ``;
    let pendingComma = false;

    const append = (text: string) => {
      if (pendingComma) {
        pendingComma = false;
        if (!text.startsWith(`}`) && !text.startsWith(`]`)) {
          json += `,`;
        }
      }
      json += text;
    };

    for (let i = 0; i < content.length; i++) {
      const current = content[i];
      const next = content[i + 1];

      if (current === `"`) {
        let string = current;
        while (++i < content.length) {
          string += content[i];
          if (content[i] === `\\`) {
            string += content[++i];
          }
          else if (content[i] === `"`) {
            break;
          }
        }
        append(string);
      }
      else if (current === `/` && next === `/`) {
        while (i < content.length && content[i] !== `\n`) {
          i++;
        }
      }
      else if (current === `/` && next === `*`) {
        i += 2;
        while (i < content.length && !(content[i] === `*` && content[i + 1] === `/`)) {
          i++;
        }
        i++;
      }
      else if (current === `,`) {
        pendingComma = true; //only kept if something other than the end of an object or an array follows
      }
      else if (!/\s/.test(current)) {
        append(current);
      }
    }

    return json ? JSON.parse(json) : {};
  }
}
