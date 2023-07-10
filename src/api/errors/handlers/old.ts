import { FileError } from '../../../typings';
import { formatIFS, formatName, getSourcePath } from '../handler';

export namespace OldHandler {
  class ExpansionRange {
    private _low: number;
    private _high: number;
    public fileId: number = 0;

    constructor(low: number, high: number) {
      this._low = low;
      this._high = high;
    }

    public low(value?: number) {
      if (value) {
        this._low = value;
      }
      return this._low;
    }

    public high(value?: number) {
      if (value) {
        this._high = value;
      }
      return this._high;
    }

    public afterRange(num: number): boolean {
      return num >= this._low;
    }

    public startsAfterLow(num: number): boolean {
      return num >= this._low && num <= this._high;
    }

    public inFileRange(number: number): boolean {
      return number >= this._low && number <= this._high;
    }

    public getVal() {
      return (this._high - this._low) + 1;
    }
  }

  /**
   * Returns object of files and their errors
   * @param lines file contents
   * @returns Errors object
   */
  export function parse(lines: string[]): Map<string, FileError[]> {
    const _FileIDs: Map<number, string> = new Map;
    const _Errors: Map<number, FileError[]> = new Map;
    const _Expansions: Map<number, ExpansionRange[]> = new Map;
    const _TrackCopies: boolean[] = [];
    const fileParents: number[] = []
    const ranges: ExpansionRange[] = [];

    lines.forEach(line => {
      const pieces = line.split(` `).filter(piece => piece);
      const curtype = line.substring(0, 10).trim();
      const _FileID = Number(line.substring(13, 13 + 3));
      let tempFileID = 0;

      switch (curtype) {
        case `FILEID`:
          if (!_FileIDs.has(_FileID)) {
            if (pieces[5].endsWith(`)`)) {
              _FileIDs.set(_FileID, formatName(pieces[5]));
            }
            else {
              _FileIDs.set(_FileID, formatIFS(getSourcePath(lines, _FileID)));
            }

            _Errors.set(_FileID, []);
            _Expansions.set(_FileID, []);

            //000000 check means that the current FILEID is not an include
            _TrackCopies[_FileID] = (line.substring(17, 17 + 6) != `000000`);
            ranges.push(new ExpansionRange(Number(pieces[3]), 0));
          } else {
            ranges.push(new ExpansionRange(Number(pieces[3]), 0));
          }

          fileParents.push(_FileID);
          break;

        case `FILEEND`:
          fileParents.pop();

          if (_FileID in _TrackCopies) {
            const copyRange = ranges.pop();
            if (copyRange) {
              copyRange.high(copyRange.low() + Number(pieces[3]) - 1);
              copyRange.fileId = _FileID;

              if (999 in _Expansions && fileParents.length >= 2) {
                _Expansions.get(fileParents[fileParents.length - 1])?.push(copyRange);
              }
            }
          }
          break;

        case `EXPANSION`:
          _Expansions.get(_FileID)?.push(new ExpansionRange(Number(pieces[6]), Number(pieces[7])));
          break;

        case `ERROR`:
          const sev = Number(line.substring(58, 58 + 2));
          let linenum = Number(line.substring(37, 37 + 6));
          const column = Number(line.substring(33, 33 + 3));
          const toColumn = Number(line.substring(44, 44 + 3));
          const text = line.substring(65).trim();
          const code = line.substring(48, 48 + 7).trim();
          let sqldiff = 0;

          if (!text.includes(`name or indicator SQ`) && !code.startsWith('SQL')) {
            for (const range of _Expansions.get(_FileID) || []) {
              if (range.afterRange(linenum)) {
                if (range.inFileRange(linenum)) {
                  sqldiff += range.high() - linenum;
                } else {
                  sqldiff += range.getVal();
                }
              } else if (range.inFileRange(linenum)) {
                sqldiff += range.low();
                tempFileID = range.fileId;
                break;
              }
            };

            if (sqldiff) {
              linenum -= sqldiff;
            }

            _Errors.get(tempFileID || _FileID)?.push({
              sev,
              linenum,
              column,
              toColumn,
              text,
              code
            });
          }
          break;
      }
    });

    const errorsByFiles: Map<string, FileError[]> = new Map;
    for (const [fileId, fileName] of _FileIDs.entries()) {
      const errors = _Errors.get(fileId);
      if (errors) {
        errorsByFiles.set(fileName, errors.sort((a, b) => a.linenum - b.linenum));
      }
    }

    return errorsByFiles;
  }
}
