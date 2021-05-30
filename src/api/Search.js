const Configuration = require(`./Configuration`);
const IBMi = require(`./IBMi`);

module.exports = class Search {
  /**
   * @param {*} instance
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} term 
   * @return {Promise<{path: string, text: string, recordLength: number, lines: {number: number, content: string}[]}[]>}
   */
  static async searchMembers(instance, lib, spf, term) {
    /** @type {IBMi} */
    const connection = instance.getConnection();
    
    term = term.replace(/'/g, `\\'`);
    //const standardOut = await connection.remoteCommand(`FNDSTRPDM STRING('${term}') FILE(${lib}/${spf}) MBR(*ALL) OPTION(*NONE) PRTMBRLIST(*YES) PRTRCDS('*ALL ' *CHAR *NOMARK *TRUNCATE)`, `.`);
    const standardOut = await connection.qshCommand(`/usr/bin/grep -in '${term}' /QSYS.LIB/${lib}.LIB/${spf}.FILE/*`);
      
    if (standardOut === ``) return [];
    
    let files = {};
  
    /** @type {string[]} */ //@ts-ignore
    const output = standardOut.split(`\n`);
  
    let parts, currentFile, currentLine;
    for (const line of output) {
      if (line.startsWith(`Binary`)) continue;
  
      parts = line.split(`:`);
      currentFile = parts[0].substr(10); //Remove '/QSYS.LIB/'
      currentFile = `/` + currentFile.replace(`.LIB`, ``).replace(`.FILE`, ``).replace(`.MBR`, ``);

      currentLine = Number(parts[1]);

      if (!files[currentFile]) {
        files[currentFile] = {
          path: currentFile,
          lines: []
        };
      }
  
      files[currentFile].lines.push({
        number: currentLine,
        content: parts[2] 
      })
      
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
      const standardOut = await connection.paseCommand(`${grep} -nr "${term}" ${path}`);

      if (standardOut === ``) return [];
    
      let files = {};
  
      /** @type {string[]} */ //@ts-ignore
      const output = standardOut.split(`\n`);
  
      let parts;
      for (const line of output) {
        if (line.startsWith(`Binary`)) continue;
  
        parts = line.split(`:`);
        if (!files[parts[0]]) {
          files[parts[0]] = {
            path: parts[0],
            lines: []
          };
        }
  
        files[parts[0]].lines.push({
          number: Number(parts[1]),
          content: parts[2] 
        })
      
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

  /**
   * 
   * @param {`member`|`streamfile`} scheme 
   * @param {{path: string, text?: string, recordLength?: number, lines: {number: number, content: string}[]}[]} results 
   * @return {string}
   */
  static generateDocument(scheme, results) {
    const lines = [];

    let totalResults = 0;

    results.forEach(file => {
      totalResults += file.lines.length;
    })

    lines.push(
      ``,
      `${totalResults} results - ${results.length} files`,
      ``,
    );

    for (const file of results) {
      lines.push(`${scheme}:${file.path}`);

      for (const hit of file.lines) {
        lines.push(`${String(hit.number).padStart(6)} ${hit.content}`);
      }

      lines.push(``);
    }

    return lines.join(`\n`);
  }
}