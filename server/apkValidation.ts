import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import unzipper from "unzipper";
import { APK_MAX_SIZE } from "../shared/mobile-releases";
import { ReleaseError } from "./mobileReleaseRepository";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crcUpdate(crc: number, bytes: Buffer) {
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return crc;
}
function invalid(message: string): never { throw new ReleaseError(`Invalid APK: ${message}`); }

// Structural Android binary XML validation, not version extraction or signature verification.
function validateManifest(data: Buffer) {
  if (data.length < 8 || data.readUInt16LE(0) !== 3 || data.readUInt16LE(2) !== 8 ||
      data.readUInt32LE(4) !== data.length) invalid("AndroidManifest.xml is not complete Android binary XML.");
  let strings: string[] | null = null;
  const elements: string[] = [];
  let rootSeen = false, applicationSeen = false, packageSeen = false;
  let chunks = 0;
  for (let at = 8; at < data.length;) {
    if (++chunks > 50000 || at + 8 > data.length) invalid("malformed manifest chunks.");
    const type = data.readUInt16LE(at), header = data.readUInt16LE(at + 2), size = data.readUInt32LE(at + 4);
    if (header < 8 || size < header || at + size > data.length || size % 4) invalid("malformed manifest bounds.");
    const chunk = data.subarray(at, at + size);
    if (type === 1) {
      if (strings || header < 28) invalid("malformed manifest string pool.");
      const count = chunk.readUInt32LE(8), styleCount = chunk.readUInt32LE(12);
      const utf8 = !!(chunk.readUInt32LE(16) & 0x100), start = chunk.readUInt32LE(20), styleStart = chunk.readUInt32LE(24);
      if (count > 20000 || header + (count + styleCount) * 4 > start ||
          start > size || (styleStart && (styleStart < start || styleStart > size))) invalid("invalid manifest strings.");
      const end = styleStart || size;
      strings = [];
      for (let i = 0; i < count; i++) {
        let pos = start + chunk.readUInt32LE(header + i * 4);
        const length = () => {
          if (pos >= end) invalid("truncated manifest string.");
          if (utf8) {
            let value = chunk[pos++];
            if (value & 128) { if (pos >= end) invalid("truncated string length."); value = ((value & 127) << 8) | chunk[pos++]; }
            return value;
          }
          if (pos + 2 > end) invalid("truncated string length.");
          let value = chunk.readUInt16LE(pos); pos += 2;
          if (value & 32768) { if (pos + 2 > end) invalid("truncated string length."); value = (value & 32767) * 65536 + chunk.readUInt16LE(pos); pos += 2; }
          return value;
        };
        let len = length();
        if (utf8) len = length(); else len *= 2;
        const terminator = utf8 ? 1 : 2;
        if (pos < start || pos + len + terminator > end || chunk[pos + len] !== 0 ||
            (!utf8 && chunk[pos + len + 1] !== 0)) invalid("truncated manifest string.");
        strings.push(chunk.subarray(pos, pos + len).toString(utf8 ? "utf8" : "utf16le"));
      }
    } else if (type === 0x102 || type === 0x103) {
      if (!strings || header !== 16 || size < (type === 0x102 ? 36 : 24)) invalid("invalid manifest element.");
      const nameIndex = chunk.readUInt32LE(20), name = strings[nameIndex];
      if (!name) invalid("invalid manifest element name.");
      if (type === 0x103) {
        if (elements.pop() !== name) invalid("unbalanced manifest elements.");
      } else {
        if (!elements.length) {
          if (rootSeen || name !== "manifest") invalid("manifest root is missing.");
          rootSeen = true;
        }
        if (name === "application") applicationSeen = true;
        const start = chunk.readUInt16LE(24), attrSize = chunk.readUInt16LE(26), count = chunk.readUInt16LE(28);
        if (attrSize !== 20 || start < 20 || 16 + start + count * attrSize > size) invalid("invalid manifest attributes.");
        for (let i = 0; i < count; i++) {
          const a = 16 + start + i * attrSize;
          const attrName = strings[chunk.readUInt32LE(a + 4)];
          if (!attrName || chunk.readUInt16LE(a + 12) !== 8) invalid("invalid attribute value.");
          if (elements.length === 0 && attrName === "package") {
            const raw = chunk.readUInt32LE(a + 8);
            const value = raw !== 0xffffffff ? strings[raw]
              : chunk[a + 15] === 3 ? strings[chunk.readUInt32LE(a + 16)] : "";
            if (!value || !/^[a-zA-Z0-9_.]+$/.test(value)) invalid("application package is missing.");
            packageSeen = true;
          }
        }
        elements.push(name);
      }
    } else if (![0x100, 0x101, 0x104, 0x180].includes(type)) invalid("unsupported manifest chunk.");
    at += size;
  }
  if (!strings || !rootSeen || !applicationSeen || !packageSeen || elements.length) invalid("incomplete application manifest.");
}

