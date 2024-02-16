import { t } from "../../locale"

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
  { name: `&amp;CURLIB`, text: t(`actions.CURLIB`) },
  { name: `&amp;USERNAME`, text: t("actions.USERNAME")},
  { name: `&amp;WORKDIR`, text: t("actions.WORKDIR")},
  { name: `&amp;HOST`, text: t("actions.HOST")},
  { name: `&amp;BUILDLIB`, text: t("actions.BUILDLIB")},
  { name: `&amp;LIBLC`, text: t("actions.LIBLC")},
  { name: `&amp;LIBLS`, text: t("actions.LIBLS") }
];

export function getVariablesInfo(): VariableInfoList {
  return {
    member : [
      { name: `&amp;OPENLIB`, text: t("actions.OPENLIB")},
      { name: `&amp;OPENSPF`, text: t("actions.OPENSPF")},
      { name: `&amp;OPENMBR`, text: t("actions.OPENMBR")},
      { name: `&amp;EXT`, text: t("actions.member.EXT")},
      ...generic()
    ],
    streamFile: [
      { name: `&amp;FULLPATH`, text: t("actions.FULLPATH")},
      { name: `&amp;FILEDIR`, text: t("actions.FILEDIR")},
      { name: `&amp;RELATIVEPATH`, text: t("actions.RELATIVEPATH")},
      { name: `&amp;PARENT`, text: t("actions.PARENT")},
      { name: `&amp;BASENAME`, text: t("actions.BASENAME")},
      { name: `&amp;NAME`, text: t("actions.streamfile.NAME")},
      { name: `&amp;EXT`, text: t("actions.streamfile.EXT")},
      ...generic()
    ],
    object: [
      { name: `&amp;LIBRARY`, text: t("actions.LIBRARY")},
      { name: `&amp;NAME`, text: t("actions.NAME")},
      { name: `&amp;TYPE`, text: t("actions.object.TYPE")},
      { name: `&amp;EXT`, text: t("actions.object.EXT")},
      ...generic()
    ]
  }
}