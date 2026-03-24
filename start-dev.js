const { execSync } = require('child_process');
const port = process.env.PORT || 3000;
execSync(`npx next dev -p ${port}`, { stdio: 'inherit', cwd: __dirname });
