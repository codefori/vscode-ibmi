export const OBJ_ATTR_RPGLE_SOURCE = `**FREE

    ////////////////////////////////////////////////////////////////////////
    // IBM i Retrieve Object Attributes
    // This is an SQL UDTF External Program
    // It uses the Qp0lGetAttr and other APIs to retreive an object attributes
    ////////////////////////////////////////////////////////////////////////
    // This is part of the collection of open source SQL UDTFs that are
    // primarily built for the VS CODE and CODE for IBM i IDE, however
    // they can be feely used in production environments on IBM i.
    // Available from @BobCozzi at: https://github.com/bobcozzi/open-UDTF
    ////////////////////////////////////////////////////////////////////////

ctl-opt   main(main) OPTION(*SRCSTMT);

/if defined(*CRTBNDRPG)
ctl-opt DFTACTGRP(*NO) ACTGRP(*CALLER);
/endif

         // Use the PSDS to obtain "this" Program's name
dcl-Ds psds psds qualified;
    Pgmname *proc;
end-Ds;

            // SQL UDF Stuff
dcl-C SQL_FETCH 0;
dcl-C SQL_OPEN -1;
dcl-C SQL_CLOSE 1;

            // Path case conversion option
dcl-c  TOUPPER 1;
dcl-c  TOLOWER 2;
dcl-c  NOCONVERT 0;


         // Convert to hex from char MI inst.
dcl-Pr cvthc extProc('cvthc');
    Outhexval char(65534) OPTIONS(*VARSIZE);
    inCharVal char(32766) OPTIONS(*VARSIZE)  CONST;
    Hexlen int(10) Value;
end-Pr;
         // Convert to char from hex MI inst.
dcl-Pr cvtch extProc('cvtch');
    Outcharval char(32766) OPTIONS(*VARSIZE);
    inHexVal  char(65534) OPTIONS(*VARSIZE) CONST;
    Hexlen int(10) Value;
end-Pr;

         // Qp0lGetAttr() API attribute selection constants
dcl-C QP0L_ATTR_OBJTYPE 0;
dcl-C QP0L_ATTR_DATA_SIZE 1;
dcl-C QP0L_ATTR_ALLOC_SIZE 2;
dcl-C QP0L_ATTR_EXTENDED_ATTR_SIZE 3;
dcl-C QP0L_ATTR_CREATE_TIME 4;
dcl-C QP0L_ATTR_ACCESS_TIME 5;
dcl-C QP0L_ATTR_CHANGE_TIME 6;
dcl-C QP0L_ATTR_MODIFY_TIME 7;
dcl-C QP0L_ATTR_STG_FREE 8;
dcl-C QP0L_ATTR_CHECKED_OUT 9;
dcl-C QP0L_ATTR_LOCAL_REMOTE 10;
dcl-C QP0L_ATTR_AUTH 11;
dcl-C QP0L_ATTR_FILE_ID 12;
dcl-C QP0L_ATTR_ASP 13;
dcl-C QP0L_ATTR_DATA_SIZE_64 14;
dcl-C QP0L_ATTR_ALLOC_SIZE_64 15;
dcl-C QP0L_ATTR_USAGE_INFORMATION 16;
dcl-C QP0L_ATTR_PC_READ_ONLY 17;
dcl-C QP0L_ATTR_PC_HIDDEN 18;
dcl-C QP0L_ATTR_PC_SYSTEM 19;
dcl-C QP0L_ATTR_PC_ARCHIVE 20;
dcl-C QP0L_ATTR_SYSTEM_ARCHIVE 21;
dcl-C QP0L_ATTR_CODEPAGE 22;
dcl-C QP0L_ATTR_FILE_FORMAT 23;
dcl-C QP0L_ATTR_UDFS_DEFAULT_FORMAT 24;
dcl-C QP0L_ATTR_JOURNAL_INFORMATION 25;
dcl-C QP0L_ATTR_ALWCKPWRT 26;
dcl-C QP0L_ATTR_CCSID 27;
dcl-C QP0L_ATTR_SIGNED 28;
dcl-C QP0L_ATTR_SYS_SIGNED 29;
dcl-C QP0L_ATTR_MULT_SIGS 30;
dcl-C QP0L_ATTR_DISK_STG_OPT 31;
dcl-C QP0L_ATTR_MAIN_STG_OPT 32;
dcl-C QP0L_ATTR_DIR_FORMAT 33;
dcl-C QP0L_ATTR_AUDIT 34;
dcl-C QP0L_ATTR_CRTOBJSCAN 35;
dcl-C QP0L_ATTR_SCAN 36;
dcl-C QP0L_ATTR_SCAN_INFO 37;
dcl-C QP0L_ATTR_ALWSAV 38;
dcl-C QP0L_ATTR_RSTDRNMUNL 39;
dcl-C QP0L_ATTR_JOURNAL_EXTENDED_INFORMATION 40;
dcl-C QP0L_ATTR_CRTOBJAUD 41;
dcl-C QP0L_ATTR_SYSTEM_USE 42;
dcl-C QP0L_ATTR_TEMPORARY 43;
dcl-C QP0L_ATTR_UDFS_TEMPORARY 44;
dcl-C QP0L_ATTR_UDFS_PREFERRED_STORAGE_UNIT 45;
dcl-C QP0L_ATTR_INHERIT_ALWCKPWRT 46;
dcl-C QP0L_ATTR_SYS_RESTRICTS_SAVE 47;
dcl-C QP0L_ATTR_TEXT  48;
dcl-C QP0L_ATTR_RESET_DATE 200;
dcl-C QP0L_ATTR_SUID 300;
dcl-C QP0L_ATTR_SGID 301;

         // Qp0lGetAttr()/Qp0lSetAttr() follow-symlink indicators
dcl-C QP0L_DONOT_FOLLOW_SYMLNK 0;
dcl-C QP0L_FOLLOW_SYMLNK 1;

         // Qp0lGetAttr() yes/no indicators
dcl-C QP0L_NO 0;
dcl-C QP0L_YES 1;

         // Qp0lGetAttr() storage-free indicators
dcl-C QP0L_SYS_NOT_STG_FREE 0;
dcl-C QP0L_SYS_STG_FREE 1;

         // Qp0lGetAttr() checked-out indicators
dcl-C QP0L_NOT_CHECKED_OUT 0;
dcl-C QP0L_CHECKED_OUT 1;

         // Qp0lGetAttr()/Qp0lSetAttr() PC attribute indicators
dcl-C QP0L_PC_NOT_READONLY 0;
dcl-C QP0L_PC_READONLY 1;
dcl-C QP0L_PC_NOT_HIDDEN 0;
dcl-C QP0L_PC_HIDDEN 1;
dcl-C QP0L_PC_NOT_SYSTEM 0;
dcl-C QP0L_PC_SYSTEM 1;
dcl-C QP0L_PC_NOT_CHANGED 0;
dcl-C QP0L_PC_CHANGED 1;

         // Qp0lGetAttr()/Qp0lSetAttr() system attribute indicators
dcl-C QP0L_SYSTEM_NOT_CHANGED 0;
dcl-C QP0L_SYSTEM_CHANGED 1;

dcl-C QLG_CHAR_SINGLE 0; // path is char and delimiter is 1 char;
dcl-C QLG_PTR_SINGLE 1; // path is ptr and delimiter is 1 char;
dcl-C QLG_CHAR_DOUBLE 2; // path is char and delimiter is 2 chars;
dcl-C QLG_PTR_DOUBLE 3; // path is ptr and delimiter is 2 char2;

dcl-C UTF8 1208;
dcl-S EpochTM timestamp inz(Z'1970-01-01-00.00.00');

dcl-pr errNo pointer extProc('__errno');
end-pr errNo;
dcl-pr strerror pointer extProc('strerror');
    errno int(10) Value;
end-pr;
dcl-s nErrNo int(10)  BASED(pErrNo);

         // Standardized API exception/error struct for APIs
dcl-Ds QUSEC_t Qualified Template;
    Bytes_Provided int(10) inz(%size(QUSEC_T));
    Bytes_Available INT(10);
    Bytes_RTN int(10) overlay(bytes_available);
    Bytes_returned int(10) overlay(bytes_available);
    BytesReturned int(10) overlay(bytes_available);
    Exception_Id char(7);
    Msgid char(7) overlay(exception_id);
    Reserved char(1);
    Msgdata char(64);
end-Ds;

dcl-DS Qp0l_AttrTypes_List_T Qualified Template Inz;
    Number_ofReqAttrs uns(10);
    Attrtype uns(10) Dim(31);
end-DS;

dcl-DS attr_type likedS(Qp0l_AttrTypes_List_T) Inz;
dcl-s fileSuffix varchar(20) inz('.FILE');
dcl-s utf8File varchar(20) ccsid(UTF8);
dcl-s utf8Path varchar(4096) ccsid(UTF8);
dcl-s utf8NullBlank CHAR(2) CCSID(1208) INZ(X'2000');
dcl-s cvtOpt char(1);
dcl-s isFile Ind inz(*OFF);
dcl-s textDesc varchar(80);

dcl-Ds Qlg_Path_Name_T Qualified Inz TEMPLATE;
    CCSID INT(10) Inz(UTF8);            // Use Unicode (UTF-16)
    Country_ID  char(2) inz(*allX'00');  // Use job country/region
    Language_ID char(3) inz(*allX'00'); // Use job language;
    Reserved CHAR(3) Inz(*ALLX'00');
    Path_Type UNS(10) Inz(QLG_PTR_SINGLE);
    Path_Length INT(10);
    Path_Name_Delimiter CHAR(2) inz(X'2F');
    Reserved2 CHAR(10) Inz(*ALLX'00');
    Ptr_PATH pointer inz(*NULL); // recommend using pointer to the path;
             // char_PATH_NAME char(4096); // 4k max char path name .
end-Ds; // Qlg_Path_Name_T;

dcl-ds Qp0l_Usage_t Qualified Inz TEMPLATE;
    dcl-subf resetDate uns(10);
    dcl-subf usedDate uns(10);
    dcl-subf usedDays uns(5);
    dcl-subf reserved1 char(6);
end-ds;

dcl-ds Qp0l_QSYS_Info_t Qualified Template Inz;
    Bytes_Returned uns(10);      // bytes actually returned to caller
    Bytes_Available uns(10);     // bytes total available
    CCSID_Out uns(10);           // CCSID of names and types returned
    Lib_Name char(28);           // Name of library
    Lib_Type char(20);           // Type of library
    Obj_Name char(28);           // Name of object
    Obj_Type char(20);           // Type of object
    Mbr_Name char(28);           // Name of member
    Mbr_Type char(20);           // Type of member
    Asp_Name char(28);           // Name of ASP
end-ds;

  // QUSRMBRD API Interfaces
    dcl-ds Qdb_Mbrd0100_T  Qualified Inz TEMPLATE;
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
    end-ds;


dcl-pr Qp0lCvtPathToQSYSObjName extProc('Qp0lCvtPathToQSYSObjName');
    Path_Name            likeds(Qlg_Path_Name_T) OPTIONS(*VARSIZE);
    rtnQSYSName          likeds(Qp0l_QSYS_Info_t) OPTIONS(*VARSIZE);
    apiFormat            char(8) const; // QSYS0100
    rtnBufferLen         uns(10) value;
    preferred_CCSID      uns(10) value;
    errorDs              LikeDS(QUSEC_T) OPTIONS(*VARSIZE);
end-pr;

dcl-Pr Qp0lGetAttr int(10) extproc('Qp0lGetAttr');
    Path_Name            likeds(Qlg_Path_Name_T) OPTIONS(*VARSIZE);
    Attr_Array           likeds(Qp0l_AttrTypes_List_t) OPTIONS(*VARSIZE);
    Buffer_ptr           char(32765) OPTIONS(*VARSIZE); // Returned parm;
    Buffer_Size          uns(10) value;
    Buffer_Size_Avail    uns(10); // Returned parm;
    Buffer_Size_Returned uns(10); // Returned parm;
    Follow_Symlnk        uns(10) value;
    moreParms char(10) options(*NOPASS:*VARSIZE);
end-Pr;

dcl-pr QUSRMBRD EXTPGM('QUSRMBRD');
     rtnMBRINFO char(1024) OPTIONS(*VARSIZE);
     rtnMbrInfoSize int(10) Const;
     APIFORMAT  char(8) Const;
     FileLib    char(20) Const;
     MbrName    char(10) Const;
     OVR        char(1)  Const;
     apiError   LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
     FindMbr    char(1)  Const OPTIONS(*NOPASS);
end-pr;


dcl-s  pRtnAttr pointer;
dcl-Ds rtnAttr likeDS(rtnAttr_T) based(pRtnAttr);
dcl-Ds rtnAttr_t Qualified Inz TEMPLATE;
    offset int(10);   // Offset to next attritube
    AttrId int(10);   // Attribute ID
    Attrlen int(10);  // Lenght of attribute data
    Reserved1 char(4);
    AttrData char(256);
    attrUTF8 char(100) CCSID(UTF8) Overlay(AttrData);  // UTF-8 CCSID(1208)
    attrFileID char(16) Overlay(AttrData);
    attrchar50 char(50) Overlay(AttrData);
    attrChar10 char(10) Overlay(AttrData);
    attrchar1 char(1) Overlay(AttrData);
    attrTime uns(10) Overlay(AttrData);
    attrint8 int(20) Overlay(AttrData);
    attrint4 int(10) Overlay(AttrData);
    attrint2 int(5) Overlay(AttrData);
    attruint8 uns(20) Overlay(AttrData);
    attruint4 uns(10) Overlay(AttrData);
    attruint2 uns(5) Overlay(AttrData);
    last_used Likeds(Qp0l_Usage_t) overlay(attrData);
end-Ds ;


     // SQL UDTF Scratch pad passed to this program
         // Note all Scratch pads have their defined length
         // as the first entry (first 4-byte int)
dcl-Ds scratch_t Qualified Template;
    Length int(10);  // Length of this Scratch Pad;
    eof    int(10);  // 1=EOF has been reached
    cvtCase int(5);  // 0=No, 1=Uppercase, 2=Lowercase
    reserved char(6);
end-Ds;
dcl-S scratch_len int(10);

  // NOTE: Need to use the SQL preprocessor just to support the LOB parmaeter
dcl-Proc main ;
    dcl-pi main EXTPGM('OBJ_ATTR');

             // Input parameters
        inPATH_NAME VARCHAR(4096) CCSID(UTF8) OPTIONS(*VARSIZE);
        // If above inPATH_NAME is empty or NULL, then the legacy
        // parmaeters are used to build the path name
        inLibname VARCHAR(10) const;
        inOBJNAME VARCHAR(10) const;
        inOBJTYPE VARCHAR(10) const;
        inMBRNAME VARCHAR(10) const;

            // Convert PATH_NAME to upper/lower case before using it?
        cvtOption VARCHAR(10) const;

        outCreated  TIMESTAMP(0);
        outAccessed TIMESTAMP(0);
        outCHANGED  TIMESTAMP(0);
        outData_CHANGED TIMESTAMP(0);
        outLast_USED    TIMESTAMP(0);
        outLast_USED_DAYS  INT(10);
        outLast_USED_RESET TIMESTAMP(0);
        outAlloc_SIZE  INT(20);  // BIGINT are signed, so <= UNS(20)
        outData_SIZE   INT(20);
        outccsid  INT(10);
        outASPNbr int(5);
        outText   VARCHAR(50) CCSID(UTF8);

        outLIBNAME VARCHAR(10);
        outOBJNAME VARCHAR(10);
        outOBJTYPE VARCHAR(10);
        outMBRNAME VARCHAR(10);
        outSRCTYPE VARCHAR(10);
        outASPNAME VARCHAR(10);

               // UDTF interface checklist (DB2SQL parameter style):
               // 1) Null indicators must be 2-byte (SMALLINT) -> RPG INT(5).
               // 2) Set indicator to -1 for NULL and 0 for NOT NULL.
               // 3) SQL SCRATCHPAD nnn and RPG scratch DS layout must stay aligned.
               // 4) Keep trailing DB2SQL parms order: SQLSTATE, function/specific,
               //    message, scratch, SQL opcode.

             // Input indicators
        indy_PATH_NAME int(5);

        indy_LIBNAME int(5);
        indy_OBJNAME int(5);
        indy_OBJTYPE int(5);
        indy_MBRNAME int(5);

        indy_cvtOption int(5);

        indy_outCREATED INT(5);
        indy_outACCESSED INT(5);
        indy_outCHANGED INT(5);
        indy_outDATA_CHANGED INT(5);
        indy_outLAST_USED INT(5);
        indy_outLAST_USED_DAYS INT(5);
        indy_outLAST_USED_RESET INT(5);
        indy_outALLOC_SIZE INT(5);
        indy_outDATA_SIZE INT(5);
        indy_outCCSID  INT(5);
        indy_outASPNbr INT(5);
        indy_outTEXT   INT(5);

        indy_outLIBNAME INT(5);
        indy_outOBJNAME INT(5);
        indy_outOBJTYPE INT(5);
        indy_outMBRNAME INT(5);
        indy_outSRCTYPE INT(5);
        indy_outASPNAME INT(5);

             // Standard DB2SQL scratchpad/diagnostic fields
        outSQLSTATE CHAR(5);
        funcname VARCHAR(517) CONST; // Function name;
        specname VARCHAR(128) CONST; // Specific function name;
        outSQLMSG VARCHAR(70);
        Scratch likeDS(scratch_t) OPTIONS(*VARSIZE);
        SQLOpCode INT(10) CONST; // -1=Open, 0=Fetch, 1=Close;

    end-pi;

     // Local API error info and returned member buffer
    dcl-ds ec likeDS(qusec_t) inz(*LIKEDS);
    dcl-s  rc int(10);
    dcl-ds PATH likeDS(Qlg_Path_Name_T) inz(*LIKEDS);
    dcl-ds savedPATH likeDS(Qlg_Path_Name_T) inz(*LIKEDS);
    dcl-ds qsys_Name likeDS(Qp0l_QSYS_Info_t) Inz;
    dcl-s bytesReturned uns(10);
    dcl-s bytesAvail    uns(10);
    dcl-s rtnBuffer CHAR(4096);
    dcl-ds mbrDesc likeDS(Qdb_Mbrd0100_T) Inz;
    dcl-s fileName char(20);
    dcl-s mbrName  char(10);

    if (sqlOpCode = SQL_OPEN);
        Scratch_Len = scratch.length;
        clear scratch;
        clear Attr_Type;
        clear rtnBuffer;
        outSQLSTATE = '00000';
        indy_outCREATED = 0;
        indy_outACCESSED = 0;
        indy_outCHANGED = 0;
        indy_outDATA_CHANGED = 0;
        indy_outLAST_USED = 0;
        indy_outLAST_USED_DAYS = 0;
        indy_outLAST_USED_RESET = 0;
        indy_outALLOC_SIZE = 0;
        indy_outDATA_SIZE = 0;
        indy_outCCSID = 0;
        indy_outASPNbr = 0;
        indy_outTEXT = 0;
        indy_outLIBNAME = 0;
        indy_outOBJNAME = 0;
        indy_outOBJTYPE = 0;
        indy_outMBRNAME = 0;
        indy_outASPNAME = 0;
        Scratch.length = scratch_len;
        return;
    endif;

    if (sqlOpCode = SQL_CLOSE);
        Return;
    endif;

    if (scratch.eof = 1);
        outSQLState = '02000';
        Return;
    endif;


    if (sqlOpCode = SQL_FETCH);
        Scratch.eof = 1;
        clear Attr_Type;
        clear outSQLMSG;
        outSQLSTATE = '00000';

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_CREATE_TIME;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_ACCESS_TIME;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_CHANGE_TIME;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_MODIFY_TIME;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_DATA_SIZE_64;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_ALLOC_SIZE_64;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
                QP0L_ATTR_USAGE_INFORMATION;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_ASP;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_CCSID;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_TEXT;

        Attr_type.Number_ofReqAttrs += 1;
        Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
               QP0L_ATTR_FILE_ID;

        if (indy_cvtOption >= 0);
            cvtOpt = %UPPER(%trimL(cvtOption : '* '));
            select;
                when cvtOpt in %LIST('0' : 'N' : 'S');  // No conversion
                    scratch.cvtCase = NOCONVERT;
                when cvtOpt in %LIST('1' : 'Y' : 'U');  // To upper
                    scratch.cvtCase = TOUPPER;
                when cvtOpt in %LIST('2' : 'L');  // To lower
                    scratch.cvtCase = TOLOWER;
            endsl;
        endif;

        utf8File = fileSuffix;

        if (indy_PATH_NAME < 0 or %len(inPath_NAME) = 0);
            utf8Path = '/QSYS.LIB';
            if (indy_LIBNAME >= 0);
                utf8Path += '/' + %TrimR(inLibNAME) + '.LIB';
            endif;
            if (indy_OBJNAME >= 0);
                utf8Path += '/' + %TrimR(inOBJNAME);
                if (indy_OBJTYPE >= 0);  // Add objec type extension
                    utf8Path += '.' + %UPPER(%Trim(inOBJTYPE : '* '));
                endif;
            endif;
            if (indy_MBRNAME >= 0);
                utf8Path += '/' + %TrimR(inMBRNAME) + '.MBR';
            endif;
            isFile = '1';
            Path.ptr_Path = %Addr(utf8Path : *DATA) ;
            Path.Path_Length = %len(utf8Path);
        else;
            if (scratch.cvtCase <> NOCONVERT);
                if (scratch.cvtCase = TOUPPER);
                    utf8Path = %UPPER( inPATH_NAME );
                    utf8File = %UPPER( utf8File );
                elseif (scratch.cvtCase = TOLOWER);
                    utf8Path = %LOWER( inPATH_NAME );
                    utf8File = %LOWER( utf8File );
                endif;
                isFile = (%scan(utf8File : utf8Path) > 0);
                Path.ptr_Path = %Addr(utf8Path : *DATA) ;
                Path.Path_Length = %len(utf8Path);
            else;
                Path.ptr_Path = %Addr(inPATH_NAME : *DATA) ;
                Path.Path_Length = %len(inPATH_NAME);
                isFile = (%scan(utf8File : %upper(inPATH_NAME)) > 0);
            endif;
        endif;

        if (NOT isFile);
            Attr_type.Number_ofReqAttrs += 1;
            Attr_type.AttrType(attr_type.Number_ofReqAttrs) =
                            QP0L_ATTR_OBJTYPE;
        endif;
        savedPath = path;
        rc = Qp0lGetAttr( path : attr_type :
                    rtnBuffer : %size(rtnBuffer) :
                    bytesAvail :
                    bytesReturned : QP0L_FOLLOW_SYMLNK);

        If (bytesReturned > 0);
            pRtnAttr = %addr(rtnBuffer);
        else;
            pErrNo = errNo();
            outSQLMsg = %TRIMR(psds.Pgmname) + ' returned ' + %Char(nErrNo) + ' - ' +
                        %str(strerror( nErrNo ));
            snd-msg outSQLMsg;
            snd-msg 'Nothing received from Qp0lGetAttr()) in ' + %TRIMR(psds.Pgmname);
            snd-msg 'Path_name=>''' + %trim(inPATH_NAME) + '''';

            outSQLState = '02000';
            scratch.eof = 1;
            return;
        endIf;

        Dow rtnAttr.AttrLen > 0 or rtnAttr.Offset > 0;
            If rtnAttr.AttrLen <= 0;
                outSQLMSG = 'Attr ' + %char(rtnAttr.attrID) +
                   ' is not supported by file.';
                snd-msg outSQLMSG;
            Else;
                select;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_CREATE_TIME;

                        monitor;
                            getDts(outCREATED : rtnAttr.Attrtime);
                        on-error;
                            indy_outCREATED = -1;
                        endmon;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_CHANGE_TIME;

                        monitor;
                            getDts(outCHANGED : rtnAttr.Attrtime);
                        on-error;
                            indy_outCHANGED = -1;
                        endmon;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_MODIFY_TIME;

                        monitor;
                            getDts(outDATA_CHANGED : rtnAttr.Attrtime);
                        on-error;
                            indy_outDATA_CHANGED = -1;
                        endmon;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_ACCESS_TIME;

                        monitor;
                            getDts(outACCESSED : rtnAttr.Attrtime);
                        on-error;
                            indy_outACCESSED = -1;
                        endmon;

                    WHEN rtnAttr.AttrID = QP0L_ATTR_USAGE_INFORMATION;
                        outLAST_USED_DAYS = rtnAttr.last_used.usedDays;
                        if (rtnAttr.last_used.usedDate = 0);
                            indy_outLAST_USED = -1;
                        else;
                            monitor;
                                getDts(outLAST_USED :
                                        rtnAttr.last_used.usedDate);
                            on-error;
                                indy_outLAST_USED = -1;
                            endmon;
                        endif;
                        if (rtnAttr.Last_used.resetDate = 0);
                            indy_outLAST_USED_RESET = -1;
                        else;
                            monitor;
                                getDts(outLAST_USED_RESET :
                                        rtnAttr.last_used.resetDate);
                            on-error;
                                indy_outLAST_USED_RESET = -1;
                            endmon;
                        endif;

                    WHEN rtnAttr.AttrID = QP0L_ATTR_DATA_SIZE_64;
                        outDATA_Size = rtnAttr.Attruint8;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_ALLOC_SIZE_64;
                        outALLOC_Size = rtnAttr.Attruint8;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_ASP;
                        outASPNbr = rtnAttr.Attruint2;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_CCSID;
                        outCCSID = rtnAttr.attruint4;
                    WHEN rtnAttr.AttrID = QP0L_ATTR_OBJTYPE;
                        outOBJTYPE =
                            %subst(rtnAttr.attrChar10 : 1 : rtnAttr.attrLen);

                    WHEN rtnAttr.AttrID = QP0L_ATTR_TEXT;
                        outText = %TRIMR(%SUBST(rtnAttr.attrUTF8: 1
                                        : rtnAttr.attrLen)
                                        : utf8NullBlank);
                endSL;
            endif;
            if (rtnAttr.Offset = 0);
                leave;  // end of attributes
            endif;
            pRtnAttr = %addr(rtnBuffer) + rtnAttr.offset;
        endDo;


        reset ec;

        Qp0lCvtPathToQSYSObjName( savedPath : QSYS_Name : 'QSYS0100' :
                                  %size(QSYS_Name) : 0 : ec);

        // The lib, file, mbr, type, text and ASP are returned null-terminated,
        // I use %TRIMR to remove those X'00' values when copied to the result.
        if (ec.Bytes_returned = 0);
            if (QSYS_NAME.Lib_Name = *ALLX'00');
                indy_outLIBNAME = -1;
                clear outLIBNAME;
            else;
                outLIBNAME = %trimR(QSYS_Name.Lib_Name : X'00');
                indy_outLIBNAME = 0;
            endif;

            if (QSYS_NAME.Obj_Name = *ALLX'00');
                indy_outOBJNAME = -1;
                clear outOBJNAME;
            else;
                outOBJNAME = %trimR(QSYS_Name.Obj_Name : X'00');
                indy_outOBJNAME = 0;
            endif;

            if (QSYS_NAME.Obj_Type = *ALLX'00');
                indy_outOBJTYPE = -1;
                clear outOBJTYPE;
            else;
                outOBJTYPE = %trimR(QSYS_Name.Obj_Type : X'00');
                indy_outOBJTYPE = 0;
            endif;

            if (QSYS_NAME.Mbr_Name = *ALLX'00');
                indy_outMBRNAME = -1;
                clear outMBRNAME;
                indy_outSRCTYPE = -1;
                clear outSRCTYPE;
            else;
                outMBRNAME = %trimR(QSYS_Name.Mbr_Name : X'00');
                indy_outMBRNAME = 0;

                reset ec;
                fileName = %trimR(outOBJNAME);
                %SUBST(fileName : 11 : 10) = %TrimR(outLIBNAME);
                mbrName  = %trimR(outMBRNAME);
                // Retrieve member source type
                QUSRMBRD( MBRDESC : %size(MBRDESC) : 'MBRD0100' :
                        fileName : mbrName : '1' : ec : '1');
                if (mbrDesc.Bytes_returned > 8);
                    outSRCTYPE = mbrDesc.Src_Type;
                endif;

            endif;

            if (QSYS_NAME.ASP_Name = *ALLX'00');
                indy_outASPNAME = -1;
                clear outASPNAME;
            else;
                outASPNAME = %trimR(QSYS_Name.ASP_Name : X'00');
                indy_outASPNAME = 0;
            endif;
        endif;

        outSQLSTATE = '00000';
        return;
    endif;
end-proc;

dcl-proc getDts;
    dcl-pi getDts  int(10);
        localTM timeStamp(0);
        seconds uns(10) const;
    end-pi;


    dcl-ds ec likeDS(QUSEC_T) inz(*LIKEDS);
    dcl-ds timeStruct17_t Qualified Template;
        yymd char(8);  // YYYYMMDD
        hms  char(6);  // HHMMSS
        mils char(3) inz('000');  // mmm
    end-ds;
    dcl-ds Qwc_Time_Zone_Info_T  Qualified Inz TEMPLATE;
        Bytes_Returned INT(10);
        Bytes_Available INT(10);
        Time_Zone_Name CHAR(10);
        Reserved01 CHAR(1);
        Current_DST_Indicator CHAR(1);
        Current_UTC_Offset INT(10);
        Current_Full_Time_Zone_Name CHAR(50);
        Current_Abbr_Time_Zone_Name CHAR(10);
        Current_Time_Zone_Msg_ID CHAR(7);
        Current_Time_Zone_Msg_File CHAR(10);
        Current_Time_Zone_Msg_File_Lib CHAR(10);
        Reserved02 CHAR(1);
        YearOffset INT(10);
    end-ds;  // Qwc_Time_Zone_Info_T
    dcl-ds inTime likeDS(timeStruct17_t) inz(*LIKEDS);
    dcl-ds outTime likeDS(timeStruct17_t) inz(*LIKEDS);
    dcl-ds timeZoneInfo likeDS(Qwc_Time_Zone_Info_T) inz;
    dcl-s  timeZoneLen  int(10) inz(0);  // We ignore the timezone parm
    dcl-s  micro char(1) inz('0'); // Only Milliseconds
    dcl-s  useDST char(1) inz('1'); // DST in input? (Not used)
    dcl-s time_in_UTC timestamp(0);

    dcl-pr QWCCVTDT  extPgm('QWCCVTDT');
        inFmt char(10) Const;
        inDate char(64) Const;
        outFmt char(10) Const;
        outDate char(64) OPTIONS(*VARSIZE);
        api_error  LikeDS(QUSEC_T) OPTIONS(*VARSIZE:*NOPASS);
        inTimeZone char(10) CONST OPTIONS(*NOPASS);
        outTimeZone char(10) CONST OPTIONS(*NOPASS);
        timeZoneInfo  LIKEDS(Qwc_Time_Zone_Info_T) CONST OPTIONS(*NOPASS);
        timeZoneSize  int(10) Const OPTIONS(*NOPASS);
        milli_or_micro_Indy char(1) Const OPTIONS(*NOPASS);
        DST_Indy char(1) Const OPTIONS(*NOPASS); // '1'=Daylight Saving time
    end-pr QWCCVTDT;

    time_in_UTC = epochTM + %seconds(seconds);
    inTime = %char( time_in_UTC : *ISO0 );
    inTIme.mils = '000';
    QWCCVTDT( '*YYMD' : inTime : '*YYMD' : outTime : ec :
                  '*UTC' : '*JOB' : timeZoneInfo : timeZoneLen : micro);
    if (ec.bytes_Returned = 0);
        monitor;
        localTM = %TimeStamp( outTime : *ISO0 : 3);
        on-error;
            snd-msg 'Time Failed: ' + outTime;
            return 0;
        endmon;
        return 1;  // everything went okay
    endif;
    return 0;
end-proc;
`;


