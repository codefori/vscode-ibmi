"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tools = void 0;
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
var Tools;
(function (Tools) {
    class SqlError extends Error {
        sqlstate = "0";
        constructor(message) {
            super(message);
        }
    }
    Tools.SqlError = SqlError;
    /**
     * Parse standard out for `/usr/bin/db2`
     * @param output /usr/bin/db2's output
     * @returns rows
     */
    function db2Parse(output, input) {
        let gotHeaders = false;
        let figuredLengths = false;
        let iiErrorMessage = false;
        const data = output.split(`\n`).filter(line => {
            const trimmed = line.trim();
            return trimmed !== `DB2>` &&
                !trimmed.startsWith(`DB20`) && // Notice messages
                !/COMMAND .+ COMPLETED WITH EXIT STATUS \d+/.test(trimmed) && // @CL command execution output
                trimmed !== `?>`;
        });
        if (!data[data.length - 1]) {
            data.pop();
        }
        let headers;
        let SQLSTATE;
        const rows = [];
        data.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.length === 0 && iiErrorMessage)
                iiErrorMessage = false;
            if (trimmed.length === 0 || index === data.length - 1)
                return;
            if (trimmed === `**** CLI ERROR *****`) {
                iiErrorMessage = true;
                if (data.length > index + 3) {
                    SQLSTATE = data[index + 1].trim();
                    if (SQLSTATE.includes(`:`)) {
                        SQLSTATE = SQLSTATE.split(`:`)[1].trim();
                    }
                    if (!SQLSTATE.startsWith(`01`)) {
                        const errorMessage = data[index + 3] ? data[index + 3].trim() : `Unknown error`;
                        let sqlError = new SqlError(`${errorMessage} (${SQLSTATE})`);
                        sqlError.sqlstate = SQLSTATE;
                        sqlError.cause = input;
                        throw sqlError;
                    }
                }
                return;
            }
            if (iiErrorMessage)
                return;
            if (gotHeaders === false) {
                headers = line.split(` `)
                    .filter(header => header.length > 0)
                    .map(header => {
                    return {
                        name: header,
                        from: 0,
                        length: 0,
                    };
                });
                gotHeaders = true;
            }
            else if (figuredLengths === false) {
                let base = 0;
                line.split(` `).forEach((header, index) => {
                    headers[index].from = base;
                    headers[index].length = header.length;
                    base += header.length + 1;
                });
                figuredLengths = true;
            }
            else {
                let row = {};
                let slideBytesBy = 0;
                headers.forEach(header => {
                    const fromPos = header.from - slideBytesBy;
                    let strValue = line.substring(fromPos, fromPos + header.length);
                    /* For each DBCS character, add 1
                    Since we are reading characters as UTF8 here, we assume any UTF8 character made up of more than 2 bytes is DBCS
          
                    https://stackoverflow.com/a/14495321/4763757
          
                    Look at a list of Unicode blocks and their code point ranges, e.g.
                    the browsable http://www.fileformat.info/info/unicode/block/index.htm or
                    the official http://www.unicode.org/Public/UNIDATA/Blocks.txt :
          
                    Anything up to U+007F takes 1 byte: Basic Latin
                    Then up to U+07FF it takes 2 bytes: Greek, Arabic, Cyrillic, Hebrew, etc
                    Then up to U+FFFF it takes 3 bytes: Chinese, Japanese, Korean, Devanagari, etc
                    Beyond that it takes 4 bytes
          
                    */
                    // 65533 = � (not a double byte character!)
                    const extendedBytes = strValue.split(``).map(c => (Buffer.byteLength(c) < 3 || c.charCodeAt(0) === 65533) ? 0 : 1).reduce((a, b) => a + b, 0);
                    slideBytesBy += extendedBytes;
                    if (extendedBytes > 0) {
                        strValue = strValue.substring(0, strValue.length - extendedBytes);
                    }
                    let realValue = strValue.trimEnd();
                    // is value a number?
                    if (realValue.startsWith(` `)) {
                        const asNumber = Number(strValue.trim());
                        if (!isNaN(asNumber)) {
                            realValue = asNumber;
                        }
                    }
                    else if (realValue === `-`) {
                        realValue = null; //null?
                    }
                    row[header.name] = realValue;
                });
                rows.push(row);
            }
        });
        return rows;
    }
    Tools.db2Parse = db2Parse;
    function bufferToUx(input) {
        const hexString = Array.from(input)
            .map(char => char.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase())
            .join('');
        return `UX'${hexString}'`;
    }
    Tools.bufferToUx = bufferToUx;
    function makeid(length = 8) {
        let text = `O_`;
        const possible = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`;
        for (let i = 0; i < length; i++)
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        return text;
    }
    Tools.makeid = makeid;
    /**
     * Build the IFS path string to an object or member
     * @param library
     * @param object
     * @param member Optional
     * @param iasp Optional: an iASP name
     */
    function qualifyPath(library, object, member, iasp, noEscape) {
        [library, object] = Tools.sanitizeObjNamesForPase([library, object]);
        member = member ? Tools.sanitizeObjNamesForPase([member])[0] : undefined;
        iasp = iasp ? Tools.sanitizeObjNamesForPase([iasp])[0] : undefined;
        const libraryPath = library === `QSYS` ? `QSYS.LIB` : `QSYS.LIB/${library}.LIB`;
        const filePath = object ? `${object}.FILE` : '';
        const memberPath = member ? `/${member}.MBR` : '';
        const fullPath = `${libraryPath}/${filePath}${memberPath}`;
        const result = (iasp && iasp.length > 0 ? `/${iasp}` : ``) + `/${noEscape ? fullPath : Tools.escapePath(fullPath)}`;
        return result;
    }
    Tools.qualifyPath = qualifyPath;
    /**
     * Unqualify member path from root
     */
    function unqualifyPath(memberPath) {
        const pathInfo = path_1.default.posix.parse(memberPath);
        let splitPath = pathInfo.dir.split(path_1.default.posix.sep);
        // Remove use of `QSYS.LIB` two libraries in the path aren't value
        const isInQsys = splitPath.filter(part => part.endsWith(`.LIB`)).length === 2;
        if (isInQsys) {
            splitPath = splitPath.filter(part => part !== `QSYS.LIB`);
        }
        const correctedDir = splitPath.map(part => {
            const partInfo = path_1.default.posix.parse(part);
            if ([`.FILE`, `.LIB`].includes(partInfo.ext)) {
                return partInfo.name;
            }
            else {
                return part;
            }
        })
            .join(path_1.default.posix.sep);
        return path_1.default.posix.join(correctedDir, pathInfo.base);
    }
    Tools.unqualifyPath = unqualifyPath;
    /**
     * @param Path
     * @returns the escaped path
     */
    function escapePath(Path, alreadyQuoted = false) {
        if (alreadyQuoted) {
            return Path.replace(/"|\$|\\/g, matched => `\\`.concat(matched));
        }
        else {
            return Path.replace(/'|"|\$|&|\\| /g, matched => `\\`.concat(matched));
        }
    }
    Tools.escapePath = escapePath;
    function distinct(value, index, array) {
        return array.indexOf(value) === index;
    }
    Tools.distinct = distinct;
    function capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1);
    }
    Tools.capitalize = capitalize;
    function sanitizeObjNamesForPase(libraries) {
        return libraries
            .map(library => {
            // Quote libraries starting with #
            return library.startsWith(`#`) ? `"${library}"` : library;
        });
    }
    Tools.sanitizeObjNamesForPase = sanitizeObjNamesForPase;
    function parseMessages(output) {
        const messages = output.split("\n").map(line => ({
            id: line.substring(0, line.indexOf(':')).trim(),
            text: line.substring(line.indexOf(':') + 1).trim()
        }));
        return {
            messages,
            findId: id => messages.find(m => m.id === id)
        };
    }
    Tools.parseMessages = parseMessages;
    function parseQSysPath(path) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length > 3) {
            return {
                asp: parts[0],
                library: parts[1],
                name: parts[2]
            };
        }
        else {
            return {
                library: parts[0],
                name: parts[1]
            };
        }
    }
    Tools.parseQSysPath = parseQSysPath;
    /**
     * Fixes an SQL statement to make it compatible with db2 CLI program QZDFMDB2.
     * - Changes `@clCommand` statements into Call `QSYS2.QCMDEX('clCommand')` procedure calls
     * - Makes sure each comment (`--`) starts on a new line
     * @param statement the statement to fix
     * @returns statement compatible with QZDFMDB2
     */
    function fixSQL(statement, removeComments = false) {
        let statements = statement.split("\n").map(line => {
            if (line.startsWith('@')) {
                //- Escape all '
                //- Remove any trailing ;
                //- Put the command in a Call QSYS2.QCMDEXC statement
                line = `Call QSYS2.QCMDEXC('${line.substring(1, line.endsWith(";") ? line.length - 1 : undefined).replaceAll("'", "''")}');`;
            }
            //Make each comment start on a new line
            return line.replaceAll("--", "\n--");
        }).join(`\n`);
        if (removeComments) {
            statements = statements.split(`\n`).filter(l => !l.trim().startsWith(`--`)).join(`\n`);
        }
        return statements;
    }
    Tools.fixSQL = fixSQL;
    function fileToPath(file) {
        if (typeof file === "string") {
            return Tools.fixWindowsPath(file);
        }
        else {
            return file.fsPath;
        }
    }
    Tools.fileToPath = fileToPath;
    function fixWindowsPath(path) {
        if (process.platform === `win32` && path[0] === `/`) {
            //Issue with getFile not working propertly on Windows
            //when there was a / at the start.
            return path.substring(1);
        }
        else {
            return path;
        }
    }
    Tools.fixWindowsPath = fixWindowsPath;
    function assumeType(str, col) {
        if (str.trim().length === 0)
            return ``;
        // If column is SRCDTA, always return as string.
        if (col === `SRCDTA`)
            return str;
        // The number is already generated on the server.
        // So, we assume that if the string starts with a 0, it is a string.
        if (/^0.+/.test(str) || str.length > 10) {
            return str;
        }
        const number = Number(str);
        if (isNaN(number)) {
            return str;
        }
        return number;
    }
    Tools.assumeType = assumeType;
    /**
     * Converts a timestamp from the attr command (in the form `Thu Dec 21 21:47:02 2023`) into a Date object
     * @param timestamp an attr timestamp string
     * @returns a Date object
     */
    function parseAttrDate(timestamp) {
        const parts = /^([\w]{3}) ([\w]{3}) +([\d]+) ([\d]+:[\d]+:[\d]+) ([\d]+)$/.exec(timestamp);
        if (parts) {
            return Date.parse(`${parts[3].padStart(2, "0")} ${parts[2]} ${parts[5]} ${parts[4]} GMT`);
        }
        return 0;
    }
    Tools.parseAttrDate = parseAttrDate;
    /**
     * Transforms a file path into an OS agnostic path.
     * - Replaces full home directory path by ~
     * - Replaces all \ into / on Windows
     *
     * @param filePath
     * @returns
     */
    function normalizePath(filePath) {
        //Test path in lowercase since os.homedir doesn't always has the same case as filePath on Windows
        if (filePath.toLowerCase().startsWith(os_1.default.homedir().toLowerCase())) {
            filePath = path_1.default.join(`~`, filePath.substring(os_1.default.homedir().length));
        }
        return process.platform === "win32" ? filePath.replaceAll('\\', '/') : filePath;
    }
    Tools.normalizePath = normalizePath;
    /**
     * Transforms a normalized path into an OS specific path.
     * - Replaces ~ with the current home directory
     * - Changes all / to \ on Windows
     * @param path
     * @returns
     */
    function resolvePath(path) {
        path = path.replace("~", os_1.default.homedir());
        return process.platform === "win32" ? path.replaceAll('/', '\\') : path;
    }
    Tools.resolvePath = resolvePath;
})(Tools = exports.Tools || (exports.Tools = {}));
//# sourceMappingURL=Tools.js.map