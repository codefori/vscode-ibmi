
export function db2Parse(output: string) {
  let gotHeaders = false;
  let figuredLengths = false;
  let iiErrorMessage = false;
  
  let data = output.split(`\n`);
  
  let headers: {name: string, from: number, length: number}[] = [];
  
  let SQLSTATE;
  
  let rows: {[column: string]: string|number|null}[] = [];
  
  data.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 && iiErrorMessage) {iiErrorMessage = false;}
    if (trimmed.length === 0 || index === data.length - 1) {return;};
    if (trimmed === `DB2>`) {return;};
    if (trimmed.startsWith(`DB20`)) {return;}; // Notice messages
    if (trimmed === `?>`) {return;};
  
    if (trimmed === `**** CLI ERROR *****`) {
      iiErrorMessage = true;
      if (data.length > index + 3) {
        SQLSTATE = data[index + 1].trim();
  
        if (SQLSTATE.includes(`:`)) {
          SQLSTATE = SQLSTATE.split(`:`)[1].trim();
        }
  
        if (!SQLSTATE.startsWith(`01`)) {
          throw new Error(`${data[index + 3]} (${SQLSTATE})`);
        }
      }
      {return;};
    }
  
    if (iiErrorMessage) {return;};
  
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
          
      let row: {[column: string]: string|number|null} = {};
  
      headers.forEach((header) => {
        const strValue = line.substring(header.from, header.from + header.length).trimEnd();
  
        let realValue: string|number|null = strValue;
  
        // is value a number?
        if (strValue.startsWith(` `)) {
          const asNumber = Number(strValue.trim());
          if (!isNaN(asNumber)) {
            realValue = asNumber;
          }
        } else if (strValue === `-`) {
          realValue = null; //null?
        }
  
        row[header.name] = realValue;
      });
  
      rows.push(row);
    }
  });
  
  return rows;
}
  
export function makeid() {
  let text = `O_`;
  let possible =
        `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;
  
  for (let i = 0; i < 8; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  
  return text;
}
    
export function qualifyPath(asp: string|undefined, lib: string, obj: string, mbr: string) {
  const path =
        (asp && asp.length > 0 ? `/${asp}` : ``) + `/QSYS.lib/${lib}.lib/${obj}.file/${mbr}.mbr`;
  return path;
}

export function escapePath(path: string) {
  const escapedPath = path.replace(/'|"|\$|\\| /g, function(matched){return `\\`.concat(matched);});
  return escapedPath;
}