import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentBridge } from '../bridge/AgentBridge';
import { HookLogger } from '../bridge/HookLogger';
import type { LogWriter } from '../bridge/HookLogger';
import type { LogEntry } from '../bridge/types';

beforeEach(() => {
  AgentBridge._reset();
  HookLogger._reset();
});

describe('HookLogger.registerAll / handle', () => {
  it('should buffer log entries when hooks fire', async () => {
    HookLogger.registerAll();

    await AgentBridge.fire('beforeDbRead', 'A8', 'trace-1', 'span-1', { table: 'recipes' });

    expect(HookLogger.bufferSize).toBe(1);
  });

  it('should set correct log level based on hook name', async () => {
    const entries: LogEntry[] = [];
    const writer: LogWriter = {
      write: async (e) => {
        entries.push(...e);
      },
    };
    HookLogger.setWriter(writer);
    HookLogger.registerAll();

    // beforeX → debug
    await AgentBridge.fire('beforeDbRead', 'A8', 'trace-1', 'span-1');
    // afterX → info
    await AgentBridge.fire('afterDbRead', 'A8', 'trace-1', 'span-1');
    // onAgentError → error
    await AgentBridge.fire('onAgentError', 'A1', 'trace-2', 'span-2');
    // onAgentRetry → warn
    await AgentBridge.fire('onAgentRetry', 'A4', 'trace-3', 'span-3');

    await HookLogger.flush();

    expect(entries).toHaveLength(4);
    expect(entries[0].level).toBe('debug');
    expect(entries[1].level).toBe('info');
    expect(entries[2].level).toBe('error');
    expect(entries[3].level).toBe('warn');
  });

  it('should sanitize PII from payload', async () => {
    const entries: LogEntry[] = [];
    const writer: LogWriter = {
      write: async (e) => {
        entries.push(...e);
      },
    };
    HookLogger.setWriter(writer);
    HookLogger.registerAll();

    await AgentBridge.fire('beforeJwtVerify', 'A7', 'trace-1', 'span-1', {
      userId: 'user-123',
      email: 'test@example.com',
      password: 'secret',
      action: 'login',
    });

    await HookLogger.flush();

    expect(entries).toHaveLength(1);
    const payload = entries[0].payload;
    expect(payload).toBeDefined();
    expect(payload?.userId).toBe('[REDACTED]');
    expect(payload?.email).toBe('[REDACTED]');
    expect(payload?.password).toBe('[REDACTED]');
    expect(payload?.action).toBe('login');
  });
});

describe('HookLogger.flush', () => {
  it('should write buffered entries to writer', async () => {
    const entries: LogEntry[] = [];
    const writer: LogWriter = {
      write: async (e) => {
        entries.push(...e);
      },
    };
    HookLogger.setWriter(writer);
    HookLogger.registerAll();

    await AgentBridge.fire('beforeDbWrite', 'A8', 'trace-1', 'span-1');
    await AgentBridge.fire('afterDbWrite', 'A8', 'trace-1', 'span-1');

    await HookLogger.flush();

    expect(entries).toHaveLength(2);
    expect(entries[0].hookName).toBe('beforeDbWrite');
    expect(entries[1].hookName).toBe('afterDbWrite');
    expect(HookLogger.bufferSize).toBe(0);
  });

  it('should not write when buffer is empty', async () => {
    const writer: LogWriter = {
      write: vi.fn(),
    };
    HookLogger.setWriter(writer);

    await HookLogger.flush();

    expect(writer.write).not.toHaveBeenCalled();
  });

  it('should auto-flush after scheduleFlush interval', async () => {
    vi.useFakeTimers();

    const entries: LogEntry[] = [];
    const writer: LogWriter = {
      write: async (e) => {
        entries.push(...e);
      },
    };
    HookLogger.setWriter(writer);
    HookLogger.registerAll();

    await AgentBridge.fire('afterMigration', 'A8', 'trace-1', 'span-1');

    // Buffer should have 1 entry, writer not called yet
    expect(HookLogger.bufferSize).toBe(1);
    expect(entries).toHaveLength(0);

    // Advance timers past 500ms flush interval
    await vi.advanceTimersByTimeAsync(600);

    expect(entries).toHaveLength(1);

    vi.useRealTimers();
  });
});

describe('HookLogger.unregisterAll', () => {
  it('should stop logging after unregister', async () => {
    HookLogger.registerAll();

    await AgentBridge.fire('beforeDbRead', 'A8', 'trace-1', 'span-1');
    expect(HookLogger.bufferSize).toBe(1);

    await HookLogger.flush();
    HookLogger.unregisterAll();

    await AgentBridge.fire('beforeDbRead', 'A8', 'trace-2', 'span-2');
    expect(HookLogger.bufferSize).toBe(0);
  });
});

describe('HookLogger log entry structure', () => {
  it('should include all required fields', async () => {
    const entries: LogEntry[] = [];
    const writer: LogWriter = {
      write: async (e) => {
        entries.push(...e);
      },
    };
    HookLogger.setWriter(writer);
    HookLogger.registerAll();

    await AgentBridge.fire('beforeAgentRun', 'A1', 'trace-abc', 'span-xyz');
    await HookLogger.flush();

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.traceId).toBe('trace-abc');
    expect(entry.spanId).toBe('span-xyz');
    expect(entry.agentId).toBe('A1');
    expect(entry.hookName).toBe('beforeAgentRun');
    expect(entry.wallTime).toBeDefined();
    expect(typeof entry.perfMark).toBe('number');
  });
});
