/**
 * Pulls one LiDAR frame out of the PandaSet archive without downloading it.
 *
 * PandaSet is mirrored on HuggingFace as a single 44.5 GB zip. A zip keeps its
 * index at the end, so the payload never has to be touched: fetch the tail,
 * find the End Of Central Directory, follow it to the central directory, look
 * up the one member you want, and range-fetch exactly those bytes. That's about
 * 12 MB instead of 44.5 GB.
 *
 * ZIP64 is required here — entries past 4 GB keep their real offset in the
 * extra field rather than the 32-bit slot.
 *
 *   node scripts/fetch-pandaset-frame.mjs [sequence] [frame]
 *   node scripts/bake-pandaset-frame.py            # then decimate + bake
 *
 * Data: PandaSet by Hesai and Scale AI, CC BY 4.0.
 * https://pandaset.org
 */
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ARCHIVE =
  'https://huggingface.co/datasets/georghess/pandaset/resolve/main/pandaset.zip';
/** One or more "sequence/frame" pairs, e.g. 019/00 092/20. */
const REQUESTS = (process.argv.slice(2).length ? process.argv.slice(2) : ['019/00']).map((arg) => {
  const [seq, frame = '00'] = arg.split('/');
  return { seq, frame: frame.padStart(2, '0') };
});

const OUT_DIR = fileURLToPath(new URL('../.cache/pandaset/', import.meta.url));

async function range(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok && res.status !== 206) throw new Error(`range ${start}-${end}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function readDirectory(url) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const total = Number(head.headers.get('content-length'));
  if (head.headers.get('accept-ranges') !== 'bytes') {
    throw new Error('server does not support range requests');
  }

  const tail = await range(url, total - 65_536, total - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');

  let entries = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);

  // 0xffffffff means "the real value is in the ZIP64 record".
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || entries === 0xffff) {
    let loc = -1;
    for (let i = eocd; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x07064b50) { loc = i; break; }
    }
    if (loc < 0) throw new Error('no ZIP64 locator');
    const z64Off = Number(tail.readBigUInt64LE(loc + 8));
    const z64 = await range(url, z64Off, z64Off + 55);
    entries = Number(z64.readBigUInt64LE(24));
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }

  console.log(
    `archive ${(total / 1e9).toFixed(1)} GB, ${entries.toLocaleString('en-GB')} entries, ` +
      `directory ${(cdSize / 1e6).toFixed(1)} MB`,
  );

  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  const files = new Map();
  let p = 0;
  for (let n = 0; n < entries && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const method = cd.readUInt16LE(p + 10);
    let comp = cd.readUInt32LE(p + 20);
    let uncomp = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);

    if (uncomp === 0xffffffff || comp === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const endExtra = e + extraLen;
      while (e + 4 <= endExtra) {
        const id = cd.readUInt16LE(e);
        const size = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncomp === 0xffffffff) { uncomp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (comp === 0xffffffff) { comp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(q)); q += 8; }
          break;
        }
        e += 4 + size;
      }
    }
    files.set(name, { name, method, comp, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function extract(url, entry) {
  // The local header repeats the name and extra field with its own lengths.
  const header = await range(url, entry.localOffset, entry.localOffset + 29);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
  const dataStart =
    entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = await range(url, dataStart, dataStart + entry.comp - 1);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method}`);
}

const files = await readDirectory(ARCHIVE);
mkdirSync(OUT_DIR, { recursive: true });

// The directory read above is the expensive part, so all requested frames
// come out of the one pass.
for (const { seq, frame } of REQUESTS) {
  const tag = `${seq}-${frame}`;
  const wanted = [
    [`pandaset/${seq}/lidar/${frame}.pkl.gz`, `${tag}.pkl`, true],
    [`pandaset/${seq}/lidar/poses.json`, `${tag}.poses.json`, false],
  ];
  for (const [path, out, isGz] of wanted) {
    const entry = files.get(path);
    if (!entry) {
      console.error(`not in archive: ${path}`);
      process.exit(1);
    }
    const member = await extract(ARCHIVE, entry);
    const data = isGz ? gunzipSync(member) : member;
    writeFileSync(OUT_DIR + out, data);
    console.log(`  ${path}  ->  .cache/pandaset/${out}  (${(data.length / 1e6).toFixed(2)} MB)`);
  }
}

console.log('\nnow run: python3 scripts/bake-pandaset-frame.py');
