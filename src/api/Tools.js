module.exports = class {
  /**
   * Parse standard out for `/usr/bin/db2`
   * @param {string} output
   */
  static db2Parse(output) {
    let gotHeaders = false;
    let figuredLengths = false;
    let iiErrorMessage = false;

    let data = output.split(`\n`);

    /** @type {{name: string, from: number, length: number}[]} */
    let headers;

    let SQLSTATE;

    let rows = [];

    data.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 && iiErrorMessage) iiErrorMessage = false;
      if (trimmed.length === 0 || index === data.length - 1) return;
      if (trimmed === `DB2>`) return;
      if (trimmed === `?>`) return;

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
        return;
      }

      if (iiErrorMessage) return;

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
            realValue = null; //null?
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

  /**
   * @param {string} string
   * @returns {{asp?: string, library: string, file: string, member: string, extension: string, basename: string}}
   */
  static parserMemberPath(string) {
    const result = {
      asp: undefined,
      library: undefined,
      file: undefined,
      member: undefined,
      extension: undefined,
      basename: undefined,
    };

    const validQsysName = new RegExp(`^[A-Z0-9@#$][A-Z0-9_#@$.]{0,9}$`);

    // Remove leading slash
    const path = string.startsWith(`/`) ? string.substring(1).toUpperCase().split(`/`) : string.toUpperCase().split(`/`);

    if (path.length > 0) result.basename = path[path.length - 1];
    if (path.length > 1) result.file = path[path.length - 2];
    if (path.length > 2) result.library = path[path.length - 3];
    if (path.length > 3) result.asp = path[path.length - 4];

    if (!result.library || !result.file || !result.basename) {
      throw new Error(`Invalid path: ${string}. Use format LIB/SPF/NAME.ext`);
    }
    if (result.asp && !validQsysName.test(result.asp)) {
      throw new Error(`Invalid ASP name: ${result.asp}`);
    }
    if (!validQsysName.test(result.library)) {
      throw new Error(`Invalid Library name: ${result.library}`);
    }
    if (!validQsysName.test(result.file)) {
      throw new Error(`Invalid Source File name: ${result.file}`);
    }

    if (!result.basename.includes(`.`)) {
      throw new Error(`Source Type extension is required.`);
    } else {
      result.member = result.basename.substring(0, result.basename.lastIndexOf(`.`));
      result.extension = result.basename.substring(result.basename.lastIndexOf(`.`) + 1);
    }

    if (!validQsysName.test(result.member)) {
      throw new Error(`Invalid Source Member name: ${result.member}`);
    }
    // The extension/source type has nearly the same naming rules as
    // the objects, except that a period is not allowed.  We can reuse
    // the existing RegExp because result.extension is everything after
    // the final period (so we know it won't contain a period).
    if (!validQsysName.test(result.extension)) {
      throw new Error(`Invalid Source Member Extension: ${result.extension}`);
    }

    return result;
  }

  /**
   * @param {string} Path
   * @returns {string} escapedPath
   */
  static escapePath(Path) {
    const escapedPath = Path.replace(/'|"|\$|\\| /g, function(matched){return `\\`.concat(matched)});
    return escapedPath;
  }
}