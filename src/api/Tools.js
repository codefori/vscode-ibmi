module.exports = class {
  /**
   * Parse standard out for `/usr/bin/db2`
   * @param {string} output 
   */
  static db2Parse(output) {
    let gotHeaders = false;
    let figuredLengths = false;

    let data = output.split(`\n`);

    /** @type {{name: string, from: number, length: number}[]} */
    let headers;
  
    let rows = [];
      
    data.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || index === data.length - 1) return;
      if (trimmed === `DB2>`) return;
      if (trimmed === `?>`) return;

      if (trimmed === `**** CLI ERROR *****`) {
        if (data.length > index + 3) {
          throw new Error(`${data[index + 3]} (${data[index + 1].trim()})`);
        }
        return;
      }

      if (gotHeaders === false) {
        headers = line.split(` `).filter((x) => x.length > 0).map((x) => {
          return {
            name: x,
            from: 0,
            length: 0,
          };
        });
      
        gotHeaders = true;
      } else
      if (figuredLengths === false) {
        let base = 0;
        line.split(` `).forEach((x, i) => {
          headers[i].from = base;
          headers[i].length = x.length;
      
          base += x.length + 1;
        });
      
        figuredLengths = true;
      } else {
        let row = {};
      
        headers.forEach((header) => {
          const strValue = line.substring(header.from, header.from + header.length).trimEnd();

          /** @type {string|number} */
          let realValue = strValue;
      
          // is value a number?
          if (strValue.startsWith(` `)) {
            const asNumber = Number(strValue.trim());
            if (!isNaN(asNumber)) {
              realValue = asNumber;
            }
          } else if (strValue === `-`) {
            realValue = ``; //null?
          }
                    
          row[header.name] = realValue;
        });
      
        rows.push(row);
      }
    });
      
    return rows;
  }

  static makeid() {
    let text = `O_`;
    let possible =
      `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;
  
    for (let i = 0; i < 8; i++)
      text += possible.charAt(Math.floor(Math.random() * possible.length));
  
    return text;
  }

  /**
   * Build the IFS path string to a member
   * @param {string|undefined} asp 
   * @param {string} lib 
   * @param {string} obj 
   * @param {string} mbr 
   */
  static qualifyPath(asp, lib, obj, mbr) {
    const path =
      (asp && asp.length > 0 ? `/${asp}` : ``) + `/QSYS.lib/${lib}.lib/${obj}.file/${mbr}.mbr`;
    return path;
  }
}