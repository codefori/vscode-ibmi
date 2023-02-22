import { stringify, parse, ParsedUrlQueryInput } from "querystring";
import vscode from "vscode";
import { instance } from "../../instantiate";
import { IBMiMember, QsysFsOptions } from "../../typings";

export function getMemberUri(member: IBMiMember, options?: QsysFsOptions) {
    return getUriFromPath(`${member.asp ? `${member.asp}/` : ``}${member.library}/${member.file}/${member.name}.${member.extension}`, options);
}

export function getUriFromPath(path: string, options?: QsysFsOptions) {
    const query = stringify(options as ParsedUrlQueryInput);
    if (path.startsWith(`/`)) {
        //IFS path
        return vscode.Uri.parse(path).with({ scheme: `streamfile`, path, query });
    } else {
        //QSYS path
        return vscode.Uri.parse(path).with({ scheme: `member`, path: `/${path}`, query });
    }
}

export function checkIfEditable(uri: vscode.Uri) {
    const fsOptions = parseFSOptions(uri);
    if (fsOptions.readonly) {
        vscode.window.showWarningMessage(`Saving is disabled: member has been opened in read only mode.`);
        return false;
    } else if (isProtectedFilter(fsOptions.filter)) {
        vscode.window.showWarningMessage(`Saving is disabled: member has been opened from the protected filter ${fsOptions.filter}.`);
        return false;
    }
    else {
        return true;
    }
}

function parseFSOptions(uri: vscode.Uri): QsysFsOptions {
    return parse(uri.query);
}

function isProtectedFilter(filter?: string): boolean {
    return filter && instance.getConfig()?.objectFilters.find(f => f.name === filter)?.protected || false;
}