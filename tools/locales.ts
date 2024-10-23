import fs from 'fs';
import { basename } from 'path';

async function translate() {
  const ids = fs.readdirSync('src/locale/ids').map(id => `src/locale/ids/${id}`);
  const main = ids.find(id => id.endsWith('en.json'));
  const others = ids.filter(id => !id.endsWith('en.json'));
  if (main) {
    console.log('Generating main bundle');
    const toBundle = (path: string) => JSON.parse(fs.readFileSync(path).toString("utf8")) as Record<string, string>
    const mainBundle = toBundle(main);
    const keys = Object.keys(mainBundle);
    const l10nBundle = Object.values(mainBundle).sort((v1, v2) => v1.localeCompare(v2)).reduce((p, c) => { p[c] = c; return p }, {} as Record<string, string>);
    fs.writeFileSync('dist/l10n/bundle.l10n.json', JSON.stringify(l10nBundle, null, 2));

    others.forEach(bundle => {
      const id = basename(bundle, ".json");
      console.log(`Generating ${id} bundle`);
      const content = toBundle(bundle);
      const l10n = Object.entries(content)
        .sort(([k1], [k2]) => mainBundle[k1].localeCompare(mainBundle[k2]))
        .reduce((p, [key, value]) => { p[mainBundle[key]] = value; return p }, {} as Record<string, string>);
      fs.writeFileSync(`dist/l10n/bundle.l10n.${id}.json`, JSON.stringify(l10n, null, 2), { encoding: "utf8" });
    });
    console.log(`Done generating bundles\n`);

    console.log(`Gathering files`);
    const files: string[] = [];
    const listFiles = (path: string) => {
      for (const file of fs.readdirSync(path)) {
        const fullPath = `${path}/${file}`;
        if (fs.statSync(fullPath).isDirectory()) {
          listFiles(fullPath);
        }
        else if (!fullPath.startsWith('src/tools')) {
          files.push(fullPath);
        }
      }
    }
    listFiles('src');

    console.log(`Found ${files.length} files\n`);

    for (const file of files) {
      let changed = false;
      let importVscode = false;
      let prefix = "vscode.";
      const lines = fs.readFileSync(file).toString('utf8').split('\n')
        .filter(line => !/import .* from .*locale/.test(line))
        .map((line, i) => {
          if (!importVscode && /from ['"`]vscode['"`]/.test(line)) {
            importVscode = true;
            if(/\{(.*)\}/.test(line)){
              prefix = '';
              return line.replace(/\{ (.*) \}/, "{ l10n, $1 }")
            }
          }
          const res = /[^\w\.]t\(([^)]+)\)/.exec(line);
          if (res && res[1]) {
            changed = true;
            const parts = res[1].replaceAll(/['"`]/g, '').split(',');
            const oldKey = parts.splice(0, 1)[0];
            const key = mainBundle[oldKey];
            if (!key) {
              console.log(`KEY ${oldKey} NOT FOUND ${file} line ${i + 1}`)
            }
            return line.replaceAll(/([^\w\.])t\(([^)]+)\)/g, `$1${prefix}l10n.t(\`${key}\`${parts.length ? ',' + parts.join(', ') : ''})`);
          }
          else {
            return line;
          }
        });

      if (changed) {
        fs.writeFileSync(file, `${importVscode ? '' : `import vscode from "vscode";\n`}${lines.join("\n")}`, { encoding: "utf8" });
      }
    }
  }
}

translate();