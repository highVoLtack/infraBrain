import { describe, it, expect } from 'vitest';
import { parseCommand, needsShell, runCommand } from '../../src/execution/runner.js';

describe('parseCommand', () => {
  it('splits simple command into executable and args', () => {
    const result = parseCommand('docker inspect nginx');
    expect(result).toEqual({ executable: 'docker', args: ['inspect', 'nginx'] });
  });

  it('handles double-quoted strings', () => {
    const result = parseCommand('echo "hello world"');
    expect(result).toEqual({ executable: 'echo', args: ['hello world'] });
  });

  it('handles single-quoted strings', () => {
    const result = parseCommand("echo 'hello world'");
    expect(result).toEqual({ executable: 'echo', args: ['hello world'] });
  });

  it('handles flags and paths', () => {
    const result = parseCommand('ls -la /tmp');
    expect(result).toEqual({ executable: 'ls', args: ['-la', '/tmp'] });
  });

  it('handles command with no args', () => {
    const result = parseCommand('whoami');
    expect(result).toEqual({ executable: 'whoami', args: [] });
  });
});

describe('needsShell', () => {
  it('returns true for pipe', () => {
    expect(needsShell('cat file | grep pattern')).toBe(true);
  });

  it('returns true for redirect', () => {
    expect(needsShell('echo hello > file.txt')).toBe(true);
  });

  it('returns true for && chaining', () => {
    expect(needsShell('cd /tmp && ls')).toBe(true);
  });

  it('returns true for || chaining', () => {
    expect(needsShell('test -f foo || echo missing')).toBe(true);
  });

  it('returns true for semicolon', () => {
    expect(needsShell('echo a; echo b')).toBe(true);
  });

  it('returns false for simple command', () => {
    expect(needsShell('docker inspect nginx')).toBe(false);
  });
});

describe('runCommand', () => {
  it('executes a simple command and returns RunResult', async () => {
    const result = await runCommand('echo', ['hello'], { timeout: 5000 });
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('returns non-zero exit code for nonexistent binary', async () => {
    const result = await runCommand('nonexistent_binary_xyz', [], { timeout: 5000 });
    expect(result.exitCode).not.toBe(0);
  });

  it('captures stderr on failure', async () => {
    const result = await runCommand('ls', ['/nonexistent_path_xyz_abc'], { timeout: 5000 });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('never throws, always returns RunResult', async () => {
    // Should not throw even on failure
    const result = await runCommand('false', [], { timeout: 5000 });
    expect(result).toBeDefined();
    expect(typeof result.exitCode).toBe('number');
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.stderr).toBe('string');
  });
});
