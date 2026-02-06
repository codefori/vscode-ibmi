import { existsSync } from "fs";
import vscode, { window } from "vscode";
import { extensionComponentRegistry } from "../../api/components/manager";
import IBMi from "../../api/IBMi";
import { Tools } from "../../api/Tools";
import { deleteStoredPassword, getStoredPassword, setStoredPassword } from "../../config/passwords";
import { isManaged } from "../../debug";
import * as certificates from "../../debug/certificates";
import { instance } from "../../instantiate";
import { ConnectionConfig, ConnectionData, RemoteConfigFile, Server } from '../../typings';
import { VscodeTools } from "../../ui/Tools";
import { ComplexTab, CustomUI, Section, SelectItem } from "../CustomUI";

const EDITING_CONTEXT = `code-for-ibmi:editingConnection`;

const ENCODINGS = [`37`, `256`, `273`, `277`, `278`, `280`, `284`, `285`, `297`, `500`, `871`, `870`, `905`, `880`, `420`, `875`, `424`, `1026`, `290`, `win37`, `win256`, `win273`, `win277`, `win278`, `win280`, `win284`, `win285`, `win297`, `win500`, `win871`, `win870`, `win905`, `win880`, `win420`, `win875`, `win424`, `win1026`];

const TERMINAL_TYPES = [
  { key: `IBM-3179-2`, text: `IBM-3179-2 (24x80 monochrome)` },
  { key: `IBM-3180-2`, text: `IBM-3180-2 (27x132 monochrome)` },
  { key: `IBM-3196-A1`, text: `IBM-3196-A1 (24x80 monochrome)` },
  { key: `IBM-3477-FC`, text: `IBM-3477-FC (27x132 color)` },
  { key: `IBM-3477-FG`, text: `IBM-3477-FG (27x132 monochrome)` },
  { key: `IBM-5251-11`, text: `IBM-5251-11 (24x80 monochrome)` },
  { key: `IBM-5291-1`, text: `IBM-5291-1 (24x80 monochrome)` },
  { key: `IBM-5292-2`, text: `IBM-5292-2 (24x80 color)` },
];

