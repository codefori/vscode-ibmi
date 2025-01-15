
/**
 * Default credentials for connecting to the daemon server, 
 * loaded from environment variables.
 */
export const ENV_CREDS = {
  host: process.env.VITE_SERVER || `localhost`,
  user: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS,
  port: parseInt(process.env.VITE_DB_PORT || `22`)
}