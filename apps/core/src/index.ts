import { env } from "./config/load-env.js";
import { bootstrap, registerSignalHandlers } from "./bootstrap.js";

void bootstrap(env)
  .then(({ shutdown }) => {
    registerSignalHandlers(shutdown);
  })
  .catch((error) => {
    console.error("Failed to start Packet Bridge core:", error);
    process.exit(1);
  });
