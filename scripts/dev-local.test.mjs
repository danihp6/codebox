import { describe, expect, it } from 'vitest';
import { UsageError, appLinkPath, baseUrlOf, bindPort, parseArgs, withPort } from './dev-local.mjs';

describe('parseArgs', () => {
  it('builds, pairs and leaves the port alone by default', () => {
    expect(parseArgs([])).toEqual({
      build: true,
      fresh: false,
      pair: true,
      open: false,
      port: null,
      help: false,
    });
  });

  it('reads each switch', () => {
    const options = parseArgs(['--no-build', '--fresh', '--no-pair', '--open', '--help']);
    expect(options).toEqual({
      build: false,
      fresh: true,
      pair: false,
      open: true,
      port: null,
      help: true,
    });
  });

  it('takes the port with a space or with an equals sign', () => {
    expect(parseArgs(['--port', '8790']).port).toBe(8790);
    expect(parseArgs(['--port=8790']).port).toBe(8790);
  });

  it('refuses a missing, non-numeric or out-of-range port', () => {
    for (const argv of [['--port'], ['--port', 'abc'], ['--port=0'], ['--port=65536']]) {
      expect(() => parseArgs(argv)).toThrow(UsageError);
    }
  });

  it('refuses an unknown option instead of ignoring it', () => {
    expect(() => parseArgs(['--frobnicate'])).toThrow(UsageError);
  });
});

describe('bindPort', () => {
  it('reads the port out of the bind address', () => {
    expect(bindPort('127.0.0.1:8787')).toBe(8787);
    expect(bindPort('[::1]:8790')).toBe(8790);
  });

  it('falls back to 8787 when the value is missing or empty', () => {
    expect(bindPort(undefined)).toBe(8787);
    expect(bindPort('')).toBe(8787);
  });

  it('refuses a value without a usable port', () => {
    expect(() => bindPort('8787')).toThrow(UsageError);
    expect(() => bindPort('127.0.0.1:')).toThrow(UsageError);
  });
});

describe('withPort', () => {
  const env = { CB_BIND: '127.0.0.1:8787', CB_PUBLIC_URL: 'http://localhost:8787' };

  it('leaves the environment untouched without a port', () => {
    expect(withPort(env, null)).toBe(env);
  });

  it('moves the bind, the public URL and both allowed origins together', () => {
    expect(withPort(env, 8790)).toEqual({
      CB_BIND: '127.0.0.1:8790',
      CB_PUBLIC_URL: 'http://127.0.0.1:8790',
      CB_ALLOWED_ORIGINS: 'http://127.0.0.1:8790,http://localhost:8790',
    });
  });
});

describe('baseUrlOf', () => {
  it('prefers the public URL without a trailing slash', () => {
    expect(baseUrlOf({ CB_PUBLIC_URL: 'http://localhost:8787/' })).toBe('http://localhost:8787');
  });

  it('falls back to loopback and the listened port', () => {
    expect(baseUrlOf({ CB_BIND: '127.0.0.1:8790' })).toBe('http://127.0.0.1:8790');
  });
});

describe('appLinkPath', () => {
  it('puts the app under the install directory the daemon reads', () => {
    expect(appLinkPath({ CB_INSTALL_DIR: '/opt/codebox' })).toMatch(
      /[\\/]opt[\\/]codebox[\\/]app$/,
    );
  });

  it('resolves a relative install directory against the repository root', () => {
    expect(appLinkPath({ CB_INSTALL_DIR: './.state/install' })).toMatch(
      /[\\/]\.state[\\/]install[\\/]app$/,
    );
  });

  it('defaults to .state/install when the variable is absent or empty', () => {
    expect(appLinkPath({})).toMatch(/[\\/]\.state[\\/]install[\\/]app$/);
    expect(appLinkPath({ CB_INSTALL_DIR: '' })).toMatch(/[\\/]\.state[\\/]install[\\/]app$/);
  });
});
