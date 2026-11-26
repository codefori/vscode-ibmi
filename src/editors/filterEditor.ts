import vscode, { l10n } from "vscode";
import { FilterType, parseFilter } from "../api/Filter";
import IBMi from "../api/IBMi";
import { updateObjectFilter } from "../api/objectFilters";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { ObjectFilters } from "../typings";
import { CustomEditor } from "./customEditorProvider";

const editedFilters: Set<string> = new Set;

type ObjectFiltersData = {
  filterType: FilterType
  library: string
  object: string
  types: string
  member: string
  memberType: string
  memberText: string
  memberCreated: string
  memberChanged: string
  protected: boolean
}

export function isFilterEdited(filter: ObjectFilters) {
  return editedFilters.has(filter.name);
}

export function editObjectFilter(filter: ObjectFilters, doAfterSave?: () => Thenable<void>) {
  new CustomEditor<ObjectFiltersData>(`${filter.name}.filter`, data => save(filter, data).then(doAfterSave), () => editedFilters.delete(filter.name))
    .addSelect(`filterType`, `Filtering type`, [
      { value: 'simple', description: 'Simple', text: `A comma-separated list of multi-generic values. Examples: *, Q* or *CL*SRC*. A single *, *ALL or blank will return everything.`, selected: filter.filterType === "simple" },
      { value: 'regex', description: 'Regex', text: `Use a single RegEx for filtering.`, selected: filter.filterType === "regex" }
    ], `Select the filtering strategy to apply for filtering names (not object types).<br/>Checkout <a href="https://regex101.com">https://regex101.com</a> to get started with RegExs.`)
    .addInput(`library`, `Libraries`, `Library names filter.`, { default: filter.library })
    .addInput(`object`, `Objects`, `Object names filter.`, { default: filter.object })
    .addInput(`types`, `Object types`, `A comma delimited list of object types. For example <code>*ALL</code>, or <code>*PGM</code>, <code>*SRVPGM</code>. <code>*SRCPF</code> is a special type which will return only source files.`, { default: filter.types.join(`, `) })
    .addInput(`member`, `Members`, `Member names filter.`, { default: filter.member })
    .addInput(`memberType`, `Member type`, `Member types filter.`, { default: filter.memberType })
    .addInput(`memberText`, `Member text`, `Member text description filter.`, { default: filter.memberText || `*` })
    .addInput(`memberCreated`, `Member created from`, `Only list members created on or after this date. Leave blank to list members regardless of what their creation date is.`, { default: filter.memberCreated || ``, inputType: `date` })
    .addInput(`memberChanged`, `Member changed from`, `Only list members last changed on or after this date. Leave blank to list members regardless of what their last changed date is.`, { default: filter.memberChanged || ``, inputType: `date` })
    .addCheckbox(`protected`, `Protected`, `Make this filter protected: objects and members can't be altered and Actions can only run if flagged to run on protected targets.`, filter.protected)
    .open();

  editedFilters.add(filter.name);
}


export async function checkObjectFilter(connection: IBMi, filter: ObjectFilters) {
  const singleLibrary = parseFilter(filter.library, filter.filterType).noFilter ? filter.library : undefined;
  if (
    singleLibrary &&
    (await connection.getContent().validateLibraryList([singleLibrary])).length &&
    !await vscode.window.showWarningMessage(l10n.t("Library {0} is invalid. Do you still want to save that Object Filter?", singleLibrary), {
      modal: true,
    }, l10n.t("Yes"))
  ) {
    throw new Error(l10n.t("Save aborted"));
  }
}

async function save(filter: ObjectFilters, data: ObjectFiltersData) {
  const connection = instance.getConnection();
  if (connection) {
    const useRegexFilters = data.filterType === "regex";

    filter.filterType = data.filterType;
    filter.types = data.types.split(`,`).map(item => item.trim().toUpperCase()).filter(item => item !== ``);

    const emptyStar = (value: string) => (value.trim() || '*')
    const getObjects = (objects: string) => emptyStar(objects)
      .split(',')
      .map(o => useRegexFilters ? o : connection.upperCaseName(o))
      .filter(Tools.distinct)
      .join(",");

    filter.library = getObjects(data.library);
    filter.object = getObjects(data.object);

    filter.member = connection.upperCaseName(data.member.trim());

    filter.memberType = emptyStar(data.memberType);
    filter.memberText = emptyStar(data.memberText);
    filter.memberCreated = Tools.parseFilterDate(data.memberCreated) || '';
    filter.memberChanged = Tools.parseFilterDate(data.memberChanged) || '';
    filter.protected = data.protected;

    await checkObjectFilter(connection, filter);

    await updateObjectFilter(filter);
  }
}
