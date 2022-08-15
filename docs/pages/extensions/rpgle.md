
## Install

The extension can be [installed from the Marketplace](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.vscode-rpgle) and is also part of the [IBM i Development Pack](https://marketplace.visualstudio.com/items?itemName=HalcyonTechLtd.ibm-i-development-pack).

RPGLE language tools also works in VS Code web.

## Usage

The extension has two main pieces of functionality:

* language tools: content assist, outline view, etc. Supports every version of ILE RPG (fixed, mixed and free-format)
* linter: configurable linter to check code quality. **Only supports total free-format** (`**FREE`).

The language tools are enabled by default, but the linter must be enabled in the VS Code settings. The linter is always enabled when being used by VS Code web.

## Creating lint configuration

You can create lint configuration for all types of file type. Use the 'Open RPGLE lint configuration' command from the command palette to automatically create and open the relative lint configuration from the RPGLE source you are working in.

### Relative lint config

* If you are developing in `LIB/QRPGLESRC/MYSOURCE.RPGLE`, then the linter config exists in `LIB/VSCODE/RPGLINT.JSON`. Each library has its own rules configuration file, binding it to all RPGLE sources in that library. 
* When developing in the IFS, linter rules config exist in `.vscode/rpglint.json` relative to the current working directory.
* When developing in a local workspace, linter rules exist in `.vscode/rpglint.json` relative to the workspace.

### Lint options

Below are some available lint configs. [See the `rpglint.json` schema for the most up to date rules](https://github.com/halcyon-tech/vscode-rpgle/blob/main/src/schemas/rpglint.json).

| Type | Rule | Value | Description |
|---|---|---|---|
| 🌟 | indent | number | Indent for RPGLE. This will override the VS Code default. |
| 🌟 | BlankStructNamesCheck | boolean | Struct names cannot be blank (*N). |
| 🌟 | QualifiedCheck | boolean | Struct names must be qualified (QUALIFIED). |
| 🌟 | PrototypeCheck | boolean | Prototypes can only be defined with either EXT, EXTPGM or EXTPROC |
| 🌟 | ForceOptionalParens | boolean | Expressions must be surrounded by brackets. |
| 🌟 | NoOCCURS | boolean | OCCURS is not allowed. |
| 🤔 | NoSELECTAll | boolean | 'SELECT *' is not allowed in Embedded SQL. |
| 🌟 | UselessOperationCheck | boolean | Redundant operation codes (EVAL, CALLP) not allowed. |
| 🌟 | UppercaseConstants | boolean | Constants must be in uppercase. |
| 🌟 | IncorrectVariableCase | boolean | Variable names must match the case of the definition. |
| 🌟 | RequiresParameter | boolean | Parentheses must be used on a procedure call, even if it has no parameters. |
| 🌟 | RequiresProcedureDescription | boolean | Procedure titles and descriptions must be provided. |
| 🌟 | StringLiteralDupe | boolean | Duplicate string literals are not allowed. |
| 🌟 | RequireBlankSpecial | boolean | *BLANK must be used over empty string literals. |
| 🌟 | CopybookDirective | string | Force which directive which must be used to include other source. (`COPY` or `INCLUDE`) |
| 🌟 | UppercaseDirectives | boolean | Directives must be in uppercase. |
| 🤔 | NoSQLJoins | boolean | JOINs in Embedded SQL are not allowed. |
| 🌟 | NoGlobalsInProcedures | boolean | Globals are not allowed in procedures. |
| 🌟 | SpecificCasing | array | Specific casing for op codes, declartions or built-in functions codes. |
| 🌟 | NoCTDATA | boolean | CTDATA is not allowed. |
| 🌟 | PrettyComments | boolean | Comments cannot be blank, must start with a space and have correct indentation. |
| 🌟 | NoGlobalSubroutines | boolean | Global subroutines are not allowed. |
| 🌟 | NoLocalSubroutines | boolean | Subroutines in procedures are not allowed. |
| 🌟 | NoUnreferenced | boolean | Unreferenced definitions are not allowed. |
| 🔒 | NoExternalTo | string array | Calls to certain APIs are not allowed. (EXTPROC / EXTPGM) |
| 🔒 | NoExecuteImmediate | boolean | Embedded SQL statement with EXECUTE IMMEDIATE not allowed. |
| 🔒 | NoExtProgramVariable | boolean | Declaring a prototype with EXTPGM and EXTPROC using a procedure is now allowed. |
| 🤔 | IncludeMustBeRelative | boolean | When using copy or include statements, path must be relative. For members, you must at least include the source file. For streamfiles, it is relative from the working directory. |
| 🤔 | SQLHostVarCheck | boolean | Warns when referencing variables in Embedded SQL that are also defined locally. | 

**Type key**

| Key | Value |
|---|---|
| 🌟 | Clean code |
| 🤔 | Safe code |
| 🔒 | Secure code |