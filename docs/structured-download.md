# Structured Download

## Overview

**Structured Download...** is a context menu submenu available in the Object Browser that downloads IBM i source members to a local folder, organizing them into subfolders that reflect the IBM i QSYS hierarchy. Two layout options are provided to suit different project setups.

This is particularly useful when migrating IBM i source into a Git repository, as it produces a folder layout that is ready for version control.

## How to Use

1. In the **Object Browser**, right-click one of the following:
   - A **source physical file (SPF)** — downloads all members in that file
   - One or more **source members** — downloads the selected members
2. Hover over **Structured Download...** to reveal the submenu
3. Choose a layout option:
   - **Library → File → Member** — full structure including the library as a top-level folder
   - **File → Member** — omits the library folder (ideal for single-library projects)
4. Choose a **base download folder** on your local machine when prompted
5. Subfolders and files are created automatically

## Layout Options

### Library → File → Member

Use this when downloading from multiple libraries, or when you want the full IBM i path preserved locally.

Given IBM i source in `DEVLIB`:

```
DEVLIB
├── QRPGLESRC
│   ├── PROGRAMA.RPGLE
│   ├── PROGRAMB.RPGLE
│   └── PROGRAMC.RPGLE
├── QCLLESRC
│   └── STARTJOB.CLLE
├── QCMDSRC
│   └── STARTJOB.CMD
└── QSQLSRC
    ├── CUSTOMERS.SQL
    └── INVENTORY.SQL
```

After choosing `~/myproject` as the base download folder:

```
~/myproject/
└── DEVLIB/
    ├── QRPGLESRC/
    │   ├── PROGRAMA.RPGLE
    │   ├── PROGRAMB.RPGLE
    │   └── PROGRAMC.RPGLE
    ├── QCLLESRC/
    │   └── STARTJOB.CLLE
    ├── QCMDSRC/
    │   └── STARTJOB.CMD
    └── QSQLSRC/
        ├── CUSTOMERS.SQL
        └── INVENTORY.SQL
```

### File → Member

Use this when your project lives in a single library and you want the source files to sit directly inside your project folder — for example, a project folder named `Pickles` that should contain `QRPGLESRC/`, `QCLLESRC/`, etc. directly.

Same IBM i source, with `~/Pickles` as the base download folder:

```
~/Pickles/
├── QRPGLESRC/
│   ├── PROGRAMA.RPGLE
│   ├── PROGRAMB.RPGLE
│   └── PROGRAMC.RPGLE
├── QCLLESRC/
│   └── STARTJOB.CLLE
├── QCMDSRC/
│   └── STARTJOB.CMD
└── QSQLSRC/
    ├── CUSTOMERS.SQL
    └── INVENTORY.SQL
```

#### Collision handling

If members from **different libraries** share the same `FILE/MEMBER.EXT` path, silently overwriting one with the other would result in data loss. Instead, those specific members automatically fall back to the full `LIBRARY/FILE/MEMBER.EXT` structure, and a warning notification identifies the collisions. All non-colliding members still use the flat `FILE/MEMBER` layout.

## Comparison to "Download..."

| | Download... | Structured Download → Library→File→Member | Structured Download → File→Member |
|---|---|---|---|
| Single member | Save-as dialog | `LIBRARY/FILE/MEMBER.EXT` | `FILE/MEMBER.EXT` |
| Multiple members | All files flat in one folder | Full `LIBRARY/FILE/` tree | `FILE/` tree (library omitted) |
| Best for | Quick one-off save | Multi-library or full-archive download | Single-library Git project setup |

## Notes

- The base download folder you select is remembered as the default for future downloads
- If a member's source type is blank, the file extension defaults to `.MBR`
- All library, file, and member names are written in **uppercase**
- Subfolders are created automatically if they do not already exist
- Source change dates (SEU sequence/date columns) are **not** preserved — the recommended approach for change management going forward is **Git**

## Intended Workflow

```
IBM i source members
        │
        │  Structured Download...
        │  (choose Library→File→Member or File→Member)
        ▼
Local project folder
        │
        │  git init  (or clone into that folder)
        ▼
Git repository with IBM i source structure
        │
        │  edit locally, deploy back with Code for IBM i
        ▼
IBM i (compile from IFS or deploy back to source members)
```

For further reading on local development and Git workflows with IBM i, see the
[Code for IBM i documentation](https://codefori.github.io/docs/developing/local/getting-started/).