const CCSID_Options:SelectItem[] = [
    {
        "value": "37",
        "description": "37 - US, Canada, Netherlands, Portugal, Brazil, New Zealand, Australia",
        "text": ""
    },
    {
        "value": "256",
        "description": "256 - Netherlands",
        "text": ""
    },
    {
        "value": "273",
        "description": "273 - Austria, Germany",
        "text": ""
    },
    {
        "value": "277",
        "description": "277 - Denmark, Norway",
        "text": ""
    },
    {
        "value": "278",
        "description": "278 - Finland, Sweden",
        "text": ""
    },
    {
        "value": "280",
        "description": "280 - Italy",
        "text": ""
    },
    {
        "value": "284",
        "description": "284 - Spanish, Latin America",
        "text": ""
    },
    {
        "value": "285",
        "description": "285 - United Kingdom",
        "text": ""
    },
    {
        "value": "290",
        "description": "290 - Japan Katakana",
        "text": ""
    },
    {
        "value": "297",
        "description": "297 - France",
        "text": ""
    },
    {
        "value": "300",
        "description": "300 - Japan English",
        "text": ""
    },
    {
        "value": "301",
        "description": "301 - Japanese PC Data",
        "text": ""
    },
    {
        "value": "367",
        "description": "367 - ANSI X3.4 ASCII standard; USA",
        "text": ""
    },
    {
        "value": "420",
        "description": "420 - Arabic-speaking countries",
        "text": ""
    },
    {
        "value": "423",
        "description": "423 - Greece",
        "text": ""
    },
    {
        "value": "424",
        "description": "424 - Hebrew",
        "text": ""
    },
    {
        "value": "425",
        "description": "425 - Arabic-speaking countries",
        "text": ""
    },
    {
        "value": "437",
        "description": "437 - PC Data; PC Base; USA",
        "text": ""
    },
    {
        "value": "500",
        "description": "500 - Belgium, Canada, Switzerland, International Latin-1",
        "text": ""
    },
    {
        "value": "720",
        "description": "720 - MS-DOS Arabic",
        "text": ""
    },
    {
        "value": "737",
        "description": "737 - MS-DOS Greek PC-Data",
        "text": ""
    },
    {
        "value": "775",
        "description": "775 - MS-DOS Baltic PC-Data",
        "text": ""
    },
    {
        "value": "813",
        "description": "813 - ISO 8859-7; Greek/Latin",
        "text": ""
    },
    {
        "value": "819",
        "description": "819 - ISO 8859-1; Latin Alphabet No. 1",
        "text": ""
    },
    {
        "value": "833",
        "description": "833 - Korea (extended range)",
        "text": ""
    },
    {
        "value": "834",
        "description": "834 - Korea host double byte (including 1880 UDC)",
        "text": ""
    },
    {
        "value": "835",
        "description": "835 - Traditional Chinese host double byte (including 6204 UDC)",
        "text": ""
    },
    {
        "value": "836",
        "description": "836 - Simplified Chinese (extended range)",
        "text": ""
    },
    {
        "value": "837",
        "description": "837 - Simplified Chinese",
        "text": ""
    },
    {
        "value": "838",
        "description": "838 - Thailand (extended range)",
        "text": ""
    },
    {
        "value": "850",
        "description": "850 - PC Data; MLP 222 Latin Alphabet 1",
        "text": ""
    },
    {
        "value": "851",
        "description": "851 - PC Data; Greek",
        "text": ""
    },
    {
        "value": "852",
        "description": "852 - PC Data; Latin-2 Multilingual",
        "text": ""
    },
    {
        "value": "855",
        "description": "855 - PC Data; ROECE Cyrillic",
        "text": ""
    },
    {
        "value": "857",
        "description": "857 - PC Data; Turkey Latin #5",
        "text": ""
    },
    {
        "value": "858",
        "description": "858 - PC Data: MLP 222; Latin Alphabet Number 1 w/euro; Latin-1 Countries",
        "text": ""
    },
    {
        "value": "860",
        "description": "860 - PC Data; Portugal",
        "text": ""
    },
    {
        "value": "861",
        "description": "861 - PC Data; Iceland",
        "text": ""
    },
    {
        "value": "862",
        "description": "862 - PC Data; Hebrew",
        "text": ""
    },
    {
        "value": "863",
        "description": "863 - PC Data; Canada",
        "text": ""
    },
    {
        "value": "864",
        "description": "864 - PC Data; Arabic",
        "text": ""
    },
    {
        "value": "865",
        "description": "865 - PC Data; Denmark, Norway",
        "text": ""
    },
    {
        "value": "866",
        "description": "866 - PC Data; Cyrillic #2 - Personal Computer",
        "text": ""
    },
    {
        "value": "868",
        "description": "868 - PC Data: Urdu",
        "text": ""
    },
    {
        "value": "869",
        "description": "869 - PC Data; Greek",
        "text": ""
    },
    {
        "value": "870",
        "description": "870 - Latin-2 Multilingual",
        "text": ""
    },
    {
        "value": "871",
        "description": "871 - Iceland",
        "text": ""
    },
    {
        "value": "874",
        "description": "874 - Thai PC Data",
        "text": ""
    },
    {
        "value": "875",
        "description": "875 - Greece",
        "text": ""
    },
    {
        "value": "878",
        "description": "878 - Russian Internet KOI8-R Cyrillic",
        "text": ""
    },
    {
        "value": "880",
        "description": "880 - Cyrillic Multilingual",
        "text": ""
    },
    {
        "value": "891",
        "description": "891 - Korean PC Data (non-extended)",
        "text": ""
    },
    {
        "value": "897",
        "description": "897 - Japanese PC Data (non-extended)",
        "text": ""
    },
    {
        "value": "903",
        "description": "903 - Simplified Chinese PC Data (non-extended)",
        "text": ""
    },
    {
        "value": "904",
        "description": "904 - Traditional Chinese PC Data",
        "text": ""
    },
    {
        "value": "905",
        "description": "905 - Turkey Latin-3",
        "text": ""
    },
    {
        "value": "912",
        "description": "912 - ISO 8859-2; ROECE Latin-2 Multilingual",
        "text": ""
    },
    {
        "value": "914",
        "description": "914 - Latin 4 - ISO 8859-4",
        "text": ""
    },
    {
        "value": "915",
        "description": "915 - ISO 8859-5; Cyrillic; 8-bit ISO",
        "text": ""
    },
    {
        "value": "916",
        "description": "916 - ISO 8859-8; Hebrew",
        "text": ""
    },
    {
        "value": "918",
        "description": "918 - Urdu EBCDIC",
        "text": ""
    },
    {
        "value": "920",
        "description": "920 - ISO 8859-9; Latin 5",
        "text": ""
    },
    {
        "value": "921",
        "description": "921 - Baltic, 8-bit (ISO 8859-13)",
        "text": ""
    },
    {
        "value": "922",
        "description": "922 - Estonia, 8-bit (ISO)",
        "text": ""
    },
    {
        "value": "923",
        "description": "923 - ISO 8859-15: Latin Alphabet with euro",
        "text": ""
    },
    {
        "value": "924",
        "description": "924 - Latin 9 EBCDIC",
        "text": ""
    },
    {
        "value": "926",
        "description": "926 - Korean PC Data DBCS, UDC 1880",
        "text": ""
    },
    {
        "value": "927",
        "description": "927 - Traditional Chinese PC Data DBCS, UDC 6204",
        "text": ""
    },
    {
        "value": "928",
        "description": "928 - Simplified Chinese PC Data DBCS, UDC 1880",
        "text": ""
    },
    {
        "value": "930",
        "description": "930 - Japan Katakana (extended range) 4370 UDC (User Defined Characters)",
        "text": ""
    },
    {
        "value": "932",
        "description": "932 - Japan PC Data Mixed",
        "text": ""
    },
    {
        "value": "933",
        "description": "933 - Korea (extended range), 1880 UDC",
        "text": ""
    },
    {
        "value": "934",
        "description": "934 - Korean PC Data",
        "text": ""
    },
    {
        "value": "935",
        "description": "935 - Simplified Chinese (extended range)",
        "text": ""
    },
    {
        "value": "936",
        "description": "936 - Simplified Chinese (non-extended)",
        "text": ""
    },
    {
        "value": "937",
        "description": "937 - Traditional Chinese (extended range)",
        "text": ""
    },
    {
        "value": "938",
        "description": "938 - Traditional Chinese (non-extended)",
        "text": ""
    },
    {
        "value": "939",
        "description": "939 - Japan English (extended range) 4370 UDC",
        "text": ""
    },
    {
        "value": "941",
        "description": "941 - Japanese DBCS PC for Open environment (Multi-vendor code):\n6878 JIS X 0208-1990 characters, 386 IBM® selected\ncharacters, 1880 IBM UDC (X'F040' to X'F9FC')",
        "text": ""
    },
    {
        "value": "942",
        "description": "942 - Japanese PC Data Mixed",
        "text": ""
    },
    {
        "value": "943",
        "description": "943 - Japanese PC Data Mixed for Open environment (Multi-vendor code):\n6878 JIS X 0208-1990 characters, 386 IBM selected\nDBCS characters, 1880 UDC (X'F040' to X'F9FC')",
        "text": ""
    },
    {
        "value": "944",
        "description": "944 - Korean PC Data Mixed",
        "text": ""
    },
    {
        "value": "946",
        "description": "946 - Simplified Chinese PC Data Mixed",
        "text": ""
    },
    {
        "value": "947",
        "description": "947 - ASCII Double-byte",
        "text": ""
    },
    {
        "value": "948",
        "description": "948 - Traditional Chinese PC Data Mixed 6204 UDC (User Defined Characters)",
        "text": ""
    },
    {
        "value": "949",
        "description": "949 - Republic of Korea National Standard Graphic Character Set (KS)\nPC Data mixed-byte including 1800 UDC",
        "text": ""
    },
    {
        "value": "950",
        "description": "950 - Traditional Chinese PC Data Mixed for Big5",
        "text": ""
    },
    {
        "value": "951",
        "description": "951 - Republic of Korea National Standard Graphic Character Set (KS)\nPC Data double-byte including 1800 UDC",
        "text": ""
    },
    {
        "value": "954",
        "description": "954 - Japanese EUC; G0 - JIS X201 Roman set (00895); G1 - JIS X208-1990\nset (00952); G2 - JIS X201 Katakana set (04992 ); G3 - JIS X212 set\n(00953)",
        "text": ""
    },
    {
        "value": "956",
        "description": "956 - JIS X201 Roman for CP 00895; JIS X208-1983 for CP 00952",
        "text": ""
    },
    {
        "value": "957",
        "description": "957 - JIS X201 Roman for CP 00895; JIS X208-1978 for CP 00955",
        "text": ""
    },
    {
        "value": "958",
        "description": "958 - ASCII for CP 00367; JIS X208-1983 for CP 00952",
        "text": ""
    },
    {
        "value": "959",
        "description": "959 - ASCII for CP 00367; JIS X208-1978 for CP 00955",
        "text": ""
    },
    {
        "value": "964",
        "description": "964 - G0 - ASCII for CP 00367; G1- CNS 11643 plane 1 for CP 960",
        "text": ""
    },
    {
        "value": "965",
        "description": "965 - ASCII for CP 00367; CNS 11643 plane 1 for CP 960",
        "text": ""
    },
    {
        "value": "970",
        "description": "970 - G0 ASCII for CP 00367; G1 KSC X5601-1989 (including 188 UDCs)\nfor CP 971",
        "text": ""
    },
    {
        "value": "971",
        "description": "971 - Korean EUC, G1 - KS C5601-1989 (including 188 UDC)",
        "text": ""
    },
    {
        "value": "1008",
        "description": "1008 - Arabic 8-bit ISO/ASCII",
        "text": ""
    },
    {
        "value": "1009",
        "description": "1009 - IS0-7: IRV",
        "text": ""
    },
    {
        "value": "1010",
        "description": "1010 - ISO-7; France",
        "text": ""
    },
    {
        "value": "1011",
        "description": "1011 - ISO-7; Germany",
        "text": ""
    },
    {
        "value": "1012",
        "description": "1012 - ISO-7; Italy",
        "text": ""
    },
    {
        "value": "1013",
        "description": "1013 - ISO-7; United Kingdom",
        "text": ""
    },
    {
        "value": "1014",
        "description": "1014 - ISO-7; Spain",
        "text": ""
    },
    {
        "value": "1015",
        "description": "1015 - ISO-7; Portugal",
        "text": ""
    },
    {
        "value": "1016",
        "description": "1016 - ISO-7; Norway",
        "text": ""
    },
    {
        "value": "1017",
        "description": "1017 - ISO-7; Denmark",
        "text": ""
    },
    {
        "value": "1018",
        "description": "1018 - ISO-7; Finland and Sweden",
        "text": ""
    },
    {
        "value": "1019",
        "description": "1019 - ISO-7; Belgium and Netherlands",
        "text": ""
    },
    {
        "value": "1025",
        "description": "1025 - Cyrillic Multilingual",
        "text": ""
    },
    {
        "value": "1026",
        "description": "1026 - Turkey Latin 5 CECP",
        "text": ""
    },
    {
        "value": "1027",
        "description": "1027 - Japan English (extended range)",
        "text": ""
    },
    {
        "value": "1040",
        "description": "1040 - Korean Latin PC Data extended",
        "text": ""
    },
    {
        "value": "1041",
        "description": "1041 - Japanese PC Data extended",
        "text": ""
    },
    {
        "value": "1042",
        "description": "1042 - Simplified Chinese PC Data extended",
        "text": ""
    },
    {
        "value": "1043",
        "description": "1043 - Traditional Chinese PC Data extended",
        "text": ""
    },
    {
        "value": "1046",
        "description": "1046 - PC Data - Arabic Extended",
        "text": ""
    },
    {
        "value": "1051",
        "description": "1051 - HP Emulation(for use with Latin 1). GCGID SF150000 is mapped\nto a control X'7F'",
        "text": ""
    },
    {
        "value": "1088",
        "description": "1088 - Korean PC Data single-byte",
        "text": ""
    },
    {
        "value": "1089",
        "description": "1089 - ISO 8859-6: Arabic (string type 5)",
        "text": ""
    },
    {
        "value": "1097",
        "description": "1097 - Farsi",
        "text": ""
    },
    {
        "value": "1098",
        "description": "1098 - Farsi (IBM-PC)",
        "text": ""
    },
    {
        "value": "1112",
        "description": "1112 - Baltic, Multilingual",
        "text": ""
    },
    {
        "value": "1114",
        "description": "1114 - Traditional Chinese, Taiwan Industry Graphic Character Set\n(Big5)",
        "text": ""
    },
    {
        "value": "1115",
        "description": "1115 - Simplified Chinese National Standard (GB), personal computer\nSBCS",
        "text": ""
    },
    {
        "value": "1122",
        "description": "1122 - Estonia",
        "text": ""
    },
    {
        "value": "1123",
        "description": "1123 - Cyrillic Ukraine EBCDIC",
        "text": ""
    },
    {
        "value": "1124",
        "description": "1124 - Cyrillic Ukraine 8-Bit",
        "text": ""
    },
    {
        "value": "1125",
        "description": "1125 - Cyrillic Ukraine PC-Data",
        "text": ""
    },
    {
        "value": "1126",
        "description": "1126 - Windows Korean PC Data Single-Byte",
        "text": ""
    },
    {
        "value": "1129",
        "description": "1129 - ISO-8 Vietnamese",
        "text": ""
    },
    {
        "value": "1130",
        "description": "1130 - EBCDIC Vietnamese",
        "text": ""
    },
    {
        "value": "1131",
        "description": "1131 - Cyrillic Belarus PC-Data",
        "text": ""
    },
    {
        "value": "1132",
        "description": "1132 - EBCDIC Lao",
        "text": ""
    },
    {
        "value": "1133",
        "description": "1133 - ISO-8 Lao",
        "text": ""
    },
    {
        "value": "1137",
        "description": "1137 - Devanagari EBCDIC",
        "text": ""
    },
    {
        "value": "1140",
        "description": "1140 - ECECP: USA, Canada, Netherlands, Portugal, Brazil, Australia,\nNew Zealand",
        "text": ""
    },
    {
        "value": "1141",
        "description": "1141 - ECECP: Austria, Germany",
        "text": ""
    },
    {
        "value": "1142",
        "description": "1142 - ECECP: Denmark, Norway",
        "text": ""
    },
    {
        "value": "1143",
        "description": "1143 - ECECP: Finland, Sweden",
        "text": ""
    },
    {
        "value": "1144",
        "description": "1144 - ECECP: Italy",
        "text": ""
    },
    {
        "value": "1145",
        "description": "1145 - ECECP: Spain, Latin America (Spanish)",
        "text": ""
    },
    {
        "value": "1146",
        "description": "1146 - ECECP: United Kingdom",
        "text": ""
    },
    {
        "value": "1147",
        "description": "1147 - ECECP: France",
        "text": ""
    },
    {
        "value": "1148",
        "description": "1148 - ECECP: International 1",
        "text": ""
    },
    {
        "value": "1149",
        "description": "1149 - ECECP: Iceland",
        "text": ""
    },
    {
        "value": "1153",
        "description": "1153 - Latin-2 - EBCDIC Multilingual with euro",
        "text": ""
    },
    {
        "value": "1154",
        "description": "1154 - Cyrillic Multilingual with euro",
        "text": ""
    },
    {
        "value": "1155",
        "description": "1155 - Turkey Latin 5 with euro",
        "text": ""
    },
    {
        "value": "1156",
        "description": "1156 - Baltic, Multilingual with euro",
        "text": ""
    },
    {
        "value": "1157",
        "description": "1157 - Estonia EBCDIC with euro",
        "text": ""
    },
    {
        "value": "1158",
        "description": "1158 - Cyrillic Ukraine EBCDIC with euro",
        "text": ""
    },
    {
        "value": "1160",
        "description": "1160 - Thai host with euro",
        "text": ""
    },
    {
        "value": "1164",
        "description": "1164 - EBCDIC Vietnamese with euro",
        "text": ""
    },
    {
        "value": "1166",
        "description": "1166 - Cyrillic multilingual with Euro for Kazakhstan",
        "text": ""
    },
    {
        "value": "1175",
        "description": "1175 - Turkey with Euro and Turkish Lira",
        "text": ""
    },
    {
        "value": "1200",
        "description": "1200 - Unicode: UTF-16, big endian",
        "text": ""
    },
    {
        "value": "1208",
        "description": "1208 - Unicode: UTF-8",
        "text": ""
    },
    {
        "value": "1250",
        "description": "1250 - Windows, Latin 2",
        "text": ""
    },
    {
        "value": "1251",
        "description": "1251 - Windows, Cyrillic",
        "text": ""
    },
    {
        "value": "1252",
        "description": "1252 - Windows,Latin 1",
        "text": ""
    },
    {
        "value": "1253",
        "description": "1253 - Windows, Greek",
        "text": ""
    },
    {
        "value": "1254",
        "description": "1254 - Windows, Turkish",
        "text": ""
    },
    {
        "value": "1255",
        "description": "1255 - Windows, Hebrew",
        "text": ""
    },
    {
        "value": "1256",
        "description": "1256 - Windows, Arabic",
        "text": ""
    },
    {
        "value": "1257",
        "description": "1257 - Windows, Baltic Rim",
        "text": ""
    },
    {
        "value": "1258",
        "description": "1258 - MS Windows, Vietnamese",
        "text": ""
    },
    {
        "value": "1275",
        "description": "1275 - Apple Latin-1",
        "text": ""
    },
    {
        "value": "1280",
        "description": "1280 - Apple Greek",
        "text": ""
    },
    {
        "value": "1281",
        "description": "1281 - Apple Turkey",
        "text": ""
    },
    {
        "value": "1282",
        "description": "1282 - Apple Central European (Latin-2)",
        "text": ""
    },
    {
        "value": "1283",
        "description": "1283 - Apple Cyrillic",
        "text": ""
    },
    {
        "value": "1362",
        "description": "1362 - Windows Korean PC DBCS-PC, including 11 172\nfull hangul",
        "text": ""
    },
    {
        "value": "1363",
        "description": "1363 - Windows Korean PC Mixed, including 11 172\nfull hangul",
        "text": ""
    },
    {
        "value": "1364",
        "description": "1364 - Korean host mixed extended including 11 172 full hangul",
        "text": ""
    },
    {
        "value": "1371",
        "description": "1371 - Traditional Chinese host mixed including 6204 UDC, Extended SBCS including SBCS and DBCS euro\n(CCSID 9563 level)",
        "text": ""
    },
    {
        "value": "1377",
        "description": "1377 - Hong Kong Traditional Chinese mixed host enhancement for HKSCS-2004 (Mapping is HKSCS-2004 to\nUnicode 17584 level)",
        "text": ""
    },
    {
        "value": "1380",
        "description": "1380 - Simplified Chinese, People's Republic of China National Standard\n(GB), personal computer DBCS",
        "text": ""
    },
    {
        "value": "1381",
        "description": "1381 - Simplified Chinese, People's Republic of China National Standard\n(GB) personal computer mixed SBCS and DBCS",
        "text": ""
    },
    {
        "value": "1382",
        "description": "1382 - Simplified Chinese DBCS PC GB 2312-80 set, including 31 IBM selected\nand 1360 UDC.",
        "text": ""
    },
    {
        "value": "1383",
        "description": "1383 - Simplified Chinese, EUC \nG0 set; ASCII\n\nG1 set; GB 2312-80 set (1382)\n\n\n",
        "text": ""
    },
    {
        "value": "1385",
        "description": "1385 - Simplified Chinese DBCS-PC GBK, all GBK character set and others",
        "text": ""
    },
    {
        "value": "1386",
        "description": "1386 - Simplified Chinese PC Data GBK mixed, all GBK character set\nand others",
        "text": ""
    },
    {
        "value": "1388",
        "description": "1388 - Simplified Chinese DBCS- GB 18030 Host with UDCs and Uygur\nextension.",
        "text": ""
    },
    {
        "value": "1399",
        "description": "1399 - Japanese Latin-Kanji Host Mixed including 4370 UDC, Extended\nSBCS (includes SBCS and DBCS euro)",
        "text": ""
    },
    {
        "value": "4396",
        "description": "4396 - Japanese Host DB including 1880",
        "text": ""
    },
    {
        "value": "4930",
        "description": "4930 - Korean DBCS-Host extended including 11 172 full hangul",
        "text": ""
    },
    {
        "value": "4933",
        "description": "4933 - Simplified Chinese DBCS Host (GBK), all GBK character set and\nothers",
        "text": ""
    },
    {
        "value": "4948",
        "description": "4948 - Latin 2 PC Data Multilingual",
        "text": ""
    },
    {
        "value": "4951",
        "description": "4951 - Cyrillic PC Data Multilingual",
        "text": ""
    },
    {
        "value": "4952",
        "description": "4952 - Hebrew PC Data",
        "text": ""
    },
    {
        "value": "4953",
        "description": "4953 - Turkey PC Data Latin 5",
        "text": ""
    },
    {
        "value": "4960",
        "description": "4960 - Arabic PC Data",
        "text": ""
    },
    {
        "value": "4965",
        "description": "4965 - Greek PC Data",
        "text": ""
    },
    {
        "value": "4970",
        "description": "4970 - Thai PC Data Single-Byte",
        "text": ""
    },
    {
        "value": "4971",
        "description": "4971 - Greek (including euro)",
        "text": ""
    },
    {
        "value": "5026",
        "description": "5026 - Japan Katakana (extended range) 1880 UDC",
        "text": ""
    },
    {
        "value": "5035",
        "description": "5035 - Japan English (extended range) 1880 UDC",
        "text": ""
    },
    {
        "value": "5050",
        "description": "5050 - G0 - JIS X201 Roman for CP 895; G1 JIS X208-1990 for CP 952",
        "text": ""
    },
    {
        "value": "5052",
        "description": "5052 - JIS X201 Roman for CP 895; JIS X208-1983 for CP 952",
        "text": ""
    },
    {
        "value": "5053",
        "description": "5053 - JIS X201 Roman for CP 895; JIS X208-1978 for CP 955",
        "text": ""
    },
    {
        "value": "5054",
        "description": "5054 - ASCII for CP 367; JIS X208-1983 for CP 952",
        "text": ""
    },
    {
        "value": "5055",
        "description": "5055 - ASCII for CP 367; JIS X208-1978 for CP 955",
        "text": ""
    },
    {
        "value": "5123",
        "description": "5123 - Japanese Latin Host Extended SBCS (includes euro)",
        "text": ""
    },
    {
        "value": "5210",
        "description": "5210 - Simplified Chinese PC Data Single-Byte (GBK), growing CS",
        "text": ""
    },
    {
        "value": "5233",
        "description": "5233 - Devanagari EBCDIC, including Indian Rupee",
        "text": ""
    },
    {
        "value": "5348",
        "description": "5348 - Windows,\nLatin 1 with euro",
        "text": ""
    },
    {
        "value": "8612",
        "description": "8612 - Arabic (base shapes only)",
        "text": ""
    },
    {
        "value": "9030",
        "description": "9030 - Thai Host Extended SBCS",
        "text": ""
    },
    {
        "value": "9056",
        "description": "9056 - PC Data: Arabic PC Storage/Interchange",
        "text": ""
    },
    {
        "value": "9066",
        "description": "9066 - Thai PC Data Extended SBCS",
        "text": ""
    },
    {
        "value": "12708",
        "description": "12708 - Arabic (base shapes, Lamaleph ligatures and Hindi digits) (string\ntype 7)",
        "text": ""
    },
    {
        "value": "13121",
        "description": "13121 - Korean Host Extended SBCS",
        "text": ""
    },
    {
        "value": "13124",
        "description": "13124 - Simplified Chinese Host Data Single-Byte (GBK) equivalent to\nSimplified Chinese Host Data Single-Byte (GB) except growing CS",
        "text": ""
    },
    {
        "value": "13488",
        "description": "13488 - Unicode: UTF-16 as defined in the Unicode Standard.  Fixed\nCS as defined by Unicode 2.0.  Big endian",
        "text": ""
    },
    {
        "value": "16684",
        "description": "16684 - Japanese Latin Host Double-Byte including 4370 UDC (includes\neuro)",
        "text": ""
    },
    {
        "value": "17354",
        "description": "17354 - G0 - ASCII for CP 00367; G1 - KSC X5601-1989 (including 188\nUDCs) for CP 00971",
        "text": ""
    },
    {
        "value": "25546",
        "description": "25546 - Korean 2022-KR TCP, ASCII, KS C5601-1989 (includes 188 UDC, RFC1557 using SO/SI)",
        "text": ""
    },
    {
        "value": "28709",
        "description": "28709 - Traditional Chinese (extended range)",
        "text": ""
    },
    {
        "value": "33722",
        "description": "33722 - Japanese EUC",
        "text": ""
    },
    {
        "value": "57345",
        "description": "57345 - All Japanese 2022 characters",
        "text": ""
    },
    {
        "value": "61175",
        "description": "61175 - Character positions. ",
        "text": ""
    },
    {
        "value": "61952",
        "description": "61952 - (old CCSID for UCS). Use of 13488 is recommended instead.",
        "text": ""
    },
    {
        "value": "62210",
        "description": "62210 - ISO 8859-8; Hebrew, string type 4.",
        "text": ""
    },
    {
        "value": "62211",
        "description": "62211 - EBCDIC; Hebrew, string type 5",
        "text": ""
    },
    {
        "value": "62215",
        "description": "62215 - MS Windows; Hebrew, string type 4",
        "text": ""
    },
    {
        "value": "62218",
        "description": "62218 - PC data; Arabic, string type 4",
        "text": ""
    },
    {
        "value": "62222",
        "description": "62222 - ISO 8859-9; Hebrew, string type 6",
        "text": ""
    },
    {
        "value": "62223",
        "description": "62223 - MS Windows; Hebrew, string type 6",
        "text": ""
    },
    {
        "value": "62224",
        "description": "62224 - EBCDIC; Arabic, string type 6",
        "text": ""
    },
    {
        "value": "62228",
        "description": "62228 - MS Windows; Arabic, string type 6",
        "text": ""
    },
    {
        "value": "62235",
        "description": "62235 - EBCDIC; Hebrew, string type 6",
        "text": ""
    },
    {
        "value": "62238",
        "description": "62238 - ISO 8859-9; Hebrew, string type 10",
        "text": ""
    },
    {
        "value": "62239",
        "description": "62239 - MS Windows; Hebrew, string type 10",
        "text": ""
    },
    {
        "value": "62245",
        "description": "62245 - EBCDIC; Hebrew, string type 10",
        "text": ""
    },
    {
        "value": "65534",
        "description": "65534 - Look at lower level CCSID",
        "text": ""
    },
    {
        "value": "65535",
        "description": "65535 - Special value indicating data is hex and should not be converted.\nThis is the default for the QCCSID system value.",
        "text": ""
    }
];


