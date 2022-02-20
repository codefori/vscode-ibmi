const Configuration = require(`./Configuration`);
const IBMi = require(`./IBMi`);

const escapeRegex = require(`escape-string-regexp`).default;

module.exports = class Search {
  /**
   * @param {*} instance
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} term 
   * @return {Promise<{path: string, text: string, lines: {number: number, content: string}[]}[]>}
   */
  static async searchMembers(instance, lib, spf, term) {
    /** @type {IBMi} */
    const connection = instance.getConnection();
    const config = instance.getConfig();
    
    term = escapeRegex(term);
    term = term.replace(/\\"/g, `\\\\"`);

    const asp = ((config.sourceASP && config.sourceASP.length > 0) ? `/${config.sourceASP}` : ``);

    const result = await connection.qshCommand(`/usr/bin/grep -in "${term}" ${asp}/QSYS.LIB/${lib}.LIB/${spf}.FILE/*`, undefined, 1);

    //@ts-ignore stderr does exist.
    if (result.stderr) throw new Error(result.stderr);

    //@ts-ignore stdout does exist.
    const standardOut = result.stdout;
      
    if (standardOut === ``) return [];
    
    let files = {};
  
    /** @type {string[]} */
    const output = standardOut.split(`\n`);
  
    let parts, currentFile, currentLine, contentIndex, content;
    for (const line of output) {
      if (line.startsWith(`Binary`)) continue;
  
      parts = line.split(`:`);
      currentFile = parts[0].substr(10); //Remove '/QSYS.LIB/'
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
        content = line.substr(contentIndex+1);
  
        files[currentFile].lines.push({
          number: currentLine,
          content 
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
      let standardOut = ``;

      term = escapeRegex(term);
      term = term.replace(/\\"/g, `\\\\"`);

      /** @type {string[]} */
      const dirsToIgnore = Configuration.get(`grepIgnoreDirs`);
      let ignoreString = ``;

      if (dirsToIgnore.length > 0) {
        ignoreString = dirsToIgnore.map(dir => `--exclude-dir=${dir}`).join(` `);
      }

      try {
        //@ts-ignore
        standardOut = await connection.paseCommand(`${grep} -inr ${ignoreString} "${term}" "${path}"`);
      } catch (e) {
        if (e === ``) standardOut = e //Means no results were found.
        else throw e;
      }

      if (standardOut === ``) return [];
    
      let files = {};
  
      /** @type {string[]} */ //@ts-ignore
      const output = standardOut.split(`\n`);
  
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
          content = line.substr(contentIndex+1);
    
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