export async function validateApk(filename: string) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size === 0 || stat.size > APK_MAX_SIZE) invalid("file exceeds the 512 MB limit or is empty.");
  // Check EOCD before unzipper allocates an array from an untrusted record count.
  const handle = await fs.open(filename, "r");
  try {
    const signature = Buffer.alloc(4);
    await handle.read(signature, 0, 4, 0);
    if (signature.readUInt32LE(0) !== 0x04034b50) invalid("not an APK ZIP file.");
    const tail = Buffer.alloc(Math.min(stat.size, 65557));
    await handle.read(tail, 0, tail.length, stat.size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    }
    if (end < 0 || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6)) invalid("not a single-disk APK archive.");
    const count = tail.readUInt16LE(end + 10);
    if (!count || count > 20000 || count !== tail.readUInt16LE(end + 8)) invalid("archive contains too many entries.");
    const centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16);
    if (centralSize > 16 * 1024 * 1024 || centralOffset + centralSize > stat.size) invalid("invalid ZIP directory.");
  } finally { await handle.close(); }
  let archive;
  try { archive = await unzipper.Open.file(filename); }
  catch { invalid("unreadable ZIP directory."); }
  const names = new Set<string>();
  let total = 0;
  let manifest: Buffer | null = null, dexSeen = false;
  for (const file of archive!.files) {
    const f = file as typeof file & { flags: number; crc32: number; compressionMethod: number };
    const name = file.path;
    if (names.has(name) || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some(p => p === ".." || p === ".") ||
        /[\x00-\x1f\x7f]/.test(name)) invalid("unsafe or duplicate archive entry.");
    names.add(name);
    if ((f.flags & 1) || ![0, 8].includes(f.compressionMethod)) invalid("encrypted or unsupported archive entry.");
    total += file.uncompressedSize;
    if (total > 1024 * 1024 * 1024 || file.uncompressedSize > APK_MAX_SIZE ||
        file.uncompressedSize > Math.max(1024 * 1024, file.compressedSize * 200)) invalid("archive expansion exceeds safety limits.");
    if (name === "AndroidManifest.xml" && file.uncompressedSize > 2 * 1024 * 1024) invalid("manifest is too large.");
    if (file.type === "Directory") continue;
    let bytes = 0, crc = 0xffffffff;
    const parts: Buffer[] = [];
    let prefix = Buffer.alloc(0);
    try {
      for await (const buffer of file.stream()) {
        const chunk = Buffer.from(buffer);
        bytes += chunk.length;
        if (bytes > file.uncompressedSize) invalid("entry expands beyond its declared size.");
        crc = crcUpdate(crc, chunk);
        if (name === "AndroidManifest.xml") parts.push(chunk);
        if (name === "classes.dex" && prefix.length < 120) prefix = Buffer.concat([prefix, chunk.subarray(0, 120 - prefix.length)]);
      }
    } catch (error) {
      if (error instanceof ReleaseError) throw error;
      invalid("corrupt compressed entry.");
    }
    if (bytes !== file.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== f.crc32) invalid("entry size or CRC integrity check failed.");
    if (name === "AndroidManifest.xml") manifest = Buffer.concat(parts);
    if (name === "classes.dex") {
      const container = prefix.subarray(4,7).toString("ascii") === "041";
      if (prefix.length < (container ? 120 : 112) || !/^dex\n0(?:3[5-9]|4[01])\0$/.test(prefix.subarray(0, 8).toString("ascii")) ||
          (container ? prefix.readUInt32LE(112) !== bytes || prefix.readUInt32LE(116) !== 0 ||
            prefix.readUInt32LE(32) < 120 || prefix.readUInt32LE(32) > bytes : prefix.readUInt32LE(32) !== bytes) ||
          prefix.readUInt32LE(36) !== (container ? 120 : 112) ||
          prefix.readUInt32LE(40) !== 0x12345678) invalid("invalid Android bytecode header.");
      dexSeen = true;
    }
  }
  if (!manifest || !dexSeen) invalid("a base APK must contain AndroidManifest.xml and classes.dex.");
  validateManifest(manifest);
  const hash = createHash("sha256");
  const stream = (await import("node:fs")).createReadStream(filename);
  for await (const chunk of stream) hash.update(chunk);
  return { size: stat.size, sha256: hash.digest("hex") };
}
