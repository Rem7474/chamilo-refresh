// Empaquette l'extension dans dist/chamilo-refresh-<version>.zip (aucune dépendance).
// Usage : node scripts/build.cjs [--tag vX.Y.Z]   (--tag vérifie que le tag correspond à la version)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = ['manifest.json', 'icons', 'popup', 'src', 'LICENSE'];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tagIndex = process.argv.indexOf('--tag');
const tag = tagIndex > -1 ? process.argv[tagIndex + 1] : null;

if (manifest.version !== pkg.version) {
  console.error(`Versions différentes : manifest.json ${manifest.version} / package.json ${pkg.version}`);
  process.exit(1);
}
if (tag && tag !== `v${manifest.version}`) {
  console.error(`Le tag ${tag} ne correspond pas à la version ${manifest.version}`);
  process.exit(1);
}

const files = [];
const walk = (rel) => {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).sort().forEach((f) => walk(path.posix.join(rel, f)));
  else files.push(rel);
};
INCLUDE.forEach(walk);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// Date fixe : l'archive est reproductible d'un build à l'autre.
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const locals = [], centrals = [];
let offset = 0;
for (const rel of files) {
  const data = fs.readFileSync(path.join(ROOT, rel));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(rel);
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}
const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `chamilo-refresh-${manifest.version}.zip`);
fs.writeFileSync(out, Buffer.concat([...locals, ...centrals, end]));
console.log(`${path.relative(ROOT, out)} (${files.length} fichiers)`);
