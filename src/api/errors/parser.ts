import { Parser, ISequentialFileReader } from "@ibm/ibmi-eventf-parser";
import { FileError } from "../../typings";

class EvfEventFileReader implements ISequentialFileReader {
  lines: string[];
  index = 0;

  constructor(lines: string[]) {
    this.lines = lines;
  }

  readNextLine(): string | undefined {
    const line = this.lines[this.index];
    if (line) {
      this.index++;
    }

    return line;
  }
}

function formatName(input: string) {
  let pieces = input.split(`/`);
  let path = pieces[1].substring(0, pieces[1].length - 1).split(`(`);

  return [pieces[0], path[0], path[1]].join(`/`)
}

export function parseErrors(lines: string[]): Map<string, FileError[]> {
  const evfEventFileReader = new EvfEventFileReader(lines);

  const parser = new Parser();
  parser.parse(evfEventFileReader);
  const errors = parser.getAllErrors();

  const fileErrors: Map<string, FileError[]> = new Map;
  errors.forEach(error => {
    let fileName = error.getFileName();
    fileName = fileName.endsWith(`)`) ? formatName(fileName) : fileName;

    if (!fileErrors.has(fileName)) {
      fileErrors.set(fileName, []);
    }

    if (!(error.getMsg().includes(`name or indicator SQ`) && error.getMsgId().startsWith('SQL'))) {
      fileErrors.get(fileName)!.push({
        sev: error.getSevNum(),
        lineNum: error.getStartErrLine(),
        toLineNum: error.getEndErrLine(),
        column: error.getTokenStart(),
        toColumn: error.getTokenEnd(),
        text: error.getMsg(),
        code: error.getMsgId()
      });
    }
  });

  return fileErrors;
}