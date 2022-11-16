import vscode from "vscode";
import { stringDiff } from "vscode-diff";
import { CustomUI, Field } from "../../api/CustomUI";
import IBMi from "../../api/IBMi";
import IBMiContent from "../../api/IBMiContent";
import { Tools } from "../../api/Tools";

import { instance } from "../../Instance";

let currentConnectionName: string;
const columns: Map<string, string> = new Map;
let selectClause: string;

export async function displayProgram(object: IBMiObject) {
  const content = instance.getContent();
  if (content) {
    await loadProgramInfoColumns(content);
    const library = object.library.toUpperCase();
    const name = object.name.toUpperCase();

    //https://www.ibm.com/docs/en/i/7.4?topic=services-program-info-view
    const [programInfo] = await content.runSQL(`Select ${selectClause} From QSYS2.PROGRAM_INFO Where PROGRAM_LIBRARY = '${library}' And PROGRAM_NAME = '${name}'`);
    const type = String(programInfo.PROGRAM_TYPE).toUpperCase();
    const objectType = String(programInfo.OBJECT_TYPE).toUpperCase();
    reorganizeFields(programInfo);    
    
    const title = `${type} ${objectType === '*PGM' ? "Program" : "Service program"}: ${library}/${name}`;
    const table = new Field('custom', "", renderTable(title, programInfo));

    const ui = new CustomUI(vscode.ViewColumn.One);
    ui.isForm = false;
    ui.addField(table);
    ui.loadPage(title);
  }
}

async function loadProgramInfoColumns(content: IBMiContent) {
  if (!selectClause || !currentConnectionName || currentConnectionName !== content.ibmi.currentConnectionName) {
    selectClause = "";
    const hasFullSQL = content.ibmi.config?.enableSQL;
    currentConnectionName = content.ibmi.currentConnectionName;
    //https://www.ibm.com/docs/en/i/7.4?topic=views-syscolumns2
    (await content.runSQL(`Select COLUMN_NAME, ${castIfNeeded("COLUMN_HEADING", 60, hasFullSQL)}, CCSID, LENGTH From QSYS2.SYSCOLUMNS2 Where TABLE_NAME = 'PROGRAM_INFO'`))
      .forEach(column => {
        const name = column.COLUMN_NAME!.toString();
        if (name !== "PROGRAM_NAME" && name !== "PROGRAM_LIBRARY") {
          const heading = parseHeading(column.COLUMN_HEADING!.toString());
          const length = Number(column.LENGTH);
          columns.set(name, heading);
          selectClause += (selectClause ? ',' : '') + castIfNeeded(name, length, hasFullSQL || (column.CCSID || 0) !== 1200);
        }
      });
  }
}

/**
 * Casts a column to CCSID 37 in case our user uses an undefined CCSID.
 * (so everyone can enjoy this feature)
 * @param columnName 
 * @param length 
 * @param hasFullSQL 
 * @returns the column name or Cast(`columnName` As VarChar(`length`) CCSID 37) As `columnName` if user's CCSId is undefined
 */
function castIfNeeded(columnName: string, length: number, hasFullSQL?: boolean): string {
  return hasFullSQL ? columnName : `Cast(${columnName} As VarChar(${length}) CCSID 37) As ${columnName}`;
}

function parseHeading(rawHeading: string): string {
  const partSize = 20;
  const parts = Math.ceil(rawHeading.length / partSize);
  let heading = "";
  for (let part = 0; part < parts; part++) {
    heading += rawHeading.substring(partSize * part, partSize * (part + 1)).trim() + " ";
  }
  return heading.trimEnd();
}

function renderTable(title : string, programInfo: Tools.DB2Row): string {
  return /* html */ `<vscode-table style="height:100vh" columns='["350px", "auto"]' zebra bordered resizable>
  <vscode-table-header slot="header">
      <vscode-table-header-cell>${title}</vscode-table-header-cell>  
      <vscode-table-header-cell>&nbsp;</vscode-table-header-cell>      
    </vscode-table-header>
  <vscode-table-body slot="body">
    ${Object.entries(programInfo).filter(entry => entry[1]).map(entry => renderRow(entry[0], String(entry[1]))).join("\n")}      
  </vscode-table-body>
</vscode-table>`;
}

function renderRow(column: string, value: string): string {
  return /* html */ `<vscode-table-row>
    <vscode-table-cell>${columns.get(column) || column}</vscode-table-cell>  
    <vscode-table-cell>${value}</vscode-table-cell>
</vscode-table-row>`;
}


