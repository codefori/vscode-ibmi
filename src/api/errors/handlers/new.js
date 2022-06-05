
const {
  formatName,
  formatIFS
} = require(`../format`);

/**
 * Returns object of files and their errors
 * @param {string[]} lines file contents
 * @returns {{[FILE: string]: { sev: number, linenum: number, column: number, toColumn: number, text: string, code: string }[]}} Errors object
 */
module.exports = function getErrors(lines) {
  /** @type {{files: {id: number, parent?: number, startsAt: number, length?: number, path: string, errors: {sev: number, line: number, column: {start, end}, text: string, code: string, postExpansion?: boolean}[], expansions: {on: number, defined: {start, end}, range: {start, end}}[]}[]}[]} */
  let processors = [];

  let pieces = [];
  let curtype = ``;
  let _FileID;

  let line;
  let tempFileID;

  let currentProcessor;
  let existingFile;
  let parentIds = [];
  let expanded = false;

  /** @type {{[id: number]: string}} */
  let truePaths = {};

  // =============================================
  // First, let's parse the evfevent content
  //
  // Processors -> files -> expansions & errors
  // =============================================

  for (let x in lines) {
    line = lines[x];

    if (line.trim() == ``) continue;
    line = line.padEnd(150);

    pieces = line.split(` `).filter(x => x !== ``);
    curtype = line.substring(0, 10).trim();
    _FileID = Number(line.substring(13, 13+3));
    tempFileID = _FileID;

    switch (curtype) {
    case `PROCESSOR`:
      expanded = false;
      if (currentProcessor) processors.push(currentProcessor);

      currentProcessor = {
        files: []
      }
      break;

    case `FILEID`:
      let validName = pieces[5].endsWith(`)`) ? formatName(pieces[5]) : formatIFS(pieces[5]);

      if (!truePaths[_FileID]) 
        truePaths[_FileID] = validName;

      currentProcessor.files.push({
        id: _FileID,
        startsAt: Number(pieces[3])-1,
        path: validName,
        expansions: [],
        errors: [],
        parent: parentIds.length > 0 ? parentIds[parentIds.length - 1] : undefined
      })
      parentIds.push(_FileID);
      break;

    case `FILEEND`:
      existingFile = currentProcessor.files.find(x => x.id === _FileID);
      if (existingFile)
        existingFile.length = Number(pieces[3]);

      parentIds.pop();
      break;

    case `EXPANSION`:
      expanded = true;
      existingFile = currentProcessor.files.find(x => x.id === _FileID);

      if (!existingFile) {
        existingFile = currentProcessor.files[parentIds[parentIds.length - 1]];
      }

      if (existingFile) {
        existingFile.expansions.push({
          on: Number(pieces[5]),
          defined: {
            start: Number(pieces[3])-1,
            end: Number(pieces[4])-1
          },
          range: {
            start: Number(pieces[6])-1,
            end: Number(pieces[7])-1
          }
        });
      }
      break;

    case `ERROR`:
      let sev = Number(line.substring(58, 58+2));
      let linenum = Number(line.substring(37, 37+6))-1;
      let column = Number(line.substring(33, 33+3));
      let toColumn = Number(line.substring(44, 44+3));
      let text = line.substring(65).trim();
      let code = line.substring(48, 48+7).trim();

      existingFile = currentProcessor.files.find(x => x.id === _FileID);
      if (existingFile)
        existingFile.errors.push({
          sev,
          line: linenum,
          column: {
            start: column,
            end: toColumn
          },
          text,
          code,
          postExpansion: expanded
        });
      break;
    }
  }

  if (currentProcessor) processors.push(currentProcessor);

  console.log(processors);

  // =============================================
  // Next, we build a source map of the code from the compiler 
  // We do this because the SQL precompiler error listing isn't useful to anyone.
  // *LVL2 on the SQL precompilers expands the copybooks into a single source file
  // Then we map each line number in the generated source to the original source (e.g. a source map)
  // =============================================

  /** @type {{path?: string, line?: number, isSQL?: boolean}[]} */
  let generatedLines = [];

  /** @type {{[path: string]: object}} */
  let fileErrors = {};

  let doneParent = false;

  processors.forEach((processor, index) => {
    
    processor.files.forEach((file) => {

      // =============================================
      // First step is to generate add all of the copybooks. 
      // We do this by looking at the file list in the base (parent) processor
      // since that is what expands the copybooks.
      // =============================================

      if (!doneParent) {
        if (file.id === 999) {
        // Do nothing with the base          
        } else {
        // We need to find the true start position
          let trueStartFrom = (file.startsAt+1);

          let currentParent = processor.files.find(x => x.id === file.parent);
          while (currentParent) {
            if (currentParent && currentParent.startsAt >= 0) {
              trueStartFrom += (currentParent.startsAt+1);
              currentParent = processor.files.find(x => x.id === currentParent.parent);
            } else {
              break;
            }
          };

          generatedLines.splice(trueStartFrom, 0, 
            ...Array(file.length).fill({})
              .map((x, i) => ({
                path: file.path,
                line: i + 1
              })
              )
          );
        }
      }
      

      // =============================================
      // Next, we add the errors from the file that are listed BEFORE any precompiler expansions
      //
      // We have two handles here. The first is the generated lines, which is the source map.
      // The second is the errors, which is the normal error list for when *LVL1 is used, or a regular compiler
      // =============================================

      file.errors.filter(err => err.postExpansion !== true).forEach(error => {

        if (processor.files.length === 1 || file.id === 1) {
          let foundError = generatedLines[error.line];

          if (foundError && foundError.isSQL !== true) {
            if (!fileErrors[foundError.path]) fileErrors[foundError.path] = [];
            fileErrors[foundError.path].push({
              sev: error.sev,
              linenum: foundError.line,
              column: error.column.start,
              toColumn: error.column.end,
              text: error.text,
              code: error.code
            });
          }
        } else {
          let truePath = truePaths[file.id];
          if (!fileErrors[truePath]) fileErrors[truePath] = [];
          fileErrors[truePath].push({
            sev: error.sev,
            linenum: error.line+1,
            column: error.column.start,
            toColumn: error.column.end,
            text: error.text,
            code: error.code
          });
        }
      });
    });

    // =============================================
    // Next, we add the expansions from the precompiler
    //
    // The expansions are mighty complex. Not only can they add lines, they can also remove lines.
    // =============================================

    processor.files.forEach((file) => {
      if (file.expansions.length > 0) {
        file.expansions.forEach(expansion => {
          // To add:
          if (expansion.range.start >= 0 && expansion.range.end >= 0) {
            const toFile = processor.files.find(x => x.id === expansion.on);
            if (toFile) {
              generatedLines.splice(toFile.startsAt + expansion.range.start + 1, 0, 
                ...Array(expansion.range.end - expansion.range.start + 1).fill({})
                  .map((x, i) => ({
                    path: toFile.path,
                    line: i + 1,
                    isSQL: true
                  })
                  )
              );
            }
          } else

          // To remove:
          if (expansion.defined.start >= 0 && expansion.defined.end >= 0) {
            generatedLines.splice(file.startsAt + expansion.defined.start + 1, expansion.defined.end - expansion.defined.start + 1);
          }
        });
      }

      // =============================================
      // Finally, we add the errors from the file that are listed AFTER any precompiler expansions
      // =============================================

      file.errors.filter(err => err.postExpansion === true).forEach(error => {
        let foundError = generatedLines[error.line];
  
        if (foundError && foundError.isSQL !== true) {
          if (!fileErrors[foundError.path]) fileErrors[foundError.path] = [];
          fileErrors[foundError.path].push({
            sev: error.sev,
            linenum: foundError.line,
            column: error.column.start,
            toColumn: error.column.end,
            text: error.text,
            code: error.code
          });
        }
      });
    });

    doneParent = true;

  });

  console.log({generatedLines, lines});

  /** @ts-ignore */
  return fileErrors;
}