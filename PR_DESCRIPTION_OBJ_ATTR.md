# OBJ_ATTR SQL UDTF

This PR adds a new managed SQL UDTF component named `OBJ_ATTR` that exposes IBM i object and member metadata through a standard table function. It is designed to surface information available from `Qp0lGetAttr` and related APIs in a SQL-friendly format so object-level and member-level attributes can be queried directly without custom API logic for each lookup.

The function supports both direct object-name/library access and UTF-8 `/QSYS.LIB/...` path-based object names. It can return metadata for a file, library object, or member when supplied as a path or as explicit parameters.

## Input parameters

- `LIBRARY_NAME` varchar(10) default `*LIBL`
  - Library containing the object.
- `OBJECT_NAME` varchar(10) default `NULL`
  - Object name to inspect. May be blank or omitted when `PATH_NAME` is supplied.
- `OBJTYPE` varchar(10) default `*FILE`
  - Object type, such as `*FILE`, `*PGM`, `*SRVPGM`, and so on.
- `MBR_NAME` varchar(10) default `NULL`
  - Member name. When set for a file, metadata for the member is returned.
- `PATH_NAME` varchar(4096) CCSID 1208 default `NULL`
  - Full UTF-8 `/QSYS.LIB/...` object path or IFS path. When supplied, it takes precedence over the direct-name parameters.
- `CVTOPTION` varchar(10) default `NO`
  - Controls whether the path is converted to upper or lower case before lookup. The default is `NO`, so the path is used as-is unless a conversion is explicitly requested.

## Output columns

- `created_Date` timestamp(0)
  - Object creation date/time.
- `access_Date` timestamp(0)
  - Last access time.
- `changed_Date` timestamp(0)
  - Last modified/changed time.
- `data_changed_date` timestamp(0)
  - Last data-change time.
- `last_used` timestamp(0)
  - Last-used time from usage information.
- `last_used_days` int
  - Days since last use.
- `last_used_reset` timestamp(0)
  - Last reset time for use tracking.
- `Allocate_size` bigint
  - Allocated storage size.
- `data_size` bigint
  - Data size.
- `object_CCSID` int
  - CCSID of the object.
- `ASP_Nbr` smallint
  - ASP number.
- `OBJTEXT` varchar(50) CCSID 1208
  - Object text description.
- `LIBNAME` varchar(10)
  - Library name.
- `OBJNAME` varchar(10)
  - Object name.
- `OBJTYPE` varchar(10)
  - Object type.
- `MBRNAME` varchar(10)
  - Member name, if requested.
- `SRCTYPE` varchar(10)
  - Member source type, when applicable.
- `ASPNAME` varchar(10)
  - ASP name.

## Example usage

```sql
SELECT *
FROM TABLE(sqltools.OBJ_ATTR(
  LIBRARY_NAME => '*LIBL',
  OBJECT_NAME  => 'QRPGLESRC',
  OBJTYPE      => '*FILE',
  MBR_NAME     => 'MYPGM'
)) AS x;
```

```sql
SELECT *
FROM TABLE(sqltools.OBJ_ATTR(
  PATH_NAME => '/QSYS.LIB/MYLIB.LIB/QRPGLESRC.FILE/MYPGM.MBR',
  CVTOPTION => 'NO'
)) AS x;
```

## Implementation note

The SQL template intentionally keeps the `sqltools` schema/library name as a placeholder in source form. During installation, the component writes the generated script to the target temp library and replaces the placeholder with the active library name via the install-time builder function. This preserves the source template while ensuring the routine is created in the correct library and schema for the connected IBM i environment.

## Why this matters

This UDTF makes it easy to query object and source-member metadata from SQL in a consistent, reusable way. It is especially useful for IDE tooling, metadata inspection, and diagnostics where the caller needs object-level or member-level attributes without hand-rolling API calls or parsing raw IBM i metadata structures.
