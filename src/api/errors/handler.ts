import { GlobalConfiguration } from "../Configuration";
import { NewHandler } from "./handlers/new";
import { OldHandler } from "./handlers/old";

export interface FileError {
    sev: number
    linenum: number
    column: number
    toColumn: number
    text: string
    code: string
}

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