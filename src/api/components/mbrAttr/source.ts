export const MBR_ATTR_RPGLE_SOURCE = `**free

// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 by R. Cozzi, Jr.


  // @author BobCozzi

    ////////////////////////////////////////////////////////////////////////
    // IBM i Retrieve Member Description Attributes
    // This is an SQL UDTF External Program
    // It uses the QUSRMBRD API to retreive a Source Member's attributes
    // This information is currently not available via QSYS2 SQL functions
    ////////////////////////////////////////////////////////////////////////
    // This is part of the collection of open source SQL UDTFs that are
    // primarily built for the VS CODE and CODE for IBM i IDE, however
    // they can certainly be feely used in production environments on IBM i
    // Available on github at:  https://github.com/bobcozzi/open-UDTF
    ////////////////////////////////////////////////////////////////////////

ctl-opt   main(main) OPTION(*SRCSTMT);

/if defined(*CRTBNDRPG)
ctl-opt DFTACTGRP(*NO) ACTGRP(*CALLER);
/endif

          // Use the PSDS to obtain "this" Program's name
dcl-ds psds psds qualified;
     pgmname *proc;
end-ds;

          // SQL UDF Stuff
dcl-c SQL_FETCH 0;
dcl-c SQL_OPEN -1;
dcl-c SQL_CLOSE 1;

          // Standardized API exception/error struct for APIs
dcl-ds QUSEC_t Qualified Template;
     bytes_Provided  int(10) inz(%size(QUSEC_T));
     bytes_Available INT(10);
     bytes_RTN       int(10) overlay(bytes_available);
     bytes_returned  int(10) overlay(bytes_available);
     bytesReturned   int(10) overlay(bytes_available);
     exception_Id    char(7);
     msgid           char(7) overlay(exception_id);
     reserved        char(1);
     msgdata         char(64);
end-ds;

dcl-pr QUSRMBRD EXTPGM('QUSRMBRD');
     rtnMBRINFO char(1024) OPTIONS(*VARSIZE);
     rtnMbrInfoSize int(10) Const;
     APIFORMAT  char(8) Const;
     FileLib    char(20) Const;
     MbrName    char(10) Const;
     OVR        char(1)  Const;
     apiError  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
     FindMbr    char(1)  Const OPTIONS(*NOPASS);
end-pr;

dcl-pr cvthc  extProc('cvthc');
     outHexVal  char(65534) OPTIONS(*VARSIZE);
     inCharVal char(32766) OPTIONS(*VARSIZE)  CONST;
     hexLen int(10) Value;
end-pr;
          // Convert to char from hex MI inst.
dcl-pr cvtch  extProc('cvtch');
     outCharVal char(32766) OPTIONS(*VARSIZE);
     inHexVal  char(65534) OPTIONS(*VARSIZE) CONST;
     hexLen int(10) Value;
end-pr;


            // Converted from: <QSYSINC/H/QUSRMBRD>
dcl-ds Qdb_Mbrd0200_T  Qualified Inz TEMPLATE;
     Bytes_Returned INT(10);
     Bytes_Available INT(10);
     Db_File_Name CHAR(10);
     Db_File_Lib CHAR(10);
     Member_Name CHAR(10);
     File_Attr CHAR(10);
     Src_Type CHAR(10);
     Crt_Date CHAR(13);
     Src_Change_Date CHAR(13);
     Text_Desc CHAR(50);
     Src_File CHAR(1);
               // END of MBRD0100
               // MBRD0200 continues
     Ext_File CHAR(1);
     Log_File CHAR(1);
     Odp_Share CHAR(1);
     Reserved CHAR(2);
     Num_Cur_Rec INT(10);
     Num_Dlt_Rec INT(10);
     Dat_Spc_Size INT(10);
     Acc_Pth_Size INT(10);
     Num_Dat_Mbr INT(10);
     Change_Date CHAR(13);
     Save_Date CHAR(13);
     Rest_Date CHAR(13);
     Exp_Date CHAR(7);
     Reserved6 CHAR(4);
     Media_preference INT(5);
     Nbr_Days_Used INT(10);
     Date_Lst_Used CHAR(7);
     Use_Reset_Date CHAR(7);
     Reserved1 CHAR(2);
     Data_Spc_Sz_Mlt INT(10);
     Acc_Pth_Sz_Mlt INT(10);
     Member_Text_Ccsid INT(10);
     Offset_Add_Info INT(10);
     Length_Add_Info INT(10);
     Num_Cur_Rec_U UNS(10);
     Num_Dlt_Rec_U UNS(10);
     Reserved2 CHAR(6);
end-ds;  // Qdb_Mbrd0200_T



dcl-proc main ;
     dcl-pi main EXTPGM('MBR_ATTR');

               // Input parameters
          inLIBNAME VARCHAR(10) const;
          inSRCFILE VARCHAR(10) const;
          inSRCMBR  VARCHAR(10) const;

          inOVR     VARCHAR(10) const;
          inFIND    VARCHAR(10) const;
          inDETAILS VARCHAR(10) const;


          // Output Columns
          outOBJLIB    varchar(10);
          outOBJNAME   varchar(10);
          outMBRNAME   varchar(10);
          outSRCTYPE   varchar(10);
          outFILEATTR  varchar(10);   //PF, LF, DDMF
          outTEXT      varchar(50);   //Mbr Text description
          outCreated timeStamp(0);  //Date/Time member was added to
          outLast_Source_Changed timeStamp(0); //Last Changed dts

          //  Begin detailed_info=>'FULL' | 'YES' columns
          outRecord_Count INT(20);         //Current record count
          outDeleted_Count INT(20); //Deleted Records count

          outEXPDATE   date;          //Member Expiration Date
          outLastUsed_Days int(10);          //Days since last used
          outLastUsed_Date date;          //Is_Logical View *LGL or *PHY *DDMF
          outLastUsed_Reset date;
          outObject_Changed timestamp;   //Object Changed date

               // Input indicators
          indy_inLIBNAME int(5);
          indy_inSRCFILE int(5);
          indy_inSRCMBR  int(5);

          indy_inOVR     int(5);
          indy_inFIND    int(5);
          indy_inDETAILS int(5);

               // Output Column Indicators
        // Output Columns
          indy_OBJLIB    int(5);
          indy_OBJNAME   int(5);
          indy_MBRNAME   int(5);
          indy_SRCTYPE   int(5);
          indy_FILEATTR  int(5);
          indy_TEXT      int(5);
          indy_created int(5);
          indy_Last_Source_Changed int(5);

          //  Begin detailed_info=>'FULL' | 'YES' columns
          indy_Record_count int(5);
          indy_Deleted_Count int(5);
          indy_EXPDATE   int(5);
          indy_LastUsed_Days int(5);
          indy_LastUsed_Date int(5);
          indy_LastUsed_Reset int(5);
          indy_Object_Changed int(5);

               // Standard DB2SQL scratchpad/diagnostic fields
          outSQLSTATE   CHAR(5);
          inFuncName    VARCHAR(517) CONST;  // Function name
          inSpecName    VARCHAR(128) CONST;  // Specific function name
          outSQLMSG     VARCHAR(70);
          inSQLOpCode   INT(10) CONST; // -1=Open, 0=Fetch, 1=Close
     end-pi;

     // Local API error info and returned member buffer
     dcl-ds ec likeDS(qusec_t) inz(*LIKEDS);

     dcl-ds BUFFER likeds(Qdb_Mbrd0200_T) static;
     dcl-s  BUFFER_SIZE int(10) inz(%SIZE(BUFFER));
     dcl-s  APIFMT CHAR(8) INZ('MBRD0100');
     dcl-c  API200 Const('MBRD0200');
     dcl-s  Counter int(10) inz(0) static;
     dcl-s  fileName CHAR(20);
     dcl-s  mbrName CHAR(10) INZ('*FIRST');
     dcl-s  OVRMBR  CHAR(1) INZ('1');
     dcl-s  FINDMBR CHAR(1) INZ('1');
     dcl-s  DETAILS CHAR(1) INZ('0') static;


     // OPEN: normalize inputs and call QUSRMBRD once
     IF (inSQLOpCode = SQL_OPEN);  // Open?
          counter = 0;
          reset DETAILS;
          clear buffer;

          // Build FILE(LIB) argument with defaults and case handling
          if (indy_inLIBNAME < 0 or inLIBNAME = ' ' or
                         %SUBST(inLIBNAME:1:1) = X'00');
               %SUBST(FILENAME : 11 : 10) = '*LIBL';
          else;
               %SUBST(FILENAME : 11 : 10) = %UPPER(inLIBNAME);
          endif;
          if (indy_inSRCFILE > 0);
               if (%SUBST(inSRCFILE : 1 : 1) <> '"');
                    %SUBST(FILENAME : 1 : 10) = %UPPER(inSRCFILE);
               else;
                    %SUBST(FILENAME : 1 : 10) = inSRCFILE;
               endif;
          else;
               snd-msg %trimR(psds.pgmname) + 'err: The FILE_NAME (source file) +
                                             parameter is required.';
               outSQLSTATE = '38701';
               return;
          endif
               if (indy_inSRCMBR >= 0 and inSRCMBR <> ' ' and
                         %SUBST(inSRCMBR:1:1) <> X'00');
          if (%SUBST(inSRCMBR : 1 : 1) <> '"');
               MBRNAME = %UPPER(inSRCMBR);
          else;
               MBRNAME = inSRCMBR;
          endif;
     else;
          MBRNAME = '*FIRST';
     endif;

          // Normalize override-member option to API flag 0/1
     if (indy_inOVR < 0 or inOVR = ' ' or
                         %SUBST(inOVR:1:1) = X'00');
          OVRMBR = '1'; // default to Yes
     else;
          OVRMBR = %UPPER(%TRIML(inOVR : '*'));
          if (OVRMBR in %LIST('Y' : '1'));
               OVRMBR = '1';
          else;
               OVRMBR = '0';
          endif;
     endif;

          // Normalize find-member option to API flag 0/1
     if (indy_inFIND < 0 or inFIND = ' ' or
                         %SUBST(inFIND:1:1) = X'00');
          FINDMBR = '1'; // default to Yes
     else;
          FINDMBR = %UPPER(%TRIML(inFIND : '*'));
          if (FINDMBR in %LIST('Y' : '1'));
               FINDMBR = '1';
          else;
               FINDMBR = '0';
          endif;
     endif;

          // Select basic or detailed API format
     if (indy_inDETAILS < 0 or inDETAILS = ' ' or
                         %SUBST(inDETAILS:1:1) = X'00');
          DETAILS = '0'; // default to no
     else;
          DETAILS = %UPPER(%TRIML(inDETAILS : '*'));
          if (DETAILS in %LIST('Y' : '1' : 'F'));
               DETAILS = '1';
          else;
               DETAILS = '0';
          endif;
     endif;
     if (DETAILS = '1');
          APIFMT = API200;
     endif;

          // Retrieve member attributes from QUSRMBRD
     QUSRMBRD( BUFFER : BUFFER_size : APIFMT : fileName : mbrName :
                         OVRMBR : ec : FINDMBR);

          // Surface API/empty-buffer failures back to SQL runtime
     if (ec.bytes_returned > 0);
          snd-msg %TRIMR(psds.pgmname) + ' QUSRMBRD err ' + ec.msgid;
          outSQLSTATE = '38701';
          return;
     endif;
     if (buffer.Bytes_Returned = 0);
          snd-msg %TRIMR(psds.pgmname) + 'Returned no information.';
          outSQLSTATE = '38701';
          return;
     endif;


endif;

     // FETCH: return one row from static buffer, then EOF
IF (inSQLOpCode = SQL_FETCH);  // Fetch?
     if (counter > 0);
          outSQLState = '02000';
          return;
     endif;

     counter += 1;

          // Map common output columns
     outOBJLIB  = buffer.Db_File_Lib;
     outOBJNAME  = buffer.Db_File_Name;
     outMBRNAME  = buffer.Member_Name;

     outSRCTYPE  = buffer.Src_Type;
     outFILEATTR = buffer.File_Attr;
     outTEXT     = buffer.Text_Desc;
     monitor;
          outCreated = %TimeStamp(
              %DATE(%SUBST(buffer.Crt_Date : 1 : 7) : *CYMD0)  +
              %TIME(%SUBST(buffer.Crt_Date : 8 : 6) : *HMS0));
     on-error;
          indy_created = -1;
     endmon;
     monitor;
          outLast_Source_changed = %TimeStamp(
              %DATE(%SUBST(buffer.Src_Change_Date : 1 : 7) : *CYMD0)  +
              %TIME(%SUBST(buffer.Src_Change_Date : 8 : 6) : *HMS0));
     on-error;
          indy_Last_Source_changed = -1;
     endmon;

          // Map optional detailed columns when requested
     if (DETAILS = '1');
          monitor;
               outObject_Changed = %TimeStamp(
               %DATE(%SUBST(buffer.Change_Date : 1 : 7) : *CYMD0)  +
               %TIME(%SUBST(buffer.Change_Date : 8 : 6) : *HMS0));
          on-error;
               indy_Object_Changed = -1;
          endmon;

          outRecord_Count = buffer.Num_Cur_Rec_U;
          outDeleted_Count = buffer.Num_Dlt_Rec_U;
          monitor;
               outEXPDATE = %DATE( buffer.Exp_Date : *CYMD0);
          on-error;
               indy_EXPDATE = -1;
          endmon;

          outLASTUSED_DAYS = buffer.Nbr_Days_Used;
          monitor;
               outLASTUSED_DATE = %DATE(buffer.Date_Lst_Used: *CYMD0);
          on-error;
               indy_LASTUSED_DATE = -1;
          endmon;
          monitor;
               outLASTUSED_RESET = %DATE(buffer.Use_Reset_Date : *CYMD0);
          on-error;
               indy_LASTUSED_RESET = -1;
          endmon;
     endif;
endif;




     // CLOSE: no state cleanup required
if (inSQLOpCode = SQL_CLOSE);  // Close
       // Nothing to do here.
endif;

end-proc;
`;