export const OBJ_ATTR_SQL_TEMPLATE = `
 -- Get Object Attributes
 -- @author BobCozzi

CREATE or REPLACE FUNCTION \${functionLibrary}.OBJ_ATTR(
                    PATH_NAME VARCHAR(4096) CCSID 1208 DEFAULT NULL,
                    LIBRARY_NAME varchar(10) DEFAULT '*LIBL',
                    OBJECT_NAME varchar(10) DEFAULT NULL,
                    OBJTYPE  varchar(10) DEFAULT '*FILE',
                    MBR_NAME varchar(10)  DEFAULT NULL,
                    -- Convert path_name to upper/lower case?
                    cvtOption VARCHAR(10) DEFAULT 'NO'
                                           )
       RETURNS table (
            created_Date timeStamp(0),  -- Creation Date
            access_Date timestamp(0), -- Last accessed
            changed_Date timestamp(0), -- Last Changed
            data_changed_date timestamp(0), -- Last DataChanged
            last_used timestamp(0),
            last_used_days int,
            last_used_reset timestamp(0),
            Allocate_size bigint,
            data_size bigint,
            object_CCSID int,
            ASP_Nbr SMALLINT,
            OBJTEXT VARCHAR(50) CCSID 1208,
            LIBNAME VARCHAR(10),
            OBJNAME VARCHAR(10),
            OBJTYPE VARCHAR(10),
            MBRNAME VARCHAR(10),
            SRCTYPE VARCHAR(10),
            ASPNAME VARCHAR(10)
           )
  LANGUAGE RPGLE
  NO SQL
  NO FINAL CALL
  NOT DETERMINISTIC
  DISALLOW PARALLEL
  SCRATCHPAD 16
  SPECIFIC \${functionLibrary}.OBJ_ATTR
  EXTERNAL NAME '\${functionLibrary}/OBJ_ATTR'
  CARDINALITY 1
  PARAMETER STYLE DB2SQL;

LABEL on specific routine \${functionLibrary}.OBJ_ATTR IS
'\${version} - Retrieve Object Attributes';

COMMENT ON Specific FUNCTION \${functionLibrary}.OBJ_ATTR  IS
 '\${version} - Retrieve Object Attributes for a given object
 or member in a database file. @author BobCozzi';

comment on parameter SPECIFIC FUNCTION \${functionLibrary}.OBJ_ATTR
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
   /QSYS.LIB/SQLTOOLSRC.lib/QRPGLESRC.File,JOB_ATTR.mbr
   When this parameter is specified, then the LIBRARY_NAME, FILE_NAME,
   and MBR_NAME parameters are ignored.',

  CVTOPTION IS 'Controls whether to convert the PATH_NAME letter case.
   Conversion to all upper or all lower case may be requested.
   The default ''NO'' indicates that the path name is used as specified.
   When ''YES'' or ''UPPER'' is specified, the path is converted to upper case.
   When ''LOWER'' is specified, the path is converted to lower case.
   When ''NO'' or ''NONE'' is specified (the default) the path_name parameter
   value is uses as specified.'
 );
`;

const FUNCTION_LIBRARY_TOKEN = "${functionLibrary}";

export function getSource_objattr(targetLibrary: string, version: number): string {
    return OBJ_ATTR_SQL_TEMPLATE
        .replace(/\$\{version\}/g, String(version))
        .split(FUNCTION_LIBRARY_TOKEN).join(targetLibrary.trim());
}
