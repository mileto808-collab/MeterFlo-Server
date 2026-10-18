import * as path from "node:path";

export function getProjectDirectoryName(name: string, id: number): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "")}_${id}`;
}

export function workOrderFolderName(identifier: string): string {
  const name = identifier.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!name || name === "." || name === ".." || /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Work-order file identifier is not a safe portable directory name.");
  }
  return name;
}

export function attachmentChild(directory: string, name: string): string {
  if (!name || name === "." || name === ".." || /[/\\]/.test(name) ||
      path.basename(name) !== name) throw new Error("Invalid attachment filename.");
  return path.join(directory, name);
}
