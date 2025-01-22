import { describe, it, expect } from 'vitest';
import { parseFilter, singleGenericName } from '../../Filter';

const QSYSINCS = ["CMRPG", "DSQCOMMR", "ECACHCMD", "ECARTCMD", "ECHGPRF1", "ECHGRCV1", "ECHKPWD1", "ECLRMST", "ECRTPRF1", "EDBOPNDB", "EDCVARY", "EDLTKR", "EDLTPRF1", "EDLTPRF2", "EDLTRCV1", "EIM", "EIMGEPH", "EJOBNTFY", "EKICONR", "EMHDFTPG", "EMOOPTEP", "ENPSEP", "EOGDOCH", "EOK", "EOKDRSH1", "EOKDRSP", "EOKDRVF", "EPADSEL", "EPDTRCJB", "EPQMAPXT", "EPQXFORM", "EPWFSEP", "EQQQRYGV", "EQQQRYSV", "ERRNO", "ERSTPRF1", "ERWSCI", "ESCWCHT", "ESETMST", "ESOEXTPT", "ESPBLSEP", "ESPDQRCD", "ESPDRVXT", "ESPTRNXT", "ESPXPTS", "ESYDRAPP", "ESYRGAPP", "ESYUPDCA", "ESYUPDCU", "ETASTGEX", "ETATAPMG", "ETEPGMST", "ETEPSEPH", "ETGDEVEX", "ETNCMTRB", "ETOCSVRE", "ETRNKSF", "EUIAFEX", "EUIALCL", "EUIALEX", "EUICSEX", "EUICTEX", "EUIFKCL", "EUIGPEX", "EUIILEX", "EUIMICL", "EUITAEX", "EVLDPWD1", "EWCPRSEP", "EWCPWRD", "EZDAEP", "EZHQEP", "EZRCEP", "EZSCEP", "EZSOEP", "FCNTL", "ICONV", "IFS", "JNI", "PTHREAD", "QALRTVA", "QANE", "QBNCHGPD", "QBNLMODI", "QBNLPGMI", "QBNLSPGM", "QBNRMODI", "QBNRPII", "QBNRSPGM", "QC3CCI", "QCAPCMD", "QCAVFY", "QCDRCMDD", "QCDRCMDI", "QCLRPGMI", "QCST", "QCSTCFG", "QCSTCFG1", "QCSTCHT", "QCSTCRG1", "QCSTCRG3", "QCSTCRG4", "QCSTCTL", "QCSTCTL1", "QCSTCTL2", "QCSTDD", "QDBJRNL", "QDBLDBR", "QDBRJBRL", "QDBRPLAY", "QDBRRCDL", "QDBRTVFD", "QDBRTVSN", "QDBST", "QDCCCFGD", "QDCLCFGD", "QDCRCFGS", "QDCRCTLD", "QDCRDEVD", "QDCRLIND", "QDCRNWSD", "QDFRPRTA", "QDFRTVFD", "QDMLOPNF", "QDMRTVFO", "QEDCHGIN", "QEDRTVCI", "QESCPTFO", "QESRSRVA", "QEZCHBKL", "QEZCHBKS", "QEZLSGNU", "QEZOLBKL", "QEZRTBKD", "QEZRTBKH", "QEZRTBKO", "QEZRTBKS", "QFPADAP1", "QFPADOLD", "QFPADOLS", "QFPADOLU", "QFPADRNI", "QFPADRUA", "QFPRLNWS", "QFPRRNWS", "QFPZAAPI", "QFVLSTA", "QFVLSTNL", "QFVRTVCD", "QGLDPAPI", "QGLDUAPI", "QGY", "QGYFNDF", "QGYGTLE", "QGYOLAFP", "QGYOLJBL", "QGYOLJOB", "QGYOLMSG", "QGYOLOBJ", "QGYOLSPL", "QGYRATLO", "QGYRHRCM", "QGYRPRTA", "QGYRPRTL", "QGYRTVSJ", "QHF", "QHFLSTFS", "QHFRDDR", "QIMGAPII", "QITDRSTS", "QJOJRNENT", "QJORJIDI", "QJOSJRNE", "QJOURNAL", "QKRBSPNEGO", "QLEAWI", "QLG", "QLGLCL", "QLGRLNGI", "QLGRTVCD", "QLGRTVCI", "QLGRTVCT", "QLGRTVLI", "QLGRTVSS", "QLGSORT", "QLGSRTIO", "QLIJRNL", "QLIRLIBD", "QLP", "QLPINSLP", "QLPLPRDS", "QLPRAGR", "QLYWRTBI", "QLZA", "QLZAADDK", "QLZADDLI", "QLZAGENK", "QLZARTV", "QLZARTVK", "QMHCTLJL", "QMHLJOBL", "QMHLSTM", "QMHOLHST", "QMHQCDQ", "QMHQJRNL", "QMHQRDQD", "QMHRCVM", "QMHRCVPM", "QMHRDQM", "QMHRMFAT", "QMHRMQAT", "QMHRSNEM", "QMHRTVM", "QMHRTVRQ", "QMR", "QMRAP1", "QNMRCVDT", "QNMRGFN", "QNMRGTI", "QNMRRGF", "QOGRTVOE", "QOKDSPDP", "QOKSCHD", "QOLQLIND", "QOLRECV", "QOLSEND", "QOLSETF", "QP0LFLOP", "QP0LROR", "QP0LRRO", "QP0LSCAN", "QP0LSTDI", "QP0MSRTVSO", "QPASTRPT", "QPDETCPP", "QPDETCVT", "QPDETPOL", "QPDETRPD", "QPDETRTV", "QPDETSND", "QPDETWCH", "QPDSRVPG", "QPMAAPI", "QPMDCPRM", "QPMLPFRD", "QPMLPMGT", "QPQ", "QPQAPME", "QPQMAP", "QPQOLPM", "QPQRAFPI", "QPQRPME", "QPTRTVPO", "QPZCPYSV", "QPZCRTFX", "QPZGENNM", "QPZGROUP", "QPZLOGFX", "QPZLSTFX", "QPZRTVFX", "QQQQRY", "QRCVDTAQ", "QRZRRSI", "QRZSCHE", "QSCCHGCT", "QSCJOINT", "QSCRWCHI", "QSCRWCHL", "QSCRXMLI", "QSCSWCH", "QSNAPI", "QSOTLSA", "QSPBOPNC", "QSPBSEPP", "QSPEXTWI", "QSPGETSP", "QSPMOVJB", "QSPMOVSP", "QSPOLJBQ", "QSPOLOTQ", "QSPRILSP", "QSPRJOBQ", "QSPROUTQ", "QSPRWTRI", "QSPSETWI", "QSPSNDWM", "QSPSPLI", "QSQCHKS", "QSQGNDDL", "QSQPRCED", "QSR", "QSRLIB01", "QSRLSAVF", "QSRRSTO", "QSRSAVO", "QSXFTRPB", "QSXSRVPL", "QSY", "QSYDIGID", "QSYEIMAPI", "QSYJRNL", "QSYLATLO", "QSYLAUTU", "QSYLOBJA", "QSYLOBJP", "QSYLUSRA", "QSYOLUC", "QSYOLVLE", "QSYRAUTU", "QSYREG", "QSYRTVAI", "QSYRTVSA", "QSYRTVSE", "QSYRTVUA", "QSYRUPWD", "QSYRUSRA", "QSYRUSRI", "QSYSUPWD", "QSYUSRIN", "QSYVLDL", "QSZCRTPD", "QSZCRTPL", "QSZPKGPO", "QSZRTVPR", "QSZSLTPR", "QSZSPTPR", "QTACJMA", "QTACTLDV", "QTAFROBJ", "QTARCGYL", "QTARCTGF", "QTARCTGI", "QTARDCAP", "QTARDINF", "QTARDSTS", "QTARJMA", "QTARTLBL", "QTASCTGF", "QTECRTVS", "QTEDBGS", "QTEDBGSI", "QTEDMPV", "QTERTVPV", "QTES", "QTHMCTLT", "QTMMSNDM", "QTMSCRTSNM", "QTNADDCR", "QTNCHGCO", "QTNRCMTI", "QTNXADTP", "QTOBUPDT", "QTOCC4IF", "QTOCCVTI", "QTOCLPPJ", "QTOCNETSTS", "QTOCPPPAPI", "QTOOSPF1", "QTOQMONAPI", "QTQICONV", "QTRXRLRL", "QTRXRLSA", "QTRXRLSL", "QTVOPNVT", "QTWAIDSP", "QTWCHKSP", "QUHRHLPT", "QUS", "QUSADDUI", "QUSCUSAT", "QUSEC", "QUSGEN", "QUSLFLD", "QUSLJOB", "QUSLMBR", "QUSLOBJ", "QUSLRCD", "QUSLSPL", "QUSREG", "QUSRJOBI", "QUSRMBRD", "QUSROBJD", "QUSRSPLA", "QUSRUIAT", "QUSRUSAT", "QVOIRCLD", "QVOIRCLG", "QVTRMSTG", "QWCADJTM", "QWCATTR", "QWCCHGJP", "QWCCHGPL", "QWCCHGTN", "QWCCVTDT", "QWCJBITP", "QWCJRNL", "QWCLASBS", "QWCLOBJL", "QWCLSCDE", "QWCOLTHD", "QWCRCLSI", "QWCRDTAA", "QWCRIPLA", "QWCRJBLK", "QWCRLCKI", "QWCRLRQI", "QWCRNETA", "QWCRSSTS", "QWCRSVAL", "QWCRTVCA", "QWCRTVTM", "QWCRTVTZ", "QWDCSBSE", "QWDLSBSE", "QWDLSJBQ", "QWDRJOBD", "QWDRSBSD", "QWPZ", "QWPZTAFP", "QWSRTVOI", "QWTCHGJB", "QWTRMVJL", "QWTRTVPX", "QWTRTVTA", "QWTSETPX", "QWVOLACT", "QWVOLAGP", "QWVRCSTK", "QXDADBBK", "QXDAEDRS", "QYASPOL", "QYASRDI", "QYASRDMS", "QYASRTVDDD", "QYASSDMO", "QYCDCUSG", "QYCDRCUI", "QYCUCERTI", "QYDOCOMMON", "QYDORTVR", "QYPERPEX", "QYPSCOLL", "QYPSSRVS", "QZCACLT", "QZD", "QZDMMDTA", "QZIPUTIL", "QZLS", "QZLSCHSI", "QZLSLSTI", "QZLSOLST", "QZMF", "QZMFASRV", "QZNFNFSO", "QZNFRTVE", "SCHED", "SIGNAL", "SQL", "SQLCLI", "SQLENV", "SQLFP", "SQLSCDS", "SQLUDF", "SYSIPC", "SYSSEM", "SYSSTAT", "SYSTYPES", "TIME", "TRGBUF", "UNISTD"];

