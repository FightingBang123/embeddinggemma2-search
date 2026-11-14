'use strict';
/**
 * 管理 llama-server 子进程：按平台找二进制、挑端口、等就绪、退出清理。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

function freePort(preferred = 8080) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => {
      // preferred 被占用：交给系统分配
      const any = net.createServer();
      any.listen(0, '127.0.0.1', () => {
        const { port } = any.address();
        any.close(() => resolve(port));
      });
    });
    srv.listen(preferred, '127.0.0.1', () => {
      srv.close(() => resolve(preferred));
    });
  });
}

function candidateBinaries(runtimeDir) {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const subdirs =
    process.platform === 'win32'
      ? ['vulkan', 'cuda', 'cpu']
      : process.platform === 'darwin'
        ? ['metal', 'cpu']
        : ['vulkan', 'cpu'];
  return subdirs.map((d) => path.join(runtimeDir, d, exe));
}

function resolveBinary(runtimeDir) {
  for (const candidate of candidateBinaries(runtimeDir)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

class LlamaServer {
  constructor({ runtimeDir, modelFile, logsDir, ctx = 2048, onEvent = null }) {
    this.runtimeDir = runtimeDir;
    this.modelFile = modelFile;
    this.logsDir = logsDir;
    this.ctx = ctx;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
    this.proc = null;
    this.port = null;
    this.baseUrl = null;
    this.logStream = null;
  }

  emit(event, payload) {
    if (!this.onEvent) return;
    try {
      this.onEvent(event, payload);
    } catch {
      /* 进度回调不能影响启动 */
    }
  }

  get available() {
    return Boolean(resolveBinary(this.runtimeDir));
  }

  get missingReason() {
    if (!fs.existsSync(this.modelFile)) return 'model-missing';
    if (!resolveBinary(this.runtimeDir)) return 'runtime-missing';
    return null;
  }

  async start() {
    const reason = this.missingReason;
    if (reason) throw new Error(reason);

    const bin = resolveBinary(this.runtimeDir);
    this.port = await freePort(8080);
    this.baseUrl = `http://127.0.0.1:${this.port}`;
    const logFile = path.join(this.logsDir, 'llama.log');

    const args = [
      '--model', this.modelFile,
      '--alias', 'embeddinggemma2',
      '--embedding',
      '--pooling', 'mean',
      '--ctx-size', String(this.ctx),
      '--batch-size', String(this.ctx),
      '--ubatch-size', String(this.ctx),
      '--parallel', '1',
      '--host', '127.0.0.1',
      '--port', String(this.port),
      '-ngl', '99',
      '--no-webui',
      '--log-file', logFile,
    ];

    console.log('[llama] spawn', bin, args.join(' '));
    // stdio 交给 --log-file：不占用管道，打包后也不会因为父进程退出而丢日志
    this.proc = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, stdio: 'ignore' });
    this.proc.on('exit', (code, signal) => {
      console.log(`[llama] exited code=${code} signal=${signal}`);
      this.proc = null;
    });

    this.emit('spawn', this.baseUrl);
    await this.waitReady(60000);
    this.emit('ready', this.baseUrl);
    console.log('[llama] ready at', this.baseUrl);
    return this.baseUrl;
  }

  async waitReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.proc) throw new Error('llama-server exited during startup（详见 logs/llama.log）');
      try {
        const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) return true;
      } catch {
        /* not ready yet */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('llama-server 启动超时（详见 logs/llama.log）');
  }

  stop() {
    if (!this.proc) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        this.proc.kill('SIGTERM');
        setTimeout(() => this.proc && this.proc.kill('SIGKILL'), 3000).unref();
      }
    } catch (err) {
      console.error('[llama] stop failed:', err.message);
    }
    this.proc = null;
    if (this.logStream) this.logStream.end();
  }
}

module.exports = { LlamaServer, resolveBinary, freePort };
