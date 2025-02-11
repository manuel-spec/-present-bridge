import { config as loadDotenv } from "dotenv";
import { EnvValidationError, parseEnv, type Env } from "./env.js";

loadDotenv();

function loadEnvOrExit(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
    } else {
      console.error("Invalid environment configuration:", error);
    }
    process.exit(1);
  }
}

export const env = loadEnvOrExit();
export { parseEnv, EnvValidationError, type Env };
