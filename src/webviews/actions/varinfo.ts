import vscode from "vscode";

// Used to list info about available variables
type VariableInfo = {
  name: string
  text: string
}

type VariableInfoList = {
  member: VariableInfo[]
  streamFile: VariableInfo[]
  object: VariableInfo[]
}

const generic: () => VariableInfo[] = () => [
  { name: `&amp;CURLIB`, text: vscode.l10n.t(`Current library, changeable in Library List`) },
  { name: `&amp;USERNAME`, text: vscode.l10n.t(`Username for connection`)},
  { name: `&amp;WORKDIR`, text: vscode.l10n.t(`Current working directory, changeable in IFS Browser`)},
  { name: `&amp;HOST`, text: vscode.l10n.t(`Hostname or IP address from the current connection`)},
  { name: `&amp;BUILDLIB`, text: vscode.l10n.t(`The same as <code>&amp;CURLIB</code>`)},
  { name: `&amp;LIBLC`, text: vscode.l10n.t(`Library list delimited by comma`)},
  { name: `&amp;LIBLS`, text: vscode.l10n.t(`Library list delimited by space`) }
];

export function getVariablesInfo(): VariableInfoList {
  return {
    member : [
      { name: `&amp;OPENLIB`, text: vscode.l10n.t(`Library name where the source member lives (<code>&amp;OPENLIBL</code> for lowercase)`)},
      { name: `&amp;OPENSPF`, text: vscode.l10n.t(`Source file name where the source member lives (<code>&amp;OPENSPFL</code> for lowercase)`)},
      { name: `&amp;OPENMBR`, text: vscode.l10n.t(`Name of the source member (<code>&amp;OPENMBRL</code> for lowercase)`)},
      { name: `&amp;EXT`, text: vscode.l10n.t(`Extension of the source member (<code>&amp;EXTL</code> for lowercase)`)},
      ...generic()
    ],
    streamFile: [
      { name: `&amp;FULLPATH`, text: vscode.l10n.t(`Full path of the file on the remote system`)},
      { name: `&amp;FILEDIR`, text: vscode.l10n.t(`Directory of the file on the remote system`)},
      { name: `&amp;RELATIVEPATH`, text: vscode.l10n.t(`Relative path of the streamfile from the working directory or workspace`)},
      { name: `&amp;PARENT`, text: vscode.l10n.t(`Name of the parent directory or source file`)},
      { name: `&amp;BASENAME`, text: vscode.l10n.t(`Name of the file, including the extension`)},
      { name: `&amp;NAME`, text: vscode.l10n.t(`Name of the file (<code>&amp;NAMEL</code> for lowercase)`)},
      { name: `&amp;EXT`, text: vscode.l10n.t(`Extension of the file (<code>&amp;EXTL</code> for lowercase)`)},
      ...generic()
    ],
    object: [
      { name: `&amp;LIBRARY`, text: vscode.l10n.t(`Library name where the object lives (<code>&amp;LIBRARYL</code> for lowercase)`)},
      { name: `&amp;NAME`, text: vscode.l10n.t(`Name of the object (<code>&amp;NAMEL</code> for lowercase)`)},
      { name: `&amp;TYPE`, text: vscode.l10n.t(`Type of the object (<code>&amp;TYPEL</code> for lowercase)`)},
      { name: `&amp;EXT`, text: vscode.l10n.t(`Extension/attribute of the object (<code>&amp;EXTL</code> for lowercase)`)},
      ...generic()
    ]
  }
}