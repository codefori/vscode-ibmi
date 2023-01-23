import IBMi from "../IBMi";
import * as certificates from "./certificates";

export async function startup(connection: IBMi) {
  const host = connection.currentHost;

  const result = await connection.sendCommand({
    command: `DEBUG_SERVICE_KEYSTORE_PASSWORD=${host} /QIBM/ProdData/IBMiDebugService/bin/encryptKeystorePassword.sh | /usr/bin/tail -n 1`
  });

  const password = result.stdout;

  const keystorePath = certificates.getKeystorePath();

  const startup = await connection.sendCommand({
    command: `DEBUG_SERVICE_KEYSTORE_PASSWORD="${password}" DEBUG_SERVICE_KEYSTORE_FILE="${keystorePath}" /QOpenSys/usr/bin/nohup "/QIBM/ProdData/IBMiDebugService/bin/startDebugService.sh"`
  });

  if (startup.code && startup.code > 0) {
    return false;
  } else {
    return true;
  }
}