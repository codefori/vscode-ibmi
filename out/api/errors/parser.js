"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseErrors = void 0;
const ibmi_eventf_parser_1 = require("@ibm/ibmi-eventf-parser");
class EvfEventFileReader {
    lines;
    index = 0;
    constructor(lines) {
        this.lines = lines;
    }
    readNextLine() {
        const line = this.lines[this.index];
        if (line) {
            this.index++;
        }
        return line;
    }
}
function formatName(input) {
    let pieces = input.split(`/`);
    let path = pieces[1].substring(0, pieces[1].length - 1).split(`(`);
    return [pieces[0], path[0], path[1]].join(`/`);
}
function parseErrors(lines) {
    const evfEventFileReader = new EvfEventFileReader(lines);
    const parser = new ibmi_eventf_parser_1.Parser();
    parser.parse(evfEventFileReader);
    const errors = parser.getAllErrors();
    const fileErrors = new Map;
    errors.forEach(error => {
        let fileName = error.getFileName();
        fileName = fileName.endsWith(`)`) ? formatName(fileName) : fileName;
        if (!fileErrors.has(fileName)) {
            fileErrors.set(fileName, []);
        }
        const text = error.getMsg();
        const code = error.getMsgId();
        const sev = error.getSevNum();
        if (!(text.includes(`name or indicator SQ`) && code.startsWith('RNF') && sev === 0)) {
            fileErrors.get(fileName).push({
                sev: sev,
                lineNum: error.getStartErrLine(),
                toLineNum: error.getEndErrLine(),
                column: error.getTokenStart(),
                toColumn: error.getTokenEnd(),
                text: text,
                code: code
            });
        }
    });
    return fileErrors;
}
exports.parseErrors = parseErrors;
//# sourceMappingURL=parser.js.map