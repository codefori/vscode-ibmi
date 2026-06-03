# Feature: Upload/Download Members with Source Dates

## Overview

This feature would allow users to download IBM i source members with their SRCDAT (source change date) information preserved in the local file, and intelligently upload them back with dates intact. This enables version control of source members while preserving change date history.

## Background

### IBM i Source File Structure

IBM i source files have three key columns:
- **SRCSEQ**: Sequence number (decimal)
- **SRCDAT**: Source change date `NUM(6,0)` - always 6 bytes, format YYMMDD
- **SRCDTA**: Source data `CHAR(n)` - variable length defined at source file creation (e.g., 80, 112, 240 bytes)

When uploading:
- **Without dates**: Uses `CPYFRMSTMF` - content goes into SRCDTA, SRCDAT defaults to 0 or current date
- **With dates**: Uses SQL INSERT - dates and content go into separate columns

The source file's defined record length for SRCDTA handles padding/truncation automatically.

### Current Implementation

The extension already has two upload methods:

1. **`uploadMemberContent()`** in [src/api/IBMiContent.ts](src/api/IBMiContent.ts#L266)
   - Uses `CPYFRMSTMF` command
   - Does not preserve source dates
   - Works regardless of SQL availability

2. **`uploadMemberContentWithDates()`** in [src/filesystems/qsys/extendedContent.ts](src/filesystems/qsys/extendedContent.ts#L105)
   - Uses SQL INSERT statements
   - Preserves source dates by calculating changes vs. baseline
   - Requires SQL support (`connection.sqlRunnerAvailable()`)
   - Used when editing members in VS Code with `enableSourceDates` config enabled

The decision logic is in [src/filesystems/qsys/QSysFs.ts](src/filesystems/qsys/QSysFs.ts#L223-L227):

```typescript
if (this.extendedMemberSupport) {
    await this.extendedContent.uploadMemberContentWithDates(uri, content.toString());
} else {
    await contentApi.uploadMemberContent(library, file, member, content);
}
```

Where `extendedMemberSupport` is true when:
- `config.enableSourceDates === true` AND
- `connection.sqlRunnerAvailable() === true`

## Proposed Feature

### File Format

When downloading with dates, store as a fixed-format text file:
```
YYMMDDSource line content here
YYMMDDAnother line
000000Line with no change date
```

- First 6 bytes: SRCDAT value (digits only)
- Remaining bytes: SRCDTA content
- Total line length: 6 + original SRCDTA content length

### User Commands

#### 1. Download Member with Dates

New command: `code-for-ibmi.downloadMemberWithDates`

- Menu location: Object Browser context menu (alongside existing download commands)
- Requires: `enableSourceDates` config enabled AND SQL available
- Downloads member content with SRCDAT column prefixed to each line
- Saves to local file system

#### 2. Upload Member from Local File

New command: `code-for-ibmi.uploadMemberFromLocal`

- Menu location: File explorer context menu for applicable file types
- Auto-detects if file contains dates (first 6 bytes are all digits)
- Prompts user for upload destination with smart defaults
- Uses appropriate upload method based on detection

## Implementation Details

### 1. Download Member with Dates

```typescript
async function downloadMemberWithDates(member: IBMiMember, rootPath: string) {
  const connection = instance.getConnection();
  if (!connection) return;

  const config = connection.getConfig();
  const useSourceDates = config?.enableSourceDates && connection.sqlRunnerAvailable();

  if (!useSourceDates) {
    vscode.window.showErrorMessage(
      'Source date support is not enabled or SQL is not available.'
    );
    return;
  }

  const uri = getMemberUri(member);
  const sourceDateHandler = new SourceDateHandler(context);
  const extendedContent = new ExtendedIBMiContent(sourceDateHandler);

  // This returns the body WITHOUT dates, but stores dates internally
  const body = await extendedContent.downloadMemberContentWithDates(uri);

  // Get the dates that were stored
  const alias = getAliasName(uri);
  const sourceDates = sourceDateHandler.baseDates.get(alias) || [];

  // Build the dated content - each line prefixed with YYMMDD
  const lines = body.split('\n');
  const datedContent = lines.map((line, index) => {
    const date = sourceDates[index] || '000000';
    return date + line;
  }).join('\n');

  // Save to local file
  const localFile = path.join(rootPath,
    `${member.name.toUpperCase()}.${(member.extension || 'MBR').toUpperCase()}`);
  fs.writeFileSync(localFile, datedContent, 'utf8');
}
```

### 2. Smart Upload Detection

```typescript
function detectDatedFormat(content: string): { hasDates: boolean, dates: string[], body: string } {
  const lines = content.split('\n');

  // Check: Do ALL non-empty lines start with exactly 6 digits?
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  const allHaveDates = nonEmptyLines.length > 0 &&
    nonEmptyLines.every(l => l.length >= 6 && /^\d{6}/.test(l));

  if (allHaveDates) {
    const dates = lines.map(l => l.substring(0, 6));
    const body = lines.map(l => l.substring(6)).join('\n');
    return { hasDates: true, dates, body };
  }

  return { hasDates: false, dates: [], body: content };
}
```

### 3. Upload from Local File

```typescript
async function uploadMemberFromLocalFile(localFilePath: string) {
  const content = fs.readFileSync(localFilePath, 'utf8');
  const { hasDates, dates, body } = detectDatedFormat(content);

  // Derive default values from file path
  const fileInfo = deriveSourceFileInfo(localFilePath);

  // Show prompt to user
  const uploadInfo = await promptForUploadInfo(fileInfo);
  if (!uploadInfo) return; // User cancelled

  const connection = instance.getConnection();
  const config = connection?.getConfig();
  const useSourceDates = hasDates &&
                         config?.enableSourceDates &&
                         connection?.sqlRunnerAvailable();

  if (useSourceDates) {
    // Upload with dates
    const uri = getMemberUri({
      library: uploadInfo.library,
      file: uploadInfo.sourceFile,
      name: uploadInfo.member,
      extension: uploadInfo.extension,
      asp: uploadInfo.asp
    });

    await uploadMemberContentWithProvidedDates(uri, body, dates);
  } else {
    // Standard upload
    const contentApi = connection?.getContent();
    await contentApi?.uploadMemberContent(
      uploadInfo.library,
      uploadInfo.sourceFile,
      uploadInfo.member,
      body
    );
  }
}
```

### 4. Derive Source File Info from Path

```typescript
function deriveSourceFileInfo(localFilePath: string): Partial<UploadInfo> {
  const parsedPath = path.parse(localFilePath);
  const extension = parsedPath.ext.substring(1).toUpperCase(); // Remove leading dot
  const memberName = parsedPath.name.toUpperCase();

  // Map extensions to typical source files
  const extensionToSourceFile: Record<string, string> = {
    'RPGLE': 'QRPGLESRC',
    'SQLRPGLE': 'QRPGLESRC',
    'CLLE': 'QCLSRC',
    'CL': 'QCLSRC',
    'CMD': 'QCMDSRC',
    'DSPF': 'QDDSSRC',
    'PRTF': 'QDDSSRC',
    'PF': 'QDDSSRC',
    'LF': 'QDDSSRC',
    'C': 'QCSRC',
    'CPP': 'QCSRC',
    'H': 'H',
    'CBLLE': 'QCBLESRC',
    'SQL': 'QSQLSRC',
  };

  const defaultSourceFile = extensionToSourceFile[extension] || 'QSRC';

  // Try to derive library from parent folder structure
  const pathParts = parsedPath.dir.split(path.sep);
  let library = 'QGPL'; // Default

  // Check if path structure is like /someroot/MYLIB/QRPGLESRC/member.RPGLE
  if (pathParts.length >= 2) {
    const potentialLib = pathParts[pathParts.length - 2].toUpperCase();
    if (/^[A-Z#@$][A-Z0-9#@$]{0,9}$/.test(potentialLib)) {
      library = potentialLib;
    }
  }

  return {
    library,
    sourceFile: defaultSourceFile,
    member: memberName,
    extension
  };
}
```

### 5. User Prompt for Upload Info

```typescript
interface UploadInfo {
  library: string;
  sourceFile: string;
  member: string;
  extension: string;
  asp?: string;
}

async function promptForUploadInfo(defaults: Partial<UploadInfo>): Promise<UploadInfo | undefined> {
  const connection = instance.getConnection();
  if (!connection) {
    vscode.window.showErrorMessage('Not connected to IBM i');
    return;
  }

  const connectionName = connection.currentConnectionName;

  const library = await vscode.window.showInputBox({
    prompt: 'Library name',
    value: defaults.library || 'QGPL',
    placeHolder: 'MYLIB',
    validateInput: (value) => {
      if (!/^[A-Z#@$][A-Z0-9#@$]{0,9}$/i.test(value)) {
        return 'Invalid library name';
      }
      return undefined;
    }
  });
  if (!library) return;

  const sourceFile = await vscode.window.showInputBox({
    prompt: `Source file name in ${library}`,
    value: defaults.sourceFile || 'QRPGLESRC',
    placeHolder: 'QRPGLESRC',
    validateInput: (value) => {
      if (!/^[A-Z#@$][A-Z0-9#@$]{0,9}$/i.test(value)) {
        return 'Invalid source file name';
      }
      return undefined;
    }
  });
  if (!sourceFile) return;

  const member = await vscode.window.showInputBox({
    prompt: `Member name in ${library}/${sourceFile}`,
    value: defaults.member || '',
    placeHolder: 'MYPGM',
    validateInput: (value) => {
      if (!/^[A-Z#@$][A-Z0-9#@$]{0,9}$/i.test(value)) {
        return 'Invalid member name';
      }
      return undefined;
    }
  });
  if (!member) return;

  return {
    library: library.toUpperCase(),
    sourceFile: sourceFile.toUpperCase(),
    member: member.toUpperCase(),
    extension: defaults.extension || 'MBR'
  };
}
```

### 6. Upload with Provided Dates

**Note**: This requires modifying `ExtendedIBMiContent` class to support pre-determined dates rather than calculating them from a baseline.

```typescript
async function uploadMemberContentWithProvidedDates(
  uri: vscode.Uri,
  body: string,
  providedDates: string[]
) {
  // Similar to uploadMemberContentWithDates in extendedContent.ts
  // but skip the date calculation step and use providedDates directly

  const connection = instance.getConnection();
  if (!connection) return;

  const config = connection.getConfig();
  const { library, file, name } = connection.parserMemberPath(uri.path);
  const tempLib = "QTEMP";
  const alias = getAliasName(uri);
  const aliasPath = `${tempLib}.${alias}`;

  // Create alias
  await connection.runSQL(
    `CREATE OR REPLACE ALIAS ${aliasPath} for "${library}"."${file}"("${name}")`
  );

  // Get record length
  const recordLength = await getRecordLength(aliasPath, library, file);

  const sourceData = body.split('\n');
  const decimalSequence = sourceData.length >= 10000;

  let rows = [];
  for (let i = 0; i < sourceData.length; i++) {
    const sequence = decimalSequence ? ((i + 1) / 100) : i + 1;
    const line = sourceData[i].trimEnd();
    const truncatedLine = line.length > recordLength ?
      line.substring(0, recordLength) : line;
    const date = providedDates[i] || '000000';

    rows.push(
      `(${sequence}, ${date.padEnd(6, '0')}, '${escapeString(truncatedLine)}')`,
    );
  }

  // Build SQL INSERT statements (chunk to avoid length limits)
  const tempTable = `QTEMP.NEWMEMBER`;
  const query: string[] = [
    `CREATE OR REPLACE TABLE ${tempTable} LIKE "${library}"."${file}" ON REPLACE DELETE ROWS;`,
  ];

  const rowLength = recordLength + 55;
  const perInsert = Math.floor(400000 / rowLength);
  const rowGroups = sliceUp(rows, perInsert);

  rowGroups.forEach(rowGroup => {
    query.push(`INSERT INTO ${tempTable} VALUES ${rowGroup.join(',')};`);
  });

  query.push(
    `CALL QSYS2.QCMDEXC('CLRPFM FILE(${library}/${file}) MBR(${name})');`,
    `INSERT INTO ${aliasPath} (SELECT * FROM ${tempTable});`
  );

  // Write SQL to temp file and execute via RUNSQLSTM
  const tempRemote = connection.getTempRemote(library + file + name);
  const tempRmt = Tools.ensureFullPath(tempRemote, config.homeDirectory);
  const tmpobj = await tmpFile();

  await writeFileAsync(tmpobj, query.join('\n'), 'utf8');
  await connection.client!.putFile(tmpobj, tempRmt);

  // Handle CCSID conversion if needed
  const sourceCcsid = await connection.getFileCcsid({ library, name: file, member: name });
  const {requiresConversion, targetCcsid} = Tools.determineCcsidConversion(sourceCcsid, config);

  if (requiresConversion) {
    await connection.runSQL(
      `@QSYS/CPY OBJ('${tempRmt}') TOOBJ('${tempRmt}') TOCCSID(${targetCcsid}) DTAFMT(*TEXT) REPLACE(*YES)`
    );
  }

  const result = await connection.runCommand({
    command: `QSYS/RUNSQLSTM SRCSTMF('${tempRmt}') COMMIT(*NONE) NAMING(*SQL)`,
    noLibList: true
  });

  if (result.code !== 0) {
    throw new Error(`Failed to upload member: ${result.stderr}`);
  }

  await connection.clearTempRemote(library + file + name);
}
```

## Benefits

1. **Preserves Change History**: Source dates survive round-trip to local files
2. **Version Control Friendly**: Can commit members to Git with date information
3. **Smart Detection**: Automatically determines correct upload method
4. **User-Friendly Defaults**: Intelligently derives library/file/member from file path
5. **Backward Compatible**: Files without dates still work with standard upload

## Considerations

### Potential False Positives

Some legitimate source code might start with 6 digits:
```rpgle
241231C                   EVAL X = 1
```

**Mitigation**: Could add optional magic header for explicit format identification:
```
@@IBMI-SRCDAT@@
230601D/Main C                   Eval
230615D/Main C                   Return
```

However, the "all lines" detection rule makes false positives unlikely in practice.

### Date Format Ambiguity

YYMMDD format is IBM i standard but Y2K-style ambiguous (which century?).

**Accepted**: This matches IBM i's own format. The extension doesn't interpret dates semantically, just preserves them.

### Record Length Handling

Local file lines might exceed source file SRCDTA length.

**Handled**: The upload logic already truncates to record length (see existing `uploadMemberContentWithDates` implementation).

### CCSID/Character Set

Local files are UTF-8, IBM i uses EBCDIC variants.

**Handled**: Existing CCSID conversion logic applies (`determineCcsidConversion`, `CPY` with TOCCSID).

## Files to Modify/Create

### New Files
- `src/commands/memberDateTransfer.ts` - Main implementation
- Test files for the new functionality

### Modified Files
- `src/filesystems/qsys/extendedContent.ts` - Add `uploadMemberContentWithProvidedDates` method
- `src/ui/views/objectBrowser.ts` - Add "Download with dates" menu item
- `package.json` - Register new commands and menu contributions

## Testing Checklist

- [ ] Download member with dates enabled
- [ ] Download member with dates disabled (should show error)
- [ ] Upload dated file - verify dates preserved
- [ ] Upload non-dated file - verify standard upload works
- [ ] Upload with incorrect library/file - verify error handling
- [ ] Upload with CCSID conversion needed
- [ ] Upload with very long lines (truncation test)
- [ ] Upload with special characters requiring escaping
- [ ] Path derivation with various folder structures
- [ ] Extension-to-source-file mapping
- [ ] User cancels upload prompt - verify cleanup

## Future Enhancements

1. **Batch Operations**: Download/upload multiple members at once
2. **Metadata File**: Store library/file info in separate `.meta` file
3. **Custom Format**: User-configurable date format (e.g., ISO 8601)
4. **Git Integration**: Auto-strip dates for cleaner diffs
5. **Sequence Number Support**: Also preserve SRCSEQ column

## References

- Existing download commands: [objectBrowser.ts#L438](src/ui/views/objectBrowser.ts#L438) (`downloadMembersStructuredImpl`)
- Upload with dates: [extendedContent.ts#L105](src/filesystems/qsys/extendedContent.ts#L105) (`uploadMemberContentWithDates`)
- Upload without dates: [IBMiContent.ts#L266](src/api/IBMiContent.ts#L266) (`uploadMemberContent`)
- QSysFS decision logic: [QSysFs.ts#L223](src/filesystems/qsys/QSysFs.ts#L223)
