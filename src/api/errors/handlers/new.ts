import { FileError } from '../../../typings';
import { formatIFS, formatName, getSourcePath } from '../handler';

export namespace NewHandler {
  interface ErrorWithExpansion extends FileError {
    postExpansion?: boolean
  }

  interface Expansion {
    on: number
    defined: {
      start: number
      end: number
    }
    range: {
      start: number
      end: number
    }
  }

  interface File {
    id: number
    parent?: number
    startsAt: number
    length?: number
    path: string
    errors: ErrorWithExpansion[]
    expansions: Expansion[]
  }

  interface Processor {
    files: File[]
  }

  interface GeneratedLine {
    path: string
    line: number
    isSQL?: boolean
  }

  /**
   * Returns object of files and their errors
   * @param lines file contents
   * @returns Errors object
   */
  export function parse(lines: string[]): Map<string, FileError[]> {
    const processors: Processor[] = [];
    const parentIds: number[] = [];
    const truePaths: Map<number, string> = new Map;

    let currentProcessor: Processor | undefined = undefined;
    let expanded = false;

    // =============================================
    // First, let's parse the evfevent content
    //
    // Processors -> files -> expansions & errors
    // =============================================

    lines.forEach(line => {
      const pieces = line.split(` `).filter(piece => piece);
      const curtype = line.substring(0, 10).trim();
      const _FileID = Number(line.substring(13, 13 + 3));

      let existingFile = currentProcessor?.files.find(file => file.id === _FileID);

      switch (curtype) {
        case `PROCESSOR`:
          expanded = false;
          if (currentProcessor) {
            processors.push(currentProcessor);
          }

          currentProcessor = {
            files: []
          }
          break;

        case `FILEID`:
          const validName = pieces[5].endsWith(`)`) ? formatName(pieces[5]) : formatIFS(getSourcePath(lines, _FileID ));

          if (!truePaths.has(_FileID)) {
            truePaths.set(_FileID, validName);
          }

          currentProcessor?.files.push({
            id: _FileID,
            startsAt: Number(pieces[3]) - 1,
            path: validName,
            expansions: [],
            errors: [],
            parent: parentIds.length > 0 ? parentIds[parentIds.length - 1] : undefined
          })
          parentIds.push(_FileID);
          break;

        case `FILEEND`:
          if (existingFile) {
            existingFile.length = Number(pieces[3]);
          }

          parentIds.pop();
          break;

        case `EXPANSION`:
          expanded = true;

          if (!existingFile) {
            existingFile = currentProcessor?.files[parentIds[parentIds.length - 1]];
          }

          if (existingFile) {
            existingFile.expansions.push({
              on: Number(pieces[5]),
              defined: {
                start: Number(pieces[3]) - 1,
                end: Number(pieces[4]) - 1
              },
              range: {
                start: Number(pieces[6]) - 1,
                end: Number(pieces[7]) - 1
              }
            });
          }
          break;

        case `ERROR`:
          if (existingFile)
            existingFile.errors.push({
              sev: Number(line.substring(58, 58 + 2)),
              linenum: Number(line.substring(37, 37 + 6)) - 1,
              column: Number(line.substring(33, 33 + 3)),
              toColumn: Number(line.substring(44, 44 + 3)),
              text: line.substring(65).trim(),
              code: line.substring(48, 48 + 7).trim(),
              postExpansion: expanded
            });
          break;
      }
    });

    if (currentProcessor) {
      processors.push(currentProcessor);
    }

    console.log(processors);

    // =============================================
    // Next, we build a source map of the code from the compiler 
    // We do this because the SQL precompiler error listing isn't useful to anyone.
    // *LVL2 on the SQL precompilers expands the copybooks into a single source file
    // Then we map each line number in the generated source to the original source (e.g. a source map)
    // =============================================
    const generatedLines: GeneratedLine[] = [];
    const fileErrors: Map<string, FileError[]> = new Map;

    let doneParent = false;

    processors.forEach(processor => {

      processor.files.forEach(file => {
        // =============================================
        // First step is to generate add all of the copybooks. 
        // We do this by looking at the file list in the base (parent) processor
        // since that is what expands the copybooks.
        // =============================================

        if (!doneParent) {
          if (file.id !== 999) { // Do nothing with the base
            // We need to find the true start position
            let trueStartFrom = (file.startsAt + 1);

            let currentParent = processor.files.find(x => x.id === file.parent);
            while (currentParent) {
              if (currentParent && currentParent.startsAt >= 0) {
                trueStartFrom += (currentParent.startsAt + 1);
                currentParent = processor.files.find(x => x.id === currentParent?.parent);
              } else {
                break;
              }
            };

            generatedLines.splice(trueStartFrom, 0,
              ...Array(file.length).fill({})
                .map((x, i) => ({
                  path: file.path,
                  line: i + 1
                } as GeneratedLine))
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

            if (foundError && !foundError.isSQL) {
              addError(fileErrors, foundError.path, error, foundError.line);
            }
          } else {
            const truePath = truePaths.get(file.id);
            if (truePath) {
              addError(fileErrors, truePath, error, error.linenum + 1);
            }
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

          if (foundError && !foundError.isSQL) {
            addError(fileErrors, foundError.path, error, foundError.line);
          }
        });
      });

      doneParent = true;

    });

    console.log({ generatedLines, lines });

    return fileErrors;
  }

  function addError(errorsMap: Map<string, FileError[]>, file: string, error: ErrorWithExpansion, line: number) {
    if (!errorsMap.has(file)) {
      errorsMap.set(file, []);
    }

    errorsMap.get(file)!.push({
      ...error,
      linenum: line
    });
  }
}
