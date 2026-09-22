import { installCodexIntegration, uninstallCodexIntegration } from "../src/reflex/codex-integration.js";

const action = process.argv[2];
try {
  if (action === "install") {
    const result = await installCodexIntegration();
    console.log(result.changed ? `Installed global model-switch hooks in ${result.config}` : `Global model-switch hooks already installed in ${result.config}`);
    if (result.backup) console.log(`Backup: ${result.backup}`);
    console.log(`Engine: ${result.engine}`);
  } else if (action === "uninstall") {
    const result = await uninstallCodexIntegration();
    console.log(result.changed ? `Removed model-switch hooks from ${result.config}` : `No model-switch hooks found in ${result.config}`);
  } else throw new Error("usage: codex-integration.mjs install|uninstall");
} catch (error) {
  console.error(`model-switch Codex integration: ${error.message}`);
  process.exitCode = 1;
}
