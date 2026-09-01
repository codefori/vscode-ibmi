import vscode, { l10n } from "vscode";
import IBMi from "./IBMi";
import { CacheItem, SharedSnippet } from "./types";

const SNIPPETS_FILE = `/etc/vscode/snippets.json`;
const CACHE_TTL = 30000; // 30 seconds, so external edits to the file still show up eventually

// per-connection, so the completion provider isn't hitting the IFS on every keystroke
const cache = new WeakMap<IBMi, CacheItem<SharedSnippet[]>>();

/**
 * Manages the shared snippets file, which uses the same layout as VS Code's own
 * user defined snippets: https://code.visualstudio.com/docs/editing/userdefinedsnippets
 */
export namespace SharedSnippetTools {
  export function getSnippetsFile() {
    return SNIPPETS_FILE;
  }

  /** Drops the cached snippets, e.g. after {@link getSnippetsFile} was edited outside of our own commands. */
  export function invalidate(connection: IBMi) {
    cache.delete(connection);
  }

  export async function getSnippets(connection: IBMi, options?: { forceReload?: boolean }): Promise<SharedSnippet[]> {
    const cached = cache.get(connection);
    if (!options?.forceReload && cached && (!cached.createdAt || cached.createdAt + CACHE_TTL >= Date.now())) {
      return cached.value;
    }

    const snippets: SharedSnippet[] = [];
    const content = connection.getContent();

    if (await content.testStreamFile(SNIPPETS_FILE, "r")) {
      try {
        const raw = await content.downloadStreamfileRaw(SNIPPETS_FILE);
        const parsed = JSON.parse(raw.toString("utf8"));

        // Maybe one day replace this with real schema validation
        if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) {
          for (const [name, entry] of Object.entries<any>(parsed)) {
            if (entry && typeof entry === `object` && (typeof entry.prefix === `string` || Array.isArray(entry.prefix)) && (typeof entry.body === `string` || Array.isArray(entry.body))) {
              snippets.push({
                name,
                prefix: toStringArray(entry.prefix),
                description: typeof entry.description === `string` ? entry.description : ``,
                scope: typeof entry.scope === `string` ? splitScope(entry.scope) : Array.isArray(entry.scope) ? entry.scope.map(String) : [],
                body: toStringArray(entry.body)
              });
            } else {
              throw new Error(l10n.t("Invalid shared snippet '{0}'.", name));
            }
          }
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(l10n.t("Error parsing {0}: {1}", SNIPPETS_FILE, e.message));
      }
    }

    return setCache(connection, snippets);
  }

  export async function createSnippet(connection: IBMi, snippet: SharedSnippet) {
    const snippets = await getSnippets(connection);
    await writeSnippets(connection, [...snippets, snippet]);
  }

  export async function updateSnippet(connection: IBMi, snippet: SharedSnippet, options?: { newName?: string, newPrefix?: string[], newDescription?: string, newScope?: string[], newBody?: string[], delete?: boolean }) {
    const snippets = await getSnippets(connection);
    const index = snippets.findIndex(s => s.name === snippet.name);
    if (index < 0) {
      throw new Error(l10n.t("Cannot find shared snippet {0} for update.", snippet.name));
    }

    if (options?.delete) {
      snippets.splice(index, 1);
    } else {
      if (options?.newName !== undefined) {
        snippets[index].name = options.newName;
      }
      if (options?.newPrefix !== undefined) {
        snippets[index].prefix = options.newPrefix;
      }
      if (options?.newDescription !== undefined) {
        snippets[index].description = options.newDescription;
      }
      if (options?.newScope !== undefined) {
        snippets[index].scope = options.newScope;
      }
      if (options?.newBody !== undefined) {
        snippets[index].body = options.newBody;
      }
    }

    await writeSnippets(connection, snippets);
  }

  /** The snippet's body, as it is shown in an editor. */
  export function getBodyText(snippet: SharedSnippet) {
    return snippet.body.join(`\n`);
  }

  export function toBody(text: string) {
    return text.split(/\r?\n/);
  }

  /** e.g. ("i hate spaces", "rpgle") -> "i_hate_spaces.rpgle" */
  export function sanitizeFileName(name: string, extension: string): string {
    // no spaces on the IFS, ever! underscores only, sysadmin's orders
    const base = name.trim().toLocaleLowerCase().replace(/\s+/g, `_`).replace(/[^a-z0-9_]+/g, ``).replace(/^_+|_+$/g, ``) || `snippet`;
    const ext = extension.trim().replace(/^\.+/, ``).toLocaleLowerCase() || `txt`;
    return `${base}.${ext}`;
  }

  function splitScope(scope: string) {
    return scope.split(`,`).map(part => part.trim()).filter(Boolean);
  }

  function toStringArray(value: string | string[]) {
    return Array.isArray(value) ? value.map(String) : [value];
  }

  function setCache(connection: IBMi, snippets: SharedSnippet[]) {
    const sorted = [...snippets].sort((s1, s2) => s1.name.localeCompare(s2.name));
    cache.set(connection, { value: sorted, createdAt: Date.now() });
    return sorted;
  }

  async function writeSnippets(connection: IBMi, snippets: SharedSnippet[]) {
    const file: Record<string, any> = {};
    for (const snippet of [...snippets].sort((s1, s2) => s1.name.localeCompare(s2.name))) {
      file[snippet.name] = {
        // a single prefix/body line is written as a plain string, like VS Code does
        prefix: snippet.prefix.length === 1 ? snippet.prefix[0] : snippet.prefix,
        body: snippet.body.length === 1 ? snippet.body[0] : snippet.body,
        description: snippet.description,
        scope: snippet.scope.join(`,`)
      };
    }

    await connection.getContent().writeStreamfileRaw(SNIPPETS_FILE, JSON.stringify(file, undefined, 2), `utf8`);
    setCache(connection, snippets);
  }
}
