export function getSource_objattr(targetLibrary: string, version: number): string {
    const functionLibrary = targetLibrary.trim().toUpperCase();

    return /* sql */`
 -- Get Object Attributes
 -- @author BobCozzi

CREATE or REPLACE FUNCTION ${functionLibrary}.OBJ_ATTR(
                    PATH_NAME VARCHAR(4096) CCSID 1208 DEFAULT NULL,
                    LIBRARY_NAME varchar(10) DEFAULT '*LIBL',
                    OBJECT_NAME varchar(10) DEFAULT NULL,
                    OBJTYPE  varchar(10) DEFAULT '*FILE',
                    MBR_NAME varchar(10)  DEFAULT NULL,
                    -- Convert path_name to upper/lower case?
                    cvtOption VARCHAR(10) DEFAULT 'NO'
)
RETURNS table (
    created_Date timeStamp(0),  -- Creation timestamp
    access_Date date, -- Last accessed Date
    changed_Date timestamp(0), -- Last Changed
    data_changed_date timestamp(0), -- Last DataChanged
    last_used date,
    last_used_days int,
    last_used_reset date,
    Allocate_size bigint,
    data_size bigint,
    object_CCSID int,
    OBJTEXT VARCHAR(50) CCSID 1208,

    ASP_Nbr SMALLINT,
    ASP_Name VARCHAR(10),

    LIBNAME VARCHAR(10),
    OBJNAME VARCHAR(10),
    OBJTYPE VARCHAR(10),

    MBRNAME VARCHAR(10),
    SRCTYPE VARCHAR(10),
    RCDCOUNT BIGINT,
    SRCCHGDATE TIMESTAMP(0),
    MBRCHGDATE TIMESTAMP(0),
    MBREXPDATE DATE
)
LANGUAGE RPGLE
NO SQL
NO FINAL CALL
NOT DETERMINISTIC
DISALLOW PARALLEL
SCRATCHPAD 16
SPECIFIC ${functionLibrary}.OBJ_ATTR
EXTERNAL NAME '${functionLibrary}/OBJ_ATTR'
CARDINALITY 1
PARAMETER STYLE DB2SQL;

LABEL on specific routine ${functionLibrary}.OBJ_ATTR IS
'${version} - Retrieve Object Attributes';

COMMENT ON Specific FUNCTION ${functionLibrary}.OBJ_ATTR  IS
 '${version} - Retrieve Object Attributes for a given object
 or member in a database file. @author BobCozzi';

comment on parameter SPECIFIC FUNCTION ${functionLibrary}.OBJ_ATTR
 ( library_NAME IS 'The library name containing the object whose
  attributes are to be received. If the OBJECT_NAME parameter is
  null or empty, then this parameter is ignored.',

  OBJECT_NAME IS 'The name of the object whose attributes are returned.
  This parameter may be a valid IBM i Db2 object Name, or it may
  be NULL or blank/empty. When this parameter is empty, the
  LIBRARY_NAME and MBR_NAME parameters are ignored. In this case,
  The PATH_NAME parameter must contain a valid /QSYS.LIB object name.',

  OBJTYPE IS 'The type of object specified on the OBJECT_NAME parameter.
  Any of the valid IBM i system object types, such as *FILE, *PGM, *SRVPGM
  may be specified. The leading asterisk and upper/lower case is ignored.',

  MBR_NAME IS 'The name of the member whose attributes are returned.
  This parameter is ignored for non-FILE objects.
  NOTE: When the MBR_NAME is omited for a *FILE object, then the
  object attributes returned are for the *FILE object.
  When the MBR_NAME is specified, the atributes returned are for
  the member.',

   PATH_NAME IS 'Specifies the /QSYS.LIB object names whose attributes are
   to be returned. The path name must be a valid /QSYS.LIB object symbolic
   name or an IFS file name. When the /QSYS.LIB path name is a .FILE name,
   then a valid member name may be optionally specified. For example, a
   full, valid member name would look something like this:
   /QSYS.LIB/SQLTOOLS.lib/QRPGLESRC.File,JOB_ATTR.mbr
   When this parameter is specified, then the LIBRARY_NAME, FILE_NAME,
   and MBR_NAME parameters are ignored.',

  CVTOPTION IS 'Controls whether to convert the PATH_NAME letter case.
   Conversion to all upper or all lower case may be requested.
   The default ''NO'' indicates that the path name is used as specified.
   When ''YES'' or ''UPPER'' is specified, the path is converted to upper case.
   When ''LOWER'' is specified, the path is converted to lower case.
   When ''NO'' or ''NONE'' is specified (the default) the path_name parameter
   value is used as specified.'
 );
`;
}