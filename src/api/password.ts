import IBMi from "./IBMi";

export namespace Password {
  export async function getPasswordExpiration(connection: IBMi) {
    const [row] = (await connection.runSQL(/* sql */`
      Select EXTRACT(EPOCH FROM (DATE_PASSWORD_EXPIRES)) * 1000 AS EXPIRATION,
      DAYS(DATE_PASSWORD_EXPIRES) - DAYS(current_timestamp) as DAYS_LEFT
      FROM TABLE (QSYS2.QSYUSRINFO('${connection.upperCaseName(connection.currentUser)}'))
    `));
    if (row && row.EXPIRATION) {
      return {
        expiration: new Date(Number(row.EXPIRATION)),
        daysLeft: Number(row.DAYS_LEFT)
      }
    }
  }

  export async function changePassword(connection: IBMi, oldPassword: string, newPassword: string) {
      //Use client.execCommand directly so nothing get logged in the output
      const result = await connection.client?.execCommand(`system "CALL PGM(QSYS/QSYCHGPW) PARM(('*CURRENT  ') ('${oldPassword}') ('${newPassword}') (X'00000000') (${oldPassword.length} (*INT 4)) (0 (*INT 4)) (${oldPassword.length} (*INT 4)) (0 (*INT 4)))"`);
      if(result?.code !== 0){
        throw new Error(result?.stderr);
      }
    }
}