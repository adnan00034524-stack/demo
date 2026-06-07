const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUTH_DIR = path.join(__dirname, '..', '.wwebjs_auth');

function clearProfileLocks(clientId = 'session') {
  const sessionDir = path.join(AUTH_DIR, clientId);
  if (!fs.existsSync(sessionDir)) return;

  const lockFiles = ['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie', 'DevToolsActivePort'];
  const searchDirs = [
    sessionDir,
    path.join(sessionDir, 'Default'),
    path.join(sessionDir, 'userDataDir'),
  ];

  searchDirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    lockFiles.forEach(file => {
      const filePath = path.join(dir, file);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`Removed lock file: ${filePath}`);
        } catch (err) {
          console.warn(`Could not remove lock file:`, err.message);
        }
      }
    });
  });
}

function killOrphanBrowsers() {
  try {
    execSync(
      `powershell -Command "$p = Get-Process chrome -ErrorAction SilentlyContinue; if ($p) { $p | Stop-Process -Force }"`,
      { timeout: 5000, stdio: 'pipe' }
    );
    console.log('Chrome processes cleaned');
  } catch (err) {
    // No Chrome processes found — normal
  }
}

module.exports = { clearProfileLocks, killOrphanBrowsers };
