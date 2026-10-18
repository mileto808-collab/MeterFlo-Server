// Additive workspace setup; standalone servers use their normal startup setup.
import "dotenv/config";

async function main() {
  if(process.argv.slice(2).join(" ")!=="--development" || !process.env.REPL_ID ||
    !process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV==="production" || process.env.REPLIT_DEPLOYMENT==="1")
    throw new Error("Dispatch schema setup is restricted to the development workspace. Managed production receives schema through Publish.");
  const {pool}=await import("../server/db");
  try {
    const {initializeDispatch}=await import("../server/routing/dispatchStore");
    await initializeDispatch();
    console.log("Development dispatch business schema verified; no provider payloads stored.");
  } finally {await pool.end();}
}
main().catch(error=>{
  console.error(error instanceof Error?error.message:"Dispatch schema setup failed.");
  process.exitCode=1;
});
