import { FileError } from "../../typings";
import { GlobalConfiguration } from "../Configuration";
import { NewHandler } from "./handlers/new";
import { OldHandler } from "./handlers/old";

export enum RecordType {
  TIMESTAMP = 'TIMESTAMP',
  PROCESSOR = 'PROCESSOR',
  FILE_ID = 'FILEID',
  FILE_ID_CONT = 'FILEIDCONT',
  FILE_END = 'FILEEND',
  ERROR_INFORMATION = 'ERROR',
  EXPANSION = 'EXPANSION',
  PROGRAM = 'PROGRAM',
  MAP_DEFINE = 'MAPDEFINE',
  MAP_START = 'MAPSTART',
  MAP_END = 'MAPEND',
  FEEDBACK_CODE = 'FEEDBACK'
};

export interface FileId {
  version: number,
  sourceId: number,
  line: number,
  length: number,
  filename: string,
  sourcefileTimestamp: number,
  tempFlag: number
}

const FILEID_RECORD_MAX_FILE_NAME_LENGTH = 255;

export function formatName(input: string) {
  let pieces = input.split(`/`);
  let path = pieces[1].substring(0, pieces[1].length - 1).split(`(`);

  return [pieces[0], path[0], path[1]].join(`/`)
}

export function formatIFS(path: string) {
  const pieces = path.split(`/`);
  const newPath = pieces.filter(x => x !== `.`);

  return newPath.join(`/`);
}

export function parseErrors(lines: string[]): Map<string, FileError[]> {
  const useNewHandler = GlobalConfiguration.get(`tryNewErrorParser`);
  const expandedErrors = lines.some(line => line.includes(`EXPANSION`));

  //Skip empty lines and right pad up to 150
  const paddedLines = lines.filter(line => line.trim()).map(line => line.padEnd(150));
  if (useNewHandler && expandedErrors) {
    return NewHandler.parse(paddedLines);
  } else {
    return OldHandler.parse(paddedLines);
  }
}

export function getLinesByRecodType(lines: string[], recordType: RecordType, sourceFileId?: number): string[] {
  if (sourceFileId === undefined) {
    return lines.filter(line => line.split(/\s+/, 1)[0] == recordType);
  }

  return lines.filter(line => {
    const recordFields = line.split(/\s+/, 3);
    return recordFields[0] == recordType &&
      parseInt(recordFields[2]) == sourceFileId
  });
};

export function getSourcePath(lines: string[], fileId: number): string {

  const fileIdLine: string = getLinesByRecodType(lines, RecordType.FILE_ID, fileId)[0];
  const recordFields: string[] = fileIdLine.split(/\s+/, 5);

  let fileIdRecord: FileId = {
    version: parseInt(recordFields[1]),
    sourceId: parseInt(recordFields[2]),
    line: parseInt(recordFields[3]),
    length: parseInt(recordFields[4]),
    filename: "",
    sourcefileTimestamp: 0,
    tempFlag: 0
  }

  // The file name field of the FILEID record contains the complete source path, 
  // this field allows a maximunm of 255 chars, so if the path length is grater 
  // than this then the FILEID record is followed by one or more FILEIDCONT 
  // records. To get the complete sourte path is necesary use the file length 
  // field of the FILEID record.
  if (fileIdRecord.length <= FILEID_RECORD_MAX_FILE_NAME_LENGTH) {
    fileIdRecord.filename = fileIdLine.substring(28, 28 + fileIdRecord.length);
    fileIdRecord.sourcefileTimestamp = parseInt(fileIdLine.trim().slice(-17, -1));
    fileIdRecord.tempFlag = parseInt(fileIdLine.trim().slice(-1));
  } else {

    // get the first part of the source file path. Take an amount of characters
    // equals to the maximun length allowed.
    fileIdRecord.filename = fileIdLine.substring(28, 28 + FILEID_RECORD_MAX_FILE_NAME_LENGTH);

    // get all FILEIDCONT records realated to the specific file using the file identifier
    const fileIdContLines: string[] = getLinesByRecodType(lines, RecordType.FILE_ID_CONT, fileId);

    // how many characters we need to read from each FILEIDCONT record.   
    let charsQtyToRead: number = fileIdRecord.length;

    // put together the content of all the FILEIDCONT records
    fileIdContLines.forEach(fileIdContLine => {
      // subtract from the file lenght field the max length of the path that 
      // is allowed per record, this tell us how many characters we need to get
      // from this line, if the qty is lower than the max allowed then get all 
      // of then if not get a new chunk with a length equal to the max allowed.
      charsQtyToRead -= FILEID_RECORD_MAX_FILE_NAME_LENGTH;
      if (charsQtyToRead <= FILEID_RECORD_MAX_FILE_NAME_LENGTH) {
        fileIdRecord.filename += fileIdContLine.substring(28, 28 + charsQtyToRead);
      } else {
        fileIdRecord.filename += fileIdContLine.substring(28, 28 + FILEID_RECORD_MAX_FILE_NAME_LENGTH);
      }

    });

    fileIdRecord.sourcefileTimestamp = parseInt(fileIdContLines[fileIdContLines.length - 1].trim().slice(-17, -1));
    fileIdRecord.tempFlag = parseInt(fileIdContLines[fileIdContLines.length - 1].trim().slice(-1));

  }

  return fileIdRecord.filename;
}
