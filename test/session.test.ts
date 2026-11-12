import { afterEach, describe, expect, it } from 'vitest';
import { forgetPassword, isSessionPassword, rememberPassword } from '../src/app/wallet.ts';

afterEach(() => forgetPassword());

describe('password asked again before money leaves', () => {
  it('accepts only the password the session was opened with', () => {
    rememberPassword('correct horse battery staple');
    expect(isSessionPassword('correct horse battery staple')).toBe(true);
    expect(isSessionPassword('correct horse battery stapl')).toBe(false);
    expect(isSessionPassword('Correct horse battery staple')).toBe(false);
    expect(isSessionPassword('')).toBe(false);
  });

  it('treats Unicode-equivalent spellings as the same password, like the key file does', () => {
    rememberPassword('café');
    expect(isSessionPassword('café')).toBe(true);
  });

  it('refuses everything when no session is open or after sign-out', () => {
    expect(isSessionPassword('anything')).toBe(false);
    rememberPassword('secret');
    forgetPassword();
    expect(isSessionPassword('secret')).toBe(false);
  });

  it('follows the latest sign-in', () => {
    rememberPassword('first');
    rememberPassword('second');
    expect(isSessionPassword('first')).toBe(false);
    expect(isSessionPassword('second')).toBe(true);
  });
});
