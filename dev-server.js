const { execSync } = require("child_process");
const port = process.env.PORT || 3456;
require("child_process").execFileSync(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", "-p", String(port)],
  { stdio: "inherit", cwd: __dirname }
);