export const MBR_ATTR_SQL_TEMPLATE = `
 -- Member Description Information

-- SPDX-License-Identifier: Apache-2.0
-- Copyright (c) 1996-2026 by R. Cozzi, Jr.

-- @author BobCozzi


CREATE or REPLACE FUNCTION sqltools.mbr_attr(
                                  LIBRARY_NAME varchar(10) DEFAULT '*LIBL',
                                  FILE_NAME varchar(10),
                                  MBR_NAME varchar(10)  default '*FIRST',
                                  OVR_MBR varchar(10)  default 'YES',
                                  FIND_MBR  varchar(10)  default 'YES',
                                  DETAILED_INFO varchar(10)  default 'NO'
                                           )
       RETURNS table (
          -- Begin detailed_info=>'BASIC' | 'NO' columns
            OBJLIB    varchar(10),
            OBJNAME   varchar(10),
            MBRNAME   varchar(10),
            SRCTYPE   varchar(10),
            FILEATTR  varchar(10),   -- PF, LF, DDMF
            TEXT      varchar(50),   -- Mbr Text description
            create_timestamp timeStamp(0),  -- Date/Time member was added
            Last_Source_change_timestamp timestamp(0), -- Last Changed

          -- Begin detailed_info=>'FULL' | 'YES' columns
            Record_count BIGINT,         -- Current record count
            Deleted_Record_Count BIGINT, -- Deleted Records count
            EXPDATE   date,          -- Member Expiration Date
            Last_used_Days int,      -- Days since last used
            Last_used_Date date,     -- Last Used Date/Time
            Last_used_Reset_date date, -- Last used: Reset Date
            Object_Change_TimeStamp timestamp(0)   -- Object Changed timestamp
           )
       LANGUAGE RPGLE
       NO SQL
       NOT FENCED
       NOT DETERMINISTIC
       DISALLOW PARALLEL
       SPECIFIC sqlTools.mbr_attr
       CARDINALITY 1
       PARAMETER STYLE DB2SQL;


LABEL on specific routine sqltools.mbr_attr IS
'\${version} - Retrieve Source Member Description';

COMMENT ON Specific FUNCTION sqltools.mbr_attr  IS
 '\${version} - Retrieve Source Member Description returns the basic or
 advanced attributes for the specified Member name.';

comment on parameter SPECIFIC FUNCTION sqltools.mbr_attr
 ( library_NAME IS 'The library name containing the file that contains the
  member whose description is retrieved. The special values *LIBL or
  *CURLIB may be specified. If unspecified, *LIBL is used.
  Note upper/lower case is ignored, unless the name
  is enclosed in double-quotes.',


  FILE_NAME IS 'The name of the source file whose member attributes
  are returned.   Note upper/lower case is ignored, unless the name
  is enclosed in double-quotes.',

  MBR_NAME IS 'The name of the member whose attributes are returned.
  The special values *FIRST, *LAST may be specified in addition to
  a member name. If unspecified, *FIRST is used.
  Note upper/lower case is ignored, unless the name
  is enclosed in double-quotes.',

   OVR_MBR IS 'Specifies whether to respect or ignore overrides placed
   on the file. *YES or *NO or ''1'' or ''0'' may be specified.
   If unspecified, then *YES is used. Upper/lower case and the leading
   asterisk are ignored.',

   FIND_MBR IS 'Specifies whether to locate the member in the FILE_NAME
   on the library list when LIBRARY_NAME=>''*LIBL'' is specified.
   FIND_MBR=>''*YES'' or ''*NO'' or ''1'' or ''0'' may be specified.
   If unspecified, then *YES is used. Upper/lower case and the leading
   asterisk are ignored.'
 );
`;

export function buildMbrAttrSqlSource(targetLibrary: string, version: number): string {
    return MBR_ATTR_SQL_TEMPLATE
        .replace(/\$\{version\}/g, String(version))
        .replace(/\bsqltools\b/gi, targetLibrary.trim());
}
