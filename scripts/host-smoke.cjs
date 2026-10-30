// Launch an isolated real desktop VS Code instance; never uses your normal profile.
const { spawn } = require('node:child_process');
const { mkdtempSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
let executable = process.env.VSCODE_EXECUTABLE;
if (!executable && process.platform === 'win32') {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs/Microsoft VS Code/Code.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft VS Code/Code.exe')
  ];
  executable = candidates.find(existsSync);
} else if (!executable && process.platform === 'darwin') executable = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
else if (!executable) executable = 'code';
if (!executable) { console.error('Set VSCODE_EXECUTABLE to the full path of desktop VS Code (Code.exe on Windows).'); process.exit(1); }
const scratch = mkdtempSync(path.join(tmpdir(),'shipstats-host-'));
const report = path.join(scratch,'report.json');
const env = {...process.env, SHIPSTATS_SMOKE_REPORT:report}; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable,[
  '--new-window','--wait','--skip-welcome','--skip-release-notes','--disable-extensions',
  '--user-data-dir',path.join(scratch,'profile'),'--extensions-dir',path.join(scratch,'extensions'),
  `--extensionDevelopmentPath=${root}`,`--extensionTestsPath=${path.join(root,'dist/test/host-smoke.js')}`
],{env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{
  if (code || !existsSync(report)) { console.error(`Host smoke did not pass. Exit ${code}; isolated profile: ${scratch}`); process.exitCode=1; }
  else console.log(readFileSync(report,'utf8'));
});
