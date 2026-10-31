// Run by an isolated VS Code Extension Development Host, not by node --test.
import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
export async function run(): Promise<void> {
  const manifest = require('../../package.json') as { publisher: string; name: string };
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension, 'Extension is installed in development host');
  await extension.activate(); assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['open','discover','add','refresh','redditToken','clearRedditToken']) assert.ok(commands.includes(`shipstats.${id}`), `Registered ${id}`);
  await vscode.commands.executeCommand('shipstats.open');
  await vscode.commands.executeCommand('shipstats.refresh');
  await vscode.commands.executeCommand('shipstats.clearRedditToken');
  if (process.env.SHIPSTATS_SMOKE_REPORT) writeFileSync(process.env.SHIPSTATS_SMOKE_REPORT, JSON.stringify({ passed:true, vscode:vscode.version, checks:['activation','six command registrations','dashboard creation','empty refresh','secret clear'], timestamp:new Date().toISOString() },null,2));
}
