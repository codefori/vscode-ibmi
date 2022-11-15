import vscode from "vscode";
import { displayCommand } from "../webviews/objects/Cmd";
import { editDataArea } from "../webviews/objects/Dtaara"
import { displayProgram } from "../webviews/objects/Pgm";
type ObjectType = string
type ObjectActions = Record<ObjectType, ObjectAction[]>;

interface ObjectAction {
    command: string
    title: string
    default?: boolean
    action: (object: IBMiObject) => Promise<void> | void
}

const objectActions: ObjectActions = {
    dtaara: [
        {
            command: `code-for-ibmi.editDataArea`,
            title: 'Edit Data Area',
            default: true,
            action: editDataArea
        }
    ],
    cmd : [
        {
            command: `code-for-ibmi.displayCommand`,
            title: 'Display command',
            default: true,
            action: displayCommand
        }
    ],
    pgm: [
        {
            command: `code-for-ibmi.displayProgram`,
            title: 'Display program',
            default: true,
            action: displayProgram
        }
    ],
    srvpgm: [
        {
            command: `code-for-ibmi.displayServiceProgram`,
            title: 'Display service program',
            default: true,
            action: displayProgram
        }
    ],
};

export const ObjectCommands = Object.entries(objectActions).flatMap(oa => oa[1]);
export function getDefaultObjectAction(type : ObjectType) : ObjectAction | undefined{
    return objectActions[type]?.find(action => action.default);
}