describe('Filter Tests', { concurrent: true }, () => {
  it(`Simple 'ends with'`, () => {
    const filter = parseFilter("*cmd", 'simple');
    const filtered = QSYSINCS.filter(t => filter.test(t));
    expect(filtered.length).toBe(3);
    expect(filtered.filter(t => t.endsWith("CMD")).length).toBe(filtered.length);
  });

  it(`Simple 'starts with'`, () => {
    const filter = parseFilter("sql*", 'simple');
    const filtered = QSYSINCS.filter(t => filter.test(t));
    expect(filtered.length).toBe(6);
    expect(filtered.filter(t => t.startsWith("SQL")).length).toBe(filtered.length);
  });

  it(`Simple 'contains'`, () => {
    const filter = parseFilter("*USR*", 'simple');
    const filtered = QSYSINCS.filter(t => filter.test(t));
    expect(filtered.length).toBe(11);
    expect(filtered.filter(t => t.includes("USR")).length).toBe(filtered.length);
  });

  it(`Multiple simples`, () => {
    const filter = parseFilter("SQL*,*CMD,*USR*", 'simple');
    const filtered = QSYSINCS.filter(t => filter.test(t));
    expect(filtered.length).toBe(20);
    expect(filtered.filter(t => t.startsWith("SQL") || t.endsWith("CMD") || t.includes("USR")).length).toBe(filtered.length);
  });

  it(`Multiple simples with whitespaces`, () => {
    const filter = parseFilter(" SQL*,*CMD  ,  *USR*  ", 'simple');
    const filtered = QSYSINCS.filter(t => filter.test(t));
    expect(filtered.length).toBe(20);
    expect(filtered.filter(t => t.startsWith("SQL") || t.endsWith("CMD") || t.includes("USR")).length).toBe(filtered.length);
  });

  it(`RegExp`, () => {
    const filter = parseFilter("^[^E].*CHG.*$", 'regex');
    const filtered = QSYSINCS.filter(t => filter.test(t));
    expect(filtered.length).toBe(8);
    expect(filtered.filter(t => !t.startsWith("E") && t.indexOf("CHG")).length).toBe(filtered.length);
  });

  it(`Is case insensitive`, () => {
    const lowerCaseFilter = parseFilter("sql*", 'simple');
    const upperCaseFilter = parseFilter("SQL*", 'simple');
    const mixedCaseFilter = parseFilter("SqL*", 'simple');
    const lowerCaseFiltered = QSYSINCS.filter(t => lowerCaseFilter.test(t));
    const upperCaseFiltered = QSYSINCS.filter(t => upperCaseFilter.test(t));
    const mixedCaseFiltered = QSYSINCS.filter(t => mixedCaseFilter.test(t));

    expect(lowerCaseFiltered.length).toBe(6);
    expect(upperCaseFiltered.length).toBe(6);
    expect(mixedCaseFiltered.length).toBe(6);

    expect(upperCaseFiltered.every(t => lowerCaseFiltered.includes(t))).toBe(true);
    expect(lowerCaseFiltered.every(t => mixedCaseFiltered.includes(t))).toBe(true);
  });

  it(`Is relevant`, () => {
    const notAFilter = parseFilter("QSYSINC", 'simple');
    const notAFilterEither = parseFilter("QSYSINC", 'regex');
    const aFilter = parseFilter("*QSYS*", 'simple');

    expect(notAFilter.noFilter).toBe(true);
    expect(notAFilterEither.noFilter).toBe(true);
    expect(aFilter.noFilter).toBe(false);
  });

  it(`Single generic name`, () => {
    const generic = singleGenericName("SQL*");
    const notGeneric = singleGenericName("*SQL");
    const notGenericEither = singleGenericName("SQL*,QSYS*");

    expect(generic).toBe("SQL*");
    expect(notGeneric).toBeUndefined();
    expect(notGenericEither).toBeUndefined();
  });
});
