// Actual SSH/SFTP transport on localhost; in-memory files and disposable keys.
const { Server, utils } = require("ssh2");
const { generateKeyPairSync, createHash } = require("node:crypto");
const path = require("node:path").posix;
module.exports = async function ownedSftp() {
  const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "pkcs1" } });
  const fingerprint = "SHA256:" + createHash("sha256").update(utils.parseKey(key.privateKey).getPublicSSH()).digest("base64").replace(/=+$/, "");
  const files = new Map(), directories = new Set(["/", "/inbound", "/outbound"]), clients = new Set();
  let allowWrites = true;
  const now = () => Math.floor(Date.now() / 1000);
  const attrs = name => directories.has(name) ? { mode: 0o40700, size: 0, uid: 0, gid: 0, atime: now(), mtime: now() } :
    files.has(name) ? { mode: 0o100600, size: files.get(name).length, uid: 0, gid: 0, atime: now(), mtime: now() } : null;
  const server = new Server({ hostKeys: [key.privateKey] }, client => {
    clients.add(client); client.on("close", () => clients.delete(client)); client.on("error", () => {});
    client.on("authentication", context => context.username === "fixture" && context.method === "password" && context.password === "synthetic-fixture-only" ? context.accept() : context.reject());
    client.on("ready", () => client.on("session", accept => {
      const session = accept();
      session.on("sftp", acceptSftp => {
        const stream = acceptSftp(), handles = new Map(); let sequence = 0;
        const keyOf = handle => handle.toString("hex");
        const handle = (request, entry) => { const id = Buffer.alloc(4); id.writeUInt32BE(++sequence); handles.set(keyOf(id), entry); stream.handle(request, id); };
        const name = value => path.resolve("/", value);
        stream.on("REALPATH", (id, value) => stream.name(id, [{ filename: name(value), longname: name(value), attrs: attrs(name(value)) || attrs("/") }]));
        for (const event of ["STAT", "LSTAT"]) stream.on(event, (id, value) => { const result = attrs(name(value)); result ? stream.attrs(id, result) : stream.status(id, 2); });
        stream.on("FSTAT", (id, value) => { const result = attrs(handles.get(keyOf(value))?.name); result ? stream.attrs(id, result) : stream.status(id, 2); });
        stream.on("OPENDIR", (id, value) => directories.has(name(value)) ? handle(id, { name: name(value), directory: true, listed: false }) : stream.status(id, 2));
        stream.on("READDIR", (id, value) => {
          const entry = handles.get(keyOf(value));
          if (!entry || entry.listed) return stream.status(id, 1);
          entry.listed = true;
          const list = [...files.keys()].filter(file => path.dirname(file) === entry.name).map(file => ({ filename: path.basename(file),
            longname: `-rw------- 1 fixture fixture ${files.get(file).length} Jan 1 00:00 ${path.basename(file)}`, attrs: attrs(file) }));
          list.length ? stream.name(id, list) : stream.status(id, 1);
        });
        stream.on("OPEN", (id, value, flags) => {
          const filename = name(value), write = flags & 2;
          if (write && !allowWrites) return stream.status(id, 3);
          if (!files.has(filename) && !(flags & 8)) return stream.status(id, 2);
          if (files.has(filename) && flags & 32) return stream.status(id, 4);
          if (!files.has(filename) || flags & 16) files.set(filename, Buffer.alloc(0));
          handle(id, { name: filename });
        });
        stream.on("READ", (id, value, offset, length) => {
          const bytes = files.get(handles.get(keyOf(value))?.name);
          if (!bytes) return stream.status(id, 2);
          offset >= bytes.length ? stream.status(id, 1) : stream.data(id, bytes.subarray(offset, offset + length));
        });
        stream.on("WRITE", (id, value, offset, bytes) => {
          if (!allowWrites) return stream.status(id, 3);
          const filename = handles.get(keyOf(value))?.name, old = files.get(filename);
          if (!old) return stream.status(id, 2);
          const next = Buffer.alloc(Math.max(old.length, offset + bytes.length)); old.copy(next); bytes.copy(next, offset);
          files.set(filename, next); stream.status(id, 0);
        });
        stream.on("CLOSE", (id, value) => { handles.delete(keyOf(value)); stream.status(id, 0); });
        stream.on("REMOVE", (id, value) => { files.delete(name(value)); stream.status(id, 0); });
        stream.on("RENAME", (id, from, to) => {
          from = name(from); to = name(to);
          if (!allowWrites) return stream.status(id, 3);
          if (!files.has(from)) return stream.status(id, 2);
          if (files.has(to)) return stream.status(id, 4);
          files.set(to, files.get(from)); files.delete(from); stream.status(id, 0);
        });
      });
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { files, fingerprint, port: server.address().port, setWritable: value => { allowWrites = value; },
    close: async () => { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
};
