// Used to list info about available variables

const generic = [
  {name: `&amp;CURLIB`, text: `Current library, changable in Library List`},
  {name: `&amp;USERNAME`, text: `Username for connection`},
  {name: `&amp;HOME`, text: `Current home/working directory, changable in IFS Browser`},
  {name: `&amp;BUILDIB`, text: `The same as <code>&amp;CURLIB</code>`},
  {name: `&amp;LIBLC`, text: `Library list delimited by comma`},
  {name: `&amp;LIBLS`, text: `Library list delimited by space`}
];

module.exports = {
  'Member': [
    {name: `&amp;OPENLIB`, text: `Library name where the source member lives (<code>&amp;OPENLIBL</code> for lowercase)`},
    {name: `&amp;OPENSPF`, text: `Source file name where the source member lives (<code>&amp;OPENSPFL</code> for lowercase)`},
    {name: `&amp;OPENMBR`, text: `Name of the source member (<code>&amp;OPENMBRL</code> for lowercase)`},
    {name: `&amp;EXT`, text: `Extension of the source member (<code>&amp;EXTL</code> for lowercase)`},
    ...generic
  ],
  'Streamfile': [
    {name: `&amp;FULLPATH`, text: `Full path of the file on the remote system`},
    {name: `&amp;RELATIVEPATH`, text: `Relative path of the streamfile from the home directory or workspace`},
    {name: `&amp;PARENT`, text: `Name of the parent directory or source file`},
    {name: `&amp;BASENAME`, text: `Name of the file, including the extension`},
    {name: `&amp;NAME`, text: `Name of the file (<code>&amp;NAMEL</code> for lowercase)`},
    {name: `&amp;EXT`, text: `Extension of the file (<code>&amp;EXTL</code> for lowercase)`},
    ...generic
  ],
  'Object': [
    { name: `&amp;LIBRARY`, text: `Library name where the object lives (<code>&amp;LIBRARYL</code> for lowercase)`},
    { name: `&amp;NAME`, text: `Name of the object (<code>&amp;NAMEL</code> for lowercase)`},
    { name: `&amp;TYPE`, text: `Type of the object (<code>&amp;TYPEL</code> for lowercase)`},
    { name: `&amp;EXT`, text: `Extension/attribute of the object (<code>&amp;EXTL</code> for lowercase)`},
    ...generic
  ]
}