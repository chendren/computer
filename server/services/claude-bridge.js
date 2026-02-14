import { spawn } from 'child_process';

export function queryClaude(prompt, systemPrompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'text'];
    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const proc = spawn('claude', args, {
      shell: true,
      env: { ...process.env, CLAUDECODE: '' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `claude exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

export function queryClaudeStreaming(prompt, systemPrompt, onChunk, onDone) {
  const args = ['-p', prompt, '--output-format', 'text'];
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  const proc = spawn('claude', args, {
    shell: true,
    env: { ...process.env, CLAUDECODE: '' },
  });

  proc.stdout.on('data', (chunk) => onChunk(chunk.toString()));
  proc.stderr.on('data', (chunk) => onChunk(chunk.toString()));
  proc.on('close', (code) => onDone(code));
  proc.on('error', (err) => onDone(1, err));

  return proc;
}
