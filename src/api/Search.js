
const Configuration = require(`./Configuration`);
const IBMi = require(`./IBMi`);
const IBMiContent = require(`./IBMiContent`);
const Tools = require(`./Tools`);

module.exports = class Search {
  /**
   * @param {*} instance
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} memberFilter
   * @param {string} term 
   * @return {Promise<{path: string, text: string, lines: {number: number, content: string}[]}[]>}
   */
  static async searchMembers(instance, lib, spf, memberFilter, term) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const config = instance.getConfig();

    /** @type {IBMiContent} */
    const content = instance.getContent();
    
    term = term.replace(/\\/g, `\\\\`);
    term = term.replace(/"/g, `\\\\"`);

    let asp = ``;

    if (config.sourceASP && config.sourceASP.length > 0) {
      asp = `/${config.sourceASP}`;
    } else 
    if (config.enableSQL) {
      try {
        const [row] = await content.runSQL(`SELECT IASP_NUMBER FROM TABLE(QSYS2.LIBRARY_INFO('${lib}'))`);

        if (row && connection.aspInfo[row.IASP_NUMBER]) {
          asp = `/${connection.aspInfo[row.IASP_NUMBER]}`;
        }
      } catch (e) {}
    }

    const result = await connection.sendQsh({
      command: `/usr/bin/grep -in -F "${term}" ${asp}/QSYS.LIB/${lib}.LIB/${spf}.FILE/${memberFilter ? memberFilter : `*`}`,
    });

    //@ts-ignore stderr does exist.
    if (result.stderr) throw new Error(result.stderr);

    const standardOut = result.stdout;
      
    if (standardOut === ``) return [];
    
    let files = {};
  
    /** @type {string[]} */
    const output = standardOut.split(`\n`);
  
    let parts, currentFile, currentLine, contentIndex, curContent;
    for (const line of output) {
      if (line.startsWith(`Binary`)) continue;
  
      parts = line.split(`:`);
      currentFile = parts[0].substring(10); //Remove '/QSYS.LIB/'
      currentFile = currentFile.replace(`.LIB`, ``).replace(`.FILE`, ``).replace(`.MBR`, ``);

      currentLine = Number(parts[1]);

      if (!files[currentFile]) {
        files[currentFile] = {
          path: currentFile,
          lines: []
        };
      }

      contentIndex = nthIndex(line, `:`, 2);
      
      if (contentIndex >= 0) {
        curContent = line.substring(contentIndex+1);
  
        files[currentFile].lines.push({
          number: currentLine,
          content: curContent 
        })
      }
      
    }
  
    let list = [];

    for (const file in files) {
      list.push(files[file]);
    }
  
    return list;
  }

  /**
   * 
   * @param {*} instance 
   * @param {string} path 
   * @param {string} term 
   * @returns {Promise<{path: string, lines: {number: number, content: string}[]}[]>}
   */
  static async searchIFS(instance, path, term) {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    const grep = connection.remoteFeatures.grep;

    if (grep) {
      term = term.replace(/\\/g, `\\\\`);
      term = term.replace(/"/g, `\\\\"`);

      /** @type {string[]} */
      const dirsToIgnore = Configuration.get(`grepIgnoreDirs`);
      let ignoreString = ``;

      if (dirsToIgnore.length > 0) {
        ignoreString = dirsToIgnore.map(dir => `--exclude-dir=${dir}`).join(` `);
      }

      const grepRes = await connection.sendCommand({
        command: `${grep} -inr -F -f - ${ignoreString} ${Tools.escapePath(path)}`,
        stdin: term
      });

      if (grepRes.code !== 0) return [];
    
      let files = {};
  
      /** @type {string[]} */ //@ts-ignore
      const output = grepRes.stdout.split(`\n`);
  
      let parts, contentIndex, content;
      for (const line of output) {
        if (line.startsWith(`Binary`)) continue;
  
        parts = line.split(`:`);
        if (!files[parts[0]]) {
          files[parts[0]] = {
            path: parts[0],
            lines: []
          };
        }
  
        contentIndex = nthIndex(line, `:`, 2);
      
        if (contentIndex >= 0) {
          content = line.substring(contentIndex+1);
    
          files[parts[0]].lines.push({
            number: Number(parts[1]),
            content
          })
        }
      
      }
  
      let list = [];

      for (const file in files) {
        list.push(files[file]);
      }
  
      return list;

    } else {
      throw new Error(`Grep must be installed on the remote system.`);
    }
  }
}

function nthIndex(str, pat, n){
  let L = str.length, i = -1;
  while(n-- && i++<L){
    i= str.indexOf(pat, i);
    if (i < 0) break;
  }
  return i;
}