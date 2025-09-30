import crypto from 'crypto';

export function hashSha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function genSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function genSessionToken(): string {
  return crypto.randomUUID();
}

export function minutesFromNow(min: number) {
  return new Date(Date.now() + min * 60_000);
}
