type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${scope} — ${message}`;
  if (level === 'error') console.error(line, extra ?? '');
  else if (level === 'warn') console.warn(line, extra ?? '');
  else console.log(line, extra ?? '');
}

export function logger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => emit('debug', scope, message, extra),
    info: (message: string, extra?: unknown) => emit('info', scope, message, extra),
    warn: (message: string, extra?: unknown) => emit('warn', scope, message, extra),
    error: (message: string, extra?: unknown) => emit('error', scope, message, extra),
  };
}
