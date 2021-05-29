const Configuration = require(`./Configuration`);
const IBMi = require(`./IBMi`);

module.exports = class Search {
  /**
   * @param {*} instance
   * @param {string} lib 
   * @param {string} spf 
   * @param {string} term 
   * @return {Promise<{name: string, text: string, recordLength: number, lines: {number: string, content: string}[]}[]>}
   */
  static async searchMembers(instance, lib, spf, term) {
    /** @type {IBMi} */
    const connection = instance.getConnection();
    
    const standardOut = await connection.remoteCommand(`FNDSTRPDM STRING('${term}') FILE(${lib}/${spf}) MBR(*ALL) OPTION(*NONE) PRTMBRLIST(*YES) PRTRCDS('*ALL ' *CHAR *NOMARK *TRUNCATE)`, `.`);
      
    /** @type {string[]} */ //@ts-ignore
    const output = standardOut.split(`\n`);

    let members = [];
    let currentMember;
  
    let reading = false,
      parts = [],
      line;
    for (const index in output) {
      line = output[index];
      parts = line.split(` `).filter(x => x !== ``);
  
      switch (parts[0]) {
      case `Member`:
        currentMember = {
          name: lib + `/` + spf + `/` + parts[9],
          text: ``,
          recordLength: 0,
          lines: []
        };
        break;
      case `Type`:
        currentMember.name += `.` + parts[10].toLowerCase();
        break;
  
      case `Text`:
        currentMember.text = line.substr(26, 50).trimRight();
        break;
      case `Record`:
        if (parts[1] === `length`)
          currentMember.recordLength = Number(parts[7]) - 12;
        break;
  
      case `SEQNBR`:
        reading = true;
        break;
      case `Number`:
        if (reading) {
          members.push(currentMember);
          reading = false;
        }
        break;
  
      default:
        if (reading) {
          currentMember.lines.push({
            number: Number(line.substring(4, 10)),
            content: line.substr(12, 100).trimRight()
          })
        }
  
      }
    }
  
    return members;
  }

  /**
   * 
   * @param {*} instance 
   * @param {string} path 
   * @param {string} term 
   * @returns {Promise<{name: string, lines: {number: string, content: string}[]}[]>}
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
            name: parts[0],
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
}