function reorganizeFields(programInfo: Tools.DB2Row) {
  if(programInfo.PROGRAM_ENTRY_PROCEDURE_MODULE){
    programInfo.PROGRAM_ENTRY_PROCEDURE_MODULE = `${programInfo.PROGRAM_ENTRY_PROCEDURE_MODULE_LIBRARY}/${programInfo.PROGRAM_ENTRY_PROCEDURE_MODULE}`;
    programInfo.PROGRAM_ENTRY_PROCEDURE_MODULE_LIBRARY = null;
  }

  if(programInfo.EXPORT_SOURCE_FILE){
    programInfo.EXPORT_SOURCE_FILE = `${programInfo.EXPORT_SOURCE_LIBRARY}/${programInfo.EXPORT_SOURCE_FILE},${programInfo.EXPORT_SOURCE_FILE_MEMBER}`;
    programInfo.EXPORT_SOURCE_LIBRARY = null;
    programInfo.EXPORT_SOURCE_FILE_MEMBER = null;
  }

  if(programInfo.PROCEDURE_EXPORTS){
    programInfo.PROCEDURE_EXPORTS = `${programInfo.PROCEDURE_EXPORTS} / ${programInfo.MAXIMUM_PROCEDURE_EXPORTS}`;
    programInfo.MAXIMUM_PROCEDURE_EXPORTS = null;
  }

  if(programInfo.AUXILIARY_STORAGE_SEGMENTS){
    programInfo.AUXILIARY_STORAGE_SEGMENTS = `${programInfo.AUXILIARY_STORAGE_SEGMENTS} / ${programInfo.MAXIMUM_AUXILIARY_STORAGE_SEGMENTS}`;
    programInfo.MAXIMUM_AUXILIARY_STORAGE_SEGMENTS = null;
  }

  if(programInfo.PROGRAM_SIZE){
    programInfo.PROGRAM_SIZE = `${programInfo.PROGRAM_SIZE} / ${programInfo.MAXIMUM_PROGRAM_SIZE}`;
    programInfo.MAXIMUM_PROGRAM_SIZE = null;
  }

  if(programInfo.MODULES){
    programInfo.MODULES = `${programInfo.MODULES} / ${programInfo.MAXIMUM_MODULES}`;
    programInfo.MAXIMUM_MODULES = null;
  }

  if(programInfo.STRING_DIRECTORY_SIZE){
    programInfo.STRING_DIRECTORY_SIZE = `${programInfo.STRING_DIRECTORY_SIZE} / ${programInfo.MAXIMUM_STRING_DIRECTORY_SIZE}`;
    programInfo.MAXIMUM_STRING_DIRECTORY_SIZE = null;
  }

  if(programInfo.SERVICE_PROGRAMS){
    programInfo.SERVICE_PROGRAMS = `${programInfo.SERVICE_PROGRAMS} / ${programInfo.MAXIMUM_SERVICE_PROGRAMS}`;
    programInfo.MAXIMUM_SERVICE_PROGRAMS = null;
  }

  if(programInfo.COPYRIGHT_STRING_SIZE){
    programInfo.COPYRIGHT_STRING_SIZE = `${programInfo.COPYRIGHT_STRING_SIZE} / ${programInfo.MAXIMUM_COPYRIGHT_STRING_SIZE}`;
    programInfo.MAXIMUM_COPYRIGHT_STRING_SIZE = null;
  }

  if(programInfo.DATA_EXPORTS){
    programInfo.DATA_EXPORTS = `${programInfo.DATA_EXPORTS} / ${programInfo.MAXIMUM_DATA_EXPORTS}`;
    programInfo.MAXIMUM_DATA_EXPORTS = null;
  }

  if(programInfo.SOURCE_FILE){
    programInfo.SOURCE_FILE = `${programInfo.SOURCE_FILE_LIBRARY}/${programInfo.SOURCE_FILE},${programInfo.SOURCE_FILE_MEMBER}`;
    programInfo.SOURCE_FILE_LIBRARY = null;
    programInfo.SOURCE_FILE_MEMBER = null;
  }

  if(programInfo.SORT_SEQUENCE && programInfo.SORT_SEQUENCE_LIBRARY){
    programInfo.SORT_SEQUENCE = `${programInfo.SORT_SEQUENCE_LIBRARY}/${programInfo.SORT_SEQUENCE}`;
    programInfo.SORT_SEQUENCE_LIBRARY = null;
  }

  if(programInfo.SQL_SORT_SEQUENCE && programInfo.SQL_SORT_SEQUENCE_LIBRARY){
    programInfo.SQL_SORT_SEQUENCE = `${programInfo.SQL_SORT_SEQUENCE_LIBRARY}/${programInfo.SQL_SORT_SEQUENCE}`;
    programInfo.SQL_SORT_SEQUENCE_LIBRARY = null;
  }

  if(programInfo.SQL_PACKAGE_LIBRARY && programInfo.SQL_PACKAGE){
    programInfo.SQL_PACKAGE = `${programInfo.SQL_PACKAGE_LIBRARY}/${programInfo.SQL_PACKAGE}`;
    programInfo.SQL_PACKAGE_LIBRARY = null;
  }
}

