import vscode from "vscode";
import { IBMiMember } from "../../typings";

interface QsysFsOptions {
    readOnly?: boolean
}

export function getMemberUri(member: IBMiMember, options?: QsysFsOptions) {
    return getUriFromPath(`${member.asp ? `${member.asp}/` : ``}${member.library}/${member.file}/${member.name}.${member.extension}`, options);
}

export function getUriFromPath(path: string, options?: QsysFsOptions) {
    const fragment = encodeFSOptions(options);
    if (path.startsWith(`/`)) {
        //IFS path
        return vscode.Uri.parse(path).with({ scheme: `streamfile`, path, fragment });
    } else {
        //QSYS path
        return vscode.Uri.parse(path).with({ scheme: `member`, path: `/${path}`, fragment });
    }
}

/**
 * Parses the fragment part of the Uri to get the fs options.
 * Options are strings separated by `,`.
 * 
 * Supported options are:
 * - `readonly`: prevent files/members from being saved
 * 
 * @param uri 
 * @returns 
 */
export function parseFSOptions(uri: vscode.Uri): QsysFsOptions {
    const options = uri.fragment?.split(",").map(o => o.toLowerCase());
    return {
        readOnly: options?.includes("readonly")
    }
}

function encodeFSOptions(fsOptions?: QsysFsOptions) {
    if (fsOptions) {
        return Object.entries(fsOptions).map(([field, value]) => {
            switch (typeof value) {
                case "boolean": return value ? field : "";
                default: return `${field}=${value}`;
            }
        })
            .filter(o => o)
            .join(",");
    }
    else {
        return undefined;
    }
}