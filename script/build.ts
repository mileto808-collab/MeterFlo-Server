import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { readFile, mkdir, writeFile } from "fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { prepareBuildOutput } from "./build-output";
import { loadCustomerRelease, ownedPath } from "../shared/customer-release";
import { permissionKeys } from "../shared/schema";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  // Works in a Git checkout or ZIP distribution, without installed checker dependencies.
  // Fail before deleting a prior build if internal-only package URLs have reappeared.
  execFileSync(process.execPath, ["script/check-dependency-portability.mjs", "--files"], {stdio:"inherit"});
  const customerRelease = loadCustomerRelease();
  if (customerRelease.blockers.length) throw new Error(customerRelease.blockers.join("; "));
  if(customerRelease.installedSchemaVersion!==null && customerRelease.installedSchemaVersion!==customerRelease.schemaVersion)
    throw new Error("Declared database schema is incompatible with this composed release");
  if(customerRelease.extensions.some(x=>!(Object.values(permissionKeys) as string[]).includes(x.permission)))
    throw new Error("Customer extension permission is not available through normal MeterFlo role management");
  const buildId = randomUUID();
  await prepareBuildOutput(process.cwd(), async output => {
  await mkdir(path.join(output,"extensions"), {recursive:true});
  await writeFile(path.join(output,"customer-release.json"),JSON.stringify({...customerRelease,buildId},null,2));
  for (const extension of customerRelease.extensions) {
    await esbuild({entryPoints:[ownedPath(ownedPath(process.cwd(),extension.directory),extension.serverEntry)],
      platform:"node",bundle:true,format:"cjs",outfile:path.join(output,"extensions",`${extension.id}.cjs`)});
  }

  console.log("building client...");
  await viteBuild({build:{outDir:path.join(output,"public")}});

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: path.join(output,"index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
      "__METERFLO_BUILD_ID__": JSON.stringify(buildId),
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
