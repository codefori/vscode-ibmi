
const {
  formatName,
  formatIFS
} = require(`../format`);

/**
 * Returns object of files and their errors
 * @param {string[]} lines file contents
 * @returns {{[FILE: string]: ILEError[]}} Errors object
 */
module.exports = function getErrors(lines: string[]) {
  /** @type {Processor[]} */
  let processors = [];

  let pieces: string[] = [];
  let curtype: string = ``;
  let currentFileID: number;

  let line: string;
  let tempFileID: number;

  let currentProcessor: Processor|undefined;
  let existingFile: ILEErrorFile|undefined;
  let parentIds = [];
  let expanded = false;

  let truePaths: {[id: number]: string} = {};

  // =============================================
  // First, let's parse the evfevent content
  //
  // Processors -> files -> expansions & errors
  // =============================================

  for (let x in lines) {
    line = lines[x];

    if (line.trim() === ``) {
      continue;
    }
    line = line.padEnd(150);

    pieces = line.split(` `).filter(x => x !== ``);
    curtype = line.substring(0, 10).trim();
    currentFileID = Number(line.substring(13, 13+3));
    tempFileID = currentFileID;

    switch (curtype) {
    case `PROCESSOR`:
      expanded = false;
      if (currentProcessor) {
        processors.push(currentProcessor);
      }

      currentProcessor = {
        files: []
      };
      break;

    case `FILEID`:
      let validName = pieces[5].endsWith(`)`) ? formatName(pieces[5]) : formatIFS(pieces[5]);

      if (!truePaths[currentFileID]) {
        truePaths[currentFileID] = validName;
      }

      if (currentProcessor) {
        currentProcessor.files.push({
          id: currentFileID,
          startsAt: Number(pieces[3])-1,
          path: validName,
          expansions: [],
          errors: [],
          parent: parentIds.length > 0 ? parentIds[parentIds.length - 1] : undefined
        });
        parentIds.push(currentFileID);
      }
      break;

    case `FILEEND`:
      if (currentProcessor) {
        existingFile = currentProcessor.files.find(x => x.id === currentFileID);
        if (existingFile) {
          existingFile.length = Number(pieces[3]);
        }

        parentIds.pop();
      }
      break;

    case `EXPANSION`:
      expanded = true;
      if (currentProcessor) {
        existingFile = currentProcessor.files.find(x => x.id === currentFileID);

        if (!existingFile) {
          existingFile = currentProcessor.files[parentIds[parentIds.length - 1]];
        }
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

      if (currentProcessor) {
        existingFile = currentProcessor.files.find(x => x.id === currentFileID);
        if (existingFile)
        {existingFile.errors.push({
          sev,
          linenum,
          column,
          toColumn,
          text,
          code,
          postExpansion: expanded
        });}
      }
      break;
    }
  }

  if (currentProcessor) {processors.push(currentProcessor);}

  console.log(processors);

  // =============================================
  // Next, we build a source map of the code from the compiler 
  // We do this because the SQL precompiler error listing isn't useful to anyone.
  // *LVL2 on the SQL precompilers expands the copybooks into a single source file
  // Then we map each line number in the generated source to the original source (e.g. a source map)
  // =============================================

  let generatedLines: {path: string, line: number, isSQL?: boolean}[] = [];

  /** @type {} */
  let fileErrors: {[path: string]: ILEError[]} = {};

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
              // @ts-ignore No idea why it's complaining
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
          let foundError = generatedLines[error.linenum];

          if (foundError && foundError.isSQL !== true) {
            if (!fileErrors[foundError.path]) {fileErrors[foundError.path] = [];}
            fileErrors[foundError.path].push({
              sev: error.sev,
              linenum: foundError.line,
              column: error.column,
              toColumn: error.toColumn,
              text: error.text,
              code: error.code
            });
          }
        } else {
          let truePath = truePaths[file.id];
          if (!fileErrors[truePath]) {fileErrors[truePath] = [];}
          fileErrors[truePath].push({
            sev: error.sev,
            linenum: error.linenum+1,
            column: error.column,
            toColumn: error.toColumn,
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
        let foundError = generatedLines[error.linenum];
  
        if (foundError && foundError.isSQL !== true) {
          if (!fileErrors[foundError.path]) {fileErrors[foundError.path] = [];}
          fileErrors[foundError.path].push({
            sev: error.sev,
            linenum: foundError.line,
            column: error.column,
            toColumn: error.toColumn,
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
};