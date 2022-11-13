import vscode from "vscode";
import { editDataArea } from "../webviews/objects/Dtaara"
type ObjectType = string
type ObjectActions = Record<ObjectType, ObjectAction[]>;

interface ObjectAction {
    command: string
    title: string
    default?: boolean
    action: (object: IBMiObject) => Promise<void> | void
}

const objectActions: ObjectActions = {
    
};

export const ObjectCommands = Object.entries(objectActions).flatMap(oa => oa[1]);
export function getDefaultObjectAction(type : ObjectType) : ObjectAction | undefined{
    return objectActions[type]?.find(action => action.default);
}
