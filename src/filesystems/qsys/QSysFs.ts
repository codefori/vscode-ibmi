import { stringify, parse, ParsedUrlQueryInput } from "querystring";
import vscode, { FilePermission } from "vscode";
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

export function getFilePermission(uri: vscode.Uri): FilePermission | undefined {
    const fsOptions = parseFSOptions(uri);
    if (instance.getConfig()?.readOnlyMode || fsOptions.readonly || isProtectedFilter(fsOptions.filter)) {
        return FilePermission.Readonly;
    }
}

function parseFSOptions(uri: vscode.Uri): QsysFsOptions {
    return parse(uri.query);
}

function isProtectedFilter(filter?: string): boolean {
    return filter && instance.getConfig()?.objectFilters.find(f => f.name === filter)?.protected || false;
}