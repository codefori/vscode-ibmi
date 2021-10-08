
let expRange = require(`./expRange`);

/**
 * Returns object of files and their errors
 * @param {string[]} lines file contents
 * @returns {{[FILE: string]: { sev: number, linenum: number, column: number, toColumn: number, text: string, code: string }[]}} Errors object
 */
module.exports = function(lines) {
  let _FileIDs = {0: []};
  let _Errors = {0: []};
  let _Expansions = {0: []};
  let _TrackCopies = {0: []};

  let fileParents = []

  let copyRange;
  let pieces = [];
  let curtype = ``;
  let _FileID;

  let ranges = [];
  let range;
  let line;
  let tempFileID;

  for (let x in lines) {
    line = lines[x];

    if (line.trim() == ``) continue;
    line = line.padEnd(150);

    pieces = arrayClean(line.split(` `), ``);
    curtype = line.substr(0, 10).trim();
    _FileID = Number(line.substr(13, 3));
    tempFileID = undefined;

    switch (curtype) {
    case `FILEID`:
      if ((_FileID in _FileIDs) === false) {
        if (pieces[5].endsWith(`)`))
          _FileIDs[_FileID] = formatName(pieces[5]);
        else
          _FileIDs[_FileID] = formatIFS(pieces[5]);

        /** @type {Error[]} */
        _Errors[_FileID] = [];
        _Expansions[_FileID] = [];

        //000000 check means that the current FILEID is not an include
        _TrackCopies[_FileID] = (line.substr(17, 6) != `000000`);
        ranges.push(new expRange(Number(pieces[3]), 0));
      } else {
        ranges.push(new expRange(Number(pieces[3]), 0));
      }

      fileParents.push(_FileID);
      break;

    case `FILEEND`:
      fileParents.pop();
        
      if (_FileID in _TrackCopies) {
        copyRange = ranges.pop();
        copyRange.high(copyRange._low + Number(pieces[3]) - 1);
        copyRange.file = _FileID;

        if (999 in _Expansions)
          if (fileParents.length >= 2)
            _Expansions[fileParents[fileParents.length-1]].push(copyRange);
      }
      break;

    case `EXPANSION`:
      _Expansions[_FileID].push(new expRange(Number(pieces[6]), Number(pieces[7])));
      break;
        
    case `ERROR`:
      let sev = Number(line.substr(58, 2));
      let linenum = Number(line.substr(37, 6));
      let column = Number(line.substr(33, 3));
      let toColumn = Number(line.substr(44, 3)) ;
      let text = line.substr(65).trim();
      let code = line.substr(48, 7).trim();
      let  sqldiff = 0;

      if (!text.includes(`name or indicator SQ`)) {
        if (!code.startsWith(`SQL`)) {
          for (let key in _Expansions[_FileID]) {
            range = _Expansions[_FileID][key];
            if (range.afterRange(linenum)) {
              if (range.inFileRange(linenum)) {
                sqldiff += range.high() - linenum;
              } else {
                sqldiff += range.getVal();
              }
            } else if (range.inFileRange(linenum)) {
              sqldiff += range._low;
              tempFileID = range.file;
              break;
            }
          }
        }

        if (sqldiff > 0) {
          linenum -= sqldiff;
        }

        _Errors[tempFileID || _FileID].push({
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
  }

  let results = {};

  for (_FileID in _FileIDs) {
    if (_FileID in _Errors) {
      if (_Errors[_FileID].length > 0) {
        _Errors[_FileID].sort(function(a, b) {return (a.linenum < b.linenum ? -1 : 1)});
        results[_FileIDs[_FileID]] = _Errors[_FileID];
      }
    }
  }

  /** @ts-ignore */
  return results;
}

function arrayClean(array, deleteValue) {
  for (let i = 0; i < array.length; i++) {
    if (array[i] == deleteValue) {
      array.splice(i, 1);
      i--;
    }
  }

  return array;
};

function formatName(input) {
  let pieces = input.split(`/`);
  let path = pieces[1].substr(pieces[1], pieces[1].length-1).split(`(`);

  return [pieces[0], path[0], path[1]].join(`/`)
}

function formatIFS(path) {
  const pieces = path.split(`/`);
  const newPath = pieces.filter(x => x !== `.`);

  return newPath.join(`/`);
}