type LoginSettings = ConnectionData & {
  buttons?: 'submitButton'
}

export class SettingsUI {
  static init(context: vscode.ExtensionContext) {

    context.subscriptions.push(
      vscode.commands.registerCommand(`code-for-ibmi.showAdditionalSettings`, async (server?: Server, tab?: string) => {
        const connectionSettings = IBMi.connectionManager.getAll();
        const connection = instance.getConnection();
        const passwordAuthorisedExtensions = instance.getStorage()?.getAuthorisedExtensions() || [];

        let config: ConnectionConfig;
        let serverConfig: RemoteConfigFile | undefined;

        if (connectionSettings && server) {
          config = await IBMi.connectionManager.load(server.name);

        } else if (connection) {
          // Reload config to initialize any new config parameters.
          config = await IBMi.connectionManager.load(connection.currentConnectionName);

          const remoteConnectionConfig = connection.getConfigFile<RemoteConfigFile>(`settings`);
          const serverConfigOk = remoteConnectionConfig.getState() === `ok`;

          if (serverConfigOk) {
            serverConfig = await remoteConnectionConfig.get();
          }
        } else {
          vscode.window.showErrorMessage(`No connection is active.`);
          return;

        }

        const hasServerProperties = serverConfig && serverConfig.codefori && Object.keys(serverConfig.codefori).length > 0;

        const setFieldsReadOnly = async (currentSection: Section) => {
          if (serverConfig && serverConfig.codefori) {
            for (const field of currentSection.fields) {
              if (!field.id) continue;

              if (serverConfig.codefori[field.id] !== undefined) {
                field.readonly = true;
              }
            }
          }
        }

        const restartFields = [`readOnlyMode`, `showDescInLibList`, `tempDir`, `debugCertDirectory`];
        let restart = false;

        const featuresTab = new Section();

        if (hasServerProperties) {
          featuresTab
            .addParagraph(`Some of these settings have been set on the server and cannot be changed here.`)
            .addHorizontalRule();
        }

        featuresTab
          .addCheckbox(`readOnlyMode`, `Read only mode`, `When enabled, content on the server can not be changed. Requires restart when changed.`, config.readOnlyMode)
          .addHorizontalRule()
          .addCheckbox(`quickConnect`, `Quick Connect`, `When enabled, server settings from previous connection will be used, resulting in much quicker connection. If server settings are changed, right-click the connection in Connection Browser and select <code>Connect and Reload Server Settings</code> to refresh the cache.`, config.quickConnect)
          .addCheckbox(`showDescInLibList`, `Show description of libraries in User Library List view`, `When enabled, library text and attribute will be shown in User Library List. It is recommended to also enable SQL for this.`, config.showDescInLibList)
          .addCheckbox(`showHiddenFiles`, `Show hidden files and directories in IFS browser.`, `When disabled, hidden files and directories (i.e. names starting with '.') will not be shown in the IFS browser, except for special config files.`, config.showHiddenFiles)
          .addCheckbox(`autoSortIFSShortcuts`, `Sort IFS shortcuts automatically`, `Automatically sort the shortcuts in IFS browser when shortcut is added or removed.`, config.autoSortIFSShortcuts)
          .addCheckbox(`autoConvertIFSccsid`, `Support EBCDIC streamfiles`, `Enable converting EBCDIC to UTF-8 when opening streamfiles. When disabled, assumes all streamfiles are in UTF8. When enabled, will open streamfiles regardless of encoding. May slow down open and save operations.<br><br>You can find supported CCSIDs with <code>/usr/bin/iconv -l</code>`, config.autoConvertIFSccsid)
          .addHorizontalRule()
          .addCheckbox(`autoSaveBeforeAction`, `Auto Save for Actions`, `When current editor has unsaved changes, automatically save it before running an action.`, config.autoSaveBeforeAction)
          .addInput(`hideCompileErrors`, `Errors to ignore`, `A comma delimited list of errors to be hidden from the result of an Action in the EVFEVENT file. Useful for codes like <code>RNF5409</code>.`, { default: config.hideCompileErrors.join(`, `) })

        setFieldsReadOnly(featuresTab);

        const tempDataTab = new Section();
        tempDataTab
          .addInput(`tempLibrary`, `Temporary library`, `Temporary library. Cannot be QTEMP.`, { default: config.tempLibrary, minlength: 1, maxlength: 10 })
          .addInput(`tempDir`, `Temporary IFS directory`, `Directory that will be used to write temporary files to. User must be authorized to create new files in this directory.`, { default: config.tempDir, minlength: 1 })
          .addCheckbox(`autoClearTempData`, `Clear temporary data automatically`, `Automatically clear temporary data in the chosen temporary library when it's done with and on startup. Deletes all <code>*FILE</code> objects that start with <code>O_</code> in the chosen temporary library.`, config.autoClearTempData);

        setFieldsReadOnly(tempDataTab);  

        const nonUtfEncodings = new Set<string>(ENCODINGS);

        const sourceCcsidOptions = CCSID_Options.filter(option => nonUtfEncodings.has(option.value)).map((i) => { return {...i}});
        const targetCcsidOptions = CCSID_Options.filter(option => !nonUtfEncodings.has(option.value)).map((i) => { return {...i}});
        
        sourceCcsidOptions.unshift({
            value: "0",
            description: "Select CCSID",
            text: ""
        });

        targetCcsidOptions.unshift({
            value: "0",
            description: "Select CCSID",
            text: ""
        });

        const selectedSourceCcsid = sourceCcsidOptions.find(option => option.value === config.ccsidConvertFrom);
        const selectedTargetCcsid = targetCcsidOptions.find(option => option.value === config.ccsidConvertTo);
        
        if (selectedSourceCcsid) {
          selectedSourceCcsid.selected = true;
        }
        if (selectedTargetCcsid) {
          selectedTargetCcsid.selected = true;
        }

        const sourceTab =  new Section();
        sourceTab
          .addInput(`sourceASP`, `Source ASP`, `Current ASP is based on the user profile job description and cannot be changed here.`, { default: connection?.getCurrentIAspName() || `*SYSBAS`, readonly: true })
          .addInput(`sourceFileCCSID`, `Source file CCSID`, `The CCSID of source files on your system. You should only change this setting from <code>*FILE</code> if you have a source file that is 65535 - otherwise use <code>*FILE</code>. Note that this config is used to fetch all members. If you have any source files using 65535, you have bigger problems.`, { default: config.sourceFileCCSID, minlength: 1, maxlength: 5 })
          .addHorizontalRule()
          .addCheckbox(`ccsidConversionEnabled`,`Automatic Conversion for non UTF compatible CCSIDs`, `When enabled, members with selected source CCSID will be converted to target CCSID`  ,config.ccsidConversionEnabled )
          .addSelect(`ccsidConvertFrom`, `Source CCSID`, sourceCcsidOptions)
          .addSelect(`ccsidConvertTo`, `Target CCSID`, targetCcsidOptions)
          .addHorizontalRule()
          .addCheckbox(`enableSourceDates`, `Enable Source Dates`, `When enabled, source dates will be retained and updated when editing source members. Requires restart when changed.`, config.enableSourceDates)
          .addCheckbox(`sourceDateGutter`, `Source Dates in Gutter`, `When enabled, source dates will be displayed in the gutter. This also enables date search and sequence view.`, config.sourceDateGutter)
          .addHorizontalRule()
          .addSelect(`defaultDeploymentMethod`, `Default Deployment Method`, [
            {
              selected: config.defaultDeploymentMethod === undefined || config.defaultDeploymentMethod === ``,
              value: ``,
              description: `No Default`,
              text: `No default Deploy method`,
            },
            {
              selected: config.defaultDeploymentMethod === `compare`,
              value: `compare`,
              description: `Compare`,
              text: `Synchronizes using MD5 hash comparison`,
            },
            {
              selected: config.defaultDeploymentMethod === `changed`,
              value: `changed`,
              description: `Changes`,
              text: `Changes detected since last upload.`,
            },
            {
              selected: config.defaultDeploymentMethod === `unstaged`,
              value: `unstaged`,
              description: `Working Changes`,
              text: `Unstaged changes in Git`,
            },
            {
              selected: config.defaultDeploymentMethod === `staged`,
              value: `staged`,
              description: `Staged Changes`,
              text: `Staged changes in Git`,
            },
            {
              selected: config.defaultDeploymentMethod === `all`,
              value: `all`,
              description: `All`,
              text: `Every file in the local workspace`,
            }
          ], `Set your Default Deployment Method. This is used when deploying from the local workspace to the server.`)
          .addHorizontalRule()
          .addInput(`protectedPaths`, `Protected paths`, `A comma separated list of libraries and/or IFS directories whose members will always be opened in read-only mode. (Example: <code>QGPL, /home/QSECOFR, MYLIB, /QIBM</code>)`, { default: config.protectedPaths.join(`, `) });

        setFieldsReadOnly(sourceTab);

        const terminalsTab = new Section();
        if (connection && connection.remoteFeatures.tn5250) {
          terminalsTab
            .addSelect(`encodingFor5250`, `5250 encoding`, [{
              selected: config.encodingFor5250 === `default`,
              value: `default`,
              description: `Default`,
              text: `Default`,
            }, ...ENCODINGS.map(encoding => ({
              selected: config!.encodingFor5250 === encoding,
              value: encoding,
              description: encoding,
              text: encoding,
            }))], `The encoding for the 5250 emulator.`)
            .addSelect(`terminalFor5250`, `5250 Terminal Type`, [
              {
                selected: config.terminalFor5250 === `default`,
                value: `default`,
                description: `Default`,
                text: `Default`,
              },
              ...TERMINAL_TYPES.map(terminal => ({
                selected: config!.terminalFor5250 === terminal.key,
                value: terminal.key,
                description: terminal.key,
                text: terminal.text,
              }))
            ], `The terminal type for the 5250 emulator.`)
            .addCheckbox(`setDeviceNameFor5250`, `Set Device Name for 5250`, `When enabled, the user will be able to enter a device name before the terminal starts.`, config.setDeviceNameFor5250)
            .addInput(`connectringStringFor5250`, `Connection string for 5250`, `The syntax for tn5250 is <code>[options] [ssl:]HOST[:PORT]</code> (default is <code>+uninhibited localhost</code>)<br /><ul><li><b>options</b>: a list of options that changes tn5250 behaviour; this list is whitespace separated (e.g. <code>+uninhibited +ruler</code>)</li><li><b>ssl</b>: allows you to connect to your system using TELNET over SSL</li><li><b>host</b>: the host you need to connect to (usually <code>localhost</code>)</li><li><b>port</b>: TCP port for the connection</li></ul><br>Further documentation is available at <a href="https://linux.die.net/man/5/tn5250rc">this link</a>, enjoy 😎`, { default: config.connectringStringFor5250 });
        } else if (connection) {
          terminalsTab.addParagraph('Enable 5250 emulation to change these settings');
        } else {
          terminalsTab.addParagraph('Connect to the server to see these settings.');
        }

        setFieldsReadOnly(terminalsTab);

        const debuggerTab = new Section();
        if (connection && connection.remoteFeatures[`startDebugService.sh`]) {
          debuggerTab.addParagraph(`The following values have been read from the debug service configuration.`);
          const debugServiceConfig: Map<string, string> = new Map()
            .set("Debug port", config.debugPort);

          debugServiceConfig.set("SEP debug port", config.debugSepPort)

          debuggerTab.addParagraph(`<ul>${Array.from(debugServiceConfig.entries()).map(([label, value]) => `<li><code>${label}</code>: ${value}</li>`).join("")}</ul>`);

          debuggerTab.addCheckbox(`debugUpdateProductionFiles`, `Update production files`, `Determines whether the job being debugged can update objects in production (<code>*PROD</code>) libraries.`, config.debugUpdateProductionFiles)
            .addCheckbox(`debugEnableDebugTracing`, `Debug trace`, `Tells the debug service to send more data to the client. Only useful for debugging issues in the service. Not recommended for general debugging.`, config.debugEnableDebugTracing);

          if (!isManaged()) {
            debuggerTab.addHorizontalRule();
            if (await certificates.remoteCertificatesExists()) {
              let localCertificateIssue;
              try {
                await certificates.checkClientCertificate(connection);
              }
              catch (error) {
                localCertificateIssue = `${String(error)}. Debugging will not function correctly.`;
              }
              debuggerTab.addParagraph(`<b>${localCertificateIssue || "Client certificate for service has been imported and matches remote certificate."}</b>`)
                .addParagraph(`To debug on IBM i, Visual Studio Code needs to load a client certificate to connect to the Debug Service. Each server has a unique certificate. This client certificate should exist at <code>${certificates.getLocalCertPath(connection)}</code>`)
                .addButtons({ id: `import`, label: `Download client certificate` });
            }
          }
        } else if (connection) {
          debuggerTab.addParagraph('Enable the debug service to change these settings');
        } else {
          debuggerTab.addParagraph('Connect to the server to see these settings.');
        }

        setFieldsReadOnly(debuggerTab);

        const componentsTab = new Section();
        if (connection) {
          const states = connection.getComponentManager().getComponentStates();
          componentsTab.addParagraph(`The following extensions contribute these components:`);
          extensionComponentRegistry.getComponents().forEach((components, extensionId) => {
            const extension = vscode.extensions.getExtension(extensionId);
            componentsTab.addParagraph(`<p>
              <h3 style="padding-bottom: 1em;">${extension?.packageJSON.displayName || extension?.id || "Unnamed extension"}</h3>
              <ul>
              ${components.map(component => `<li>${component?.getIdentification().name} (version ${component?.getIdentification().version}): ${states.find(c => c.id.name === component.getIdentification().name)?.state} (${component.getIdentification().userManaged ? `optional` : `required`})</li>`).join(``)}
              </ul>
              </p>`);
          });

          const userInstallableComponents = states.filter(c => c.id.userManaged && c.state !== `Installed`);
          if (userInstallableComponents.length) {
            componentsTab.addButtons({ id: `installComponent`, label: `Install component` })
          }
        } else {
          componentsTab.addParagraph('Connect to the server to see these settings.');
        }

        setFieldsReadOnly(componentsTab);

        const tabs: ComplexTab[] = [
          { label: `Features`, fields: featuresTab.fields },
          { label: `Source Code`, fields: sourceTab.fields },
          { label: `Terminals`, fields: terminalsTab.fields },
          { label: `Debugger`, fields: debuggerTab.fields },
          { label: `Temporary Data`, fields: tempDataTab.fields },
          { label: `Components`, fields: componentsTab.fields },
        ];

        const ui = new CustomUI();

        if (passwordAuthorisedExtensions.length) {
          const passwordAuthTab = new Section();

          passwordAuthTab
            .addParagraph(`The following extensions are authorized to use the password for this connection.`)
            .addParagraph(`<ul>${passwordAuthorisedExtensions.map(authExtension => `<li>✅ <code>${authExtension.displayName || authExtension.id}</code> - since ${new Date(authExtension.since).toDateString()} - last access on ${new Date(authExtension.lastAccess).toDateString()}</li>`).join(``)}</ul>`)
            .addButtons({ id: `clearAllowedExts`, label: `Clear list` })

          tabs.push({ label: `Extension Auth`, fields: passwordAuthTab.fields });
        }

        const defaultTab = tabs.findIndex(t => t.label === tab);

        // If `tab` is provided, we can open directory to a specific tab.. pretty cool
        ui.addComplexTabs(tabs, (defaultTab >= 0 ? defaultTab : undefined))
          .addHorizontalRule()
          .addButtons({ id: `save`, label: `Save settings`, requiresValidation: true });

        await VscodeTools.withContext(EDITING_CONTEXT, async () => {
          const page = await ui.loadPage<any>(`Settings: ${config.name}`);
          if (page) {
            page.panel.dispose();

            if (page.data) {
              const data = page.data;
              const button = data.buttons;

              switch (button) {
                case `import`:
                  vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
                  break;

                case `clearAllowedExts`:
                  instance.getStorage()?.revokeAllExtensionAuthorisations();
                  break;

                case `installComponent`:
                  if (connection) {
                    installComponentsQuickPick(connection);
                  }
                  break;

                default:
                  const data = page.data;
                  for (const key in data) {

                    //In case we need to play with the data
                    switch (key) {
                      case `sourceASP`:
                        data[key] = null;
                        break;
                      case `hideCompileErrors`:
                        data[key] = String(data[key]).split(`,`)
                          .map(item => item.toUpperCase().trim())
                          .filter(item => item !== ``)
                          .filter(Tools.distinct);
                        break;
                      case `protectedPaths`:
                        data[key] = String(data[key]).split(`,`)
                          .map(item => item.trim())
                          .map(item => item.startsWith('/') ? item : connection?.upperCaseName(item) || item.toUpperCase())
                          .filter(item => item !== ``)
                          .filter(Tools.distinct);
                        break;
                      case `defaultDeploymentMethod`:
                        if (data[key] === 'No Default') data[key] = '';
                        break;
                    }
                  }

                  if (restartFields.some(item => data[item] !== config[item])) {
                    restart = true;
                  }

                  const reloadBrowsers = config.protectedPaths.join(",") !== data.protectedPaths.join(",");
                  const removeCachedSettings = (!data.quickConnect && data.quickConnect !== config.quickConnect);

                  Object.assign(config, data);
                  await instance.setConfig(config);
                  if (removeCachedSettings)
                    IBMi.GlobalStorage.deleteServerSettingsCache(config.name);

                  if (connection) {
                    if (restart) {
                      vscode.window.showInformationMessage(`Some settings require a restart to take effect. Reload workspace now?`, `Reload`, `No`)
                        .then(async (value) => {
                          if (value === `Reload`) {
                            await vscode.commands.executeCommand(`workbench.action.reloadWindow`);
                          }
                        });
                    }
                    else if (reloadBrowsers) {
                      vscode.commands.executeCommand("code-for-ibmi.refreshIFSBrowser");
                      vscode.commands.executeCommand("code-for-ibmi.refreshObjectBrowser");
                    }
                  }

                  //Refresh connection browser if not connected
                  else {
                    vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
                  }
                  break;
              }
            }
          }
        })
      }),

      vscode.commands.registerCommand(`code-for-ibmi.showLoginSettings`, async (server?: Server) => {
        if (server) {
          const name = server.name;

          const connection = await IBMi.connectionManager.getByName(name);
          if (connection) {
            const storedPassword = await getStoredPassword(context, name);
            let { data: stored, index } = connection;
            const privateKeyPath = stored.privateKeyPath ? Tools.resolvePath(stored.privateKeyPath) : undefined;
            const privateKeyWarning = !privateKeyPath || existsSync(privateKeyPath) ? "" : "<b>⚠️ This private key doesn't exist on this system! ⚠️</b></br></br>";
            const ui = new CustomUI()
              .addInput(`host`, vscode.l10n.t(`Host or IP Address`), undefined, { default: stored.host, minlength: 1 })
              .addInput(`port`, vscode.l10n.t(`Port (SSH)`), undefined, { default: String(stored.port), min: 1, max: 65535, inputType: "number" })
              .addInput(`username`, vscode.l10n.t(`Username`), undefined, { default: stored.username, minlength: 1 })
              .addHorizontalRule()
              .addParagraph(vscode.l10n.t(`Only provide either the password or a private key - not both.`))
              .addPassword(`password`, `${vscode.l10n.t(`Password`)}${storedPassword ? ` (${vscode.l10n.t(`stored`)})` : ``}`, vscode.l10n.t("Only provide a password if you want to update an existing one or set a new one."))
              .addFile(`privateKeyPath`, `${vscode.l10n.t(`Private Key`)}${privateKeyPath ? ` (${vscode.l10n.t(`Private Key`)}: ${privateKeyPath})` : ``}`, privateKeyWarning + vscode.l10n.t("Only provide a private key if you want to update from the existing one or set one.") + '<br />' + vscode.l10n.t("OpenSSH, RFC4716 and PPK formats are supported."))
              .addHorizontalRule()
              .addInput(`readyTimeout`, vscode.l10n.t(`Connection Timeout (in milliseconds)`), vscode.l10n.t(`How long to wait for the SSH handshake to complete.`), { inputType: "number", min: 1, default: stored.readyTimeout ? String(stored.readyTimeout) : "20000" })

              .addCheckbox(`sshDebug`, vscode.l10n.t(`Turn on SSH debug output`), vscode.l10n.t(`Enable this to output debug traces in the Code for i and help diagnose SSH connection issues.`), stored.sshDebug)
              .addButtons(
                { id: `submitButton`, label: vscode.l10n.t(`Save`), requiresValidation: true },
                { id: `removeAuth`, label: vscode.l10n.t(`Remove auth methods`) }
              );

            await VscodeTools.withContext(EDITING_CONTEXT, async () => {
              const page = await ui.loadPage<LoginSettings>(vscode.l10n.t(`Login Settings: "{0}"`, name));
              if (page && page.data) {
                page.panel.dispose();

                const data = page.data;
                const chosenButton = data.buttons as "submitButton" | "removeAuth";

                switch (chosenButton) {
                  case `removeAuth`:
                    await deleteStoredPassword(context, name);
                    data.privateKeyPath = undefined;
                    vscode.window.showInformationMessage(vscode.l10n.t(`Authentication methods removed for "{0}".`, name));
                    break;

                  default:
                    if (data.password) {
                      delete data.privateKeyPath;
                      if (data.password !== storedPassword) {
                        // New password was entered, so store the password
                        // and remove the private key path from the data
                        await setStoredPassword(context, name, data.password);
                        vscode.window.showInformationMessage(vscode.l10n.t(`Password updated and will be used for "{0}".`, name));
                      }
                    } else if (data.privateKeyPath?.trim()) {
                      // If no password was entered, but a keypath exists
                      // then remove the password from the data and
                      // use the keypath instead
                      data.privateKeyPath = Tools.normalizePath(data.privateKeyPath);
                      await deleteStoredPassword(context, name);
                      vscode.window.showInformationMessage(vscode.l10n.t(`Private key updated and will be used for "{0}".`, name));
                    }
                    else {
                      delete data.privateKeyPath;
                    }
                    break;
                }

                //Fix values before assigning the data
                data.port = Number(data.port);
                data.readyTimeout = Number(data.readyTimeout);
                delete data.password;
                delete data.buttons;

                stored = Object.assign(stored, data);
                await IBMi.connectionManager.updateByIndex(index, stored);
                IBMi.GlobalStorage.deleteServerSettingsCache(server.name);
                vscode.commands.executeCommand(`code-for-ibmi.refreshConnections`);
              }
            });
          }
        }
      })
    )
  }
}

function installComponentsQuickPick(connection: IBMi) {
  const components = connection.getComponentManager().getComponentStates();
  const installable = components.filter(c => c.id.userManaged && c.state !== `Installed`);

  if (installable.length === 0) {
    return;
  }

  const withS = installable.length > 1 ? `s` : ``;
  const quickPick = window.showQuickPick(installable.map(c => ({
    label: c.id.name,
    description: c.state,
    id: c.id.name
  })), {
    title: `Install component${withS}`,
    canPickMany: true,
    placeHolder: `Select component${withS} to install`
  }).then(async result => {
    if (result) {
      window.withProgress({ title: `Component${withS}`, location: vscode.ProgressLocation.Notification }, async (progress) => {
        for (const item of result) {
          progress.report({ message: `Installing ${item.label}...` });
          try {
            await connection.getComponentManager().installComponent(item.id);
          } catch (e) {
            // TODO: handle errors!
          }
        }
      });
    }
  })

}