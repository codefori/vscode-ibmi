IBM i uses the EBCDIC character set in contrast to your workstation, which uses some ASCII based character set (Windows, MAC and Linux each use their own variant). This may cause some issues with the names displayed for the objects, files and members in the Object Browser. Even worse, IBM i has several EBCDIC variants, each targeting a national language, and the special US characters '#', '@' and '$' allowed in IBM i object and member names have other code values in the other variants. But IBM i still expects the same code values of the US characters to be used, and thus the national characters with these code values must be used instead.

From version 1.4.0 of this extension the code for handling these differences has been changed, primarily when SQL is enabled and used for retrieving object and member lists. Previously there were no conversion between the US and national characters, but now Code for IBM i converts the US characters into the national characters. This is controlled by the coded character set ID (CCSID) value on the IBM i user profile used for the connection, alternatively the system value `QCCSID` (if the user profile CCSID value is `*SYSVAL`). The CCSID is probably already set on your user profile or system, but if you need to change to another language, here are some examples of how to set the CCSID:

| Language | Command | Variant characters |
| -------- | ------- | :----------------: |
| US | `CHGUSRPRF _yourprofile_ CCSID(37)` | $, #, @ |
| DK | `CHGUSRPRF _yourprofile_ CCSID(277)` | Å, Æ, Ø |
| IT with euro | `CHGUSRPRF _yourprofile_ CCSID(1144)` | $, £, § |

The conversion is done in both directions: When reading object and members names for the list, but also when creating a source file or member or when applying a filter to a list. For non-US users, you should always use your national characters instead of the US characters, also in filter values.

If you change the CCSID for your profile on the server, you may have to change your filters as well, if you have used any of the special characters in the filter!

The special CCSID value 65535 means "no conversion" - and this will disable the SQL support. It is **not** recommended to use CCSID 65535 and most newer systems have a CCSID different from 65535. But you may experience this value on older systems. The solution here would be to change the user profile to a CCSID value corresponding to your national language, e.g. 280 in Italy or 297 in France.

## Setting environment variables

If you still are experiencing issues after setting the CCSID value, you may want to check that the IBM i PASE environment locale is set correctly:

- OS 7.4 or greater:

[7.4 and above defaults to UTF-8](https://www.ibm.com/docs/en/i/7.4?topic=system-default-pase-ccsid-locale-changed-utf-8) and there should be no issue.

- OS 7.3 or earlier:

The SSH daemon must start with the correct `PASE_LANG` and `QIBM_PASE_CCSID` environment variables set. You probably want to use a locale that defaults to CCSID 1208. **Locale is case sensitive**. E.g., `FR_FR` is different from `fr_FR`.

1. Change the PASE language and CCSID *system wide* by using `WRKENVVAR LEVEL(*SYS)` to set:
   - the appropriate locale/language, e.g., `PASE_LANG 'FR_FR'`.  You can find infomation on PASE for i Locales [here](https://www.ibm.com/docs/en/i/7.4?topic=ssw_ibm_i_74/apis/pase_locales.htm)
   - `QIBM_PASE_CCSID` should be `1208`.
2. **Restart** the SSH daemon.

You are also able to change the environment variables at a `*JOB` level, but it is recommend to do it once for your entire system.

Some links to pages which containing information on variant characters:

- [IBM definition of Variant characters](https://www.ibm.com/docs/en/db2-for-zos/11?topic=ccsids-variant-characters)
- [IBM Support](https://www.ibm.com/support/pages/what-impact-changing-qccsid-shipped-65535-another-ccsid)
- [Wikipedia](https://en.wikipedia.org/wiki/EBCDIC)