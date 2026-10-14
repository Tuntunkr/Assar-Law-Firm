import { connect } from 'node:net';
import type { Readable } from 'node:stream';

export type ScanOutcome =
  | { status: 'clean'; engine: string }
  | { status: 'infected'; engine: string; signature: string }
  /** Scanning was deliberately turned off (development only). Never reported as clean. */
  | { status: 'skipped'; engine: string };

export interface ScanProvider {
  /** Throws if the scanner is unreachable or errors; callers record that as `scan_failed`. */
  scan(content: Readable): Promise<ScanOutcome>;
}

export class DisabledScanProvider implements ScanProvider {
  async scan(content: Readable): Promise<ScanOutcome> {
    content.resume(); // drain
    return { status: 'skipped', engine: 'disabled' };
  }
}

const CHUNK = 64 * 1024;

/** Minimal clamd client using the INSTREAM command (https://docs.clamav.net/manual/Usage/Scanning.html). */
export class ClamAvScanProvider implements ScanProvider {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 5 * 60_000,
  ) {}

  scan(content: Readable): Promise<ScanOutcome> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let reply = '';
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        content.destroy();
        fn();
      };
      socket.setTimeout(this.timeoutMs, () => done(() => reject(new Error('clamd timed out'))));
      socket.on('error', (e) => done(() => reject(e)));
      socket.on('data', (d) => (reply += d.toString('utf8')));
      socket.on('close', () => done(() => resolve(parseReply(reply))));
      content.on('error', (e) => done(() => reject(e)));

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        content.on('data', (buf: Buffer) => {
          for (let i = 0; i < buf.length; i += CHUNK) {
            const part = buf.subarray(i, i + CHUNK);
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length);
            if (!socket.write(Buffer.concat([len, part]))) {
              content.pause();
              socket.once('drain', () => content.resume());
            }
          }
        });
        content.on('end', () => socket.write(Buffer.alloc(4))); // zero-length chunk terminates the stream
      });
    });
  }
}

export function parseReply(reply: string): ScanOutcome {
  const text = reply.replace(/\0/g, '').trim();
  if (/^stream:\s*OK$/i.test(text)) return { status: 'clean', engine: 'clamav' };
  const found = /^stream:\s*(.+)\s+FOUND$/i.exec(text);
  if (found) return { status: 'infected', engine: 'clamav', signature: found[1]! };
  throw new Error(`Unexpected clamd reply: ${text.slice(0, 120) || '(empty)'}`);
}
