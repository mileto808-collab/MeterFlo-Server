import { TransferError } from "./sftp";

const filename = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,179}\.(csv|xlsx?|json)$/i;

/** POSIX paths inside a virtual root; never an operating-system path resolver. */
export function sftpVirtualPath(value: string): string {
  if (value.length > 250 || /[\\\x00-\x1f\x7f]/.test(value))
    throw new TransferError("Invalid virtual path.", 403);
  // Reject UNC-style hosts, not harmless repeated separators inside the virtual tree.
  const first = value.split("/").find(Boolean);
  if (value.startsWith("//") && first && first !== ".")
    throw new TransferError("Network paths are not permitted.", 403);
  const parts: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length !== 1) throw new TransferError("Parent path leaves the virtual directory tree.", 403);
      parts.pop();
      continue;
    }
    if (!parts.length) {
      if (segment !== "incoming" && segment !== "outgoing")
        throw new TransferError("Only the project inbox and outbox are available.", 403);
    } else if (parts.length !== 1 || !filename.test(segment)) {
      throw new TransferError("Only CSV, XLS, XLSX and JSON files in the project inbox/outbox are available.", 403);
    }
    parts.push(segment);
  }
  // A trailing separator/dot/parent after a filename cannot turn a file into a directory.
  if (parts.length === 2 && /\/(?:\.*\/?)*$/.test(value))
    throw new TransferError("Not a virtual directory.", 403);
  return "/" + parts.join("/");
}
