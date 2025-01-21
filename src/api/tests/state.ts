import IBMi from "../IBMi";

let connection: IBMi;

export function setConnection(conn: IBMi) {
  connection = conn;
}

export function getConnection() {
  return connection!;
}