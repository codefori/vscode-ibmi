interface ILEError {
  sev: number;
  linenum: number;
  column: number;
  toColumn: number;
  text: string;
  code: string;
  postExpansion?: boolean;
}

interface SourceExpansion {
  on: number,
  defined: {start: number, end: number};
  range: {start: number, end: number}
}

interface ILEErrorFile {
  id: number;
  parent?: number;
  startsAt: number;
  length?: number;
  path: string;
  errors: ILEError[];
  expansions: SourceExpansion[]
}

interface Processor {
  files: ILEErrorFile[]
}