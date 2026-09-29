import type { TestProject } from "vitest/node";
import { disposeConnection, envVars, newConnection } from "./connection";
import { existsSync } from "fs";
import path from "path";
import { JsonConfig, JsonStorage } from "./json";
import { TestEnv } from "./env";

export async function setup(project: TestProject) {
  console.log(`------------------------------`);
  TestEnv.logEnvironmentVariables();
  console.log(`------------------------------`);

  const connectionName = `${envVars.VITE_DB_USER}@${envVars.VITE_SERVER}`;

  const jsonStoragePath = path.join(__dirname, `..`, JsonStorage.NAME);
  const jsonConfigPath = path.join(__dirname, `..`, JsonConfig.NAME);

  const configsExist = existsSync(jsonStoragePath) && existsSync(jsonConfigPath);
  const testStorage = new JsonStorage();
  const testConfig = new JsonConfig();
  const configsMatchConnection = configsExist &&
    testStorage.matchesConnection(connectionName) &&
    testConfig.matchesConnection(connectionName);

  if (configsMatchConnection) {
    console.log(`⏩ JSON server cache storage and connection config found for ${connectionName}. Skipping new connection setup.\n`);
  } else {
    if (configsExist) {
      console.log(`⏳ JSON server cache storage and connection config exist but do not match current connection (${connectionName}). Starting new connection setup.\n`);
    } else {
      console.log(`⏳ JSON server cache storage and connection config not found. Starting new connection setup.\n`);
    }
    const connection = await newConnection(true);
    await disposeConnection(connection);
    console.log(`✅ Connection setup complete.`);
  }
  console.log(`Server cache storage: ${jsonStoragePath}`);
  console.log(`Connection config: ${jsonConfigPath}`);
  console.log(`------------------------------\n`);
}

export async function teardown() { }