import path from "node:path";
import { stageCustomerRelease } from "./customer-release-stage";
import { activateCustomerRelease } from "./customer-release-activation";
const args=process.argv.slice(2),mode=args.shift();
const values=new Map<string,string>();
let confirmed=false;
for(let i=0;i<args.length;i++){
  if(args[i]==="--confirm-backup"){confirmed=true;continue;}
  if(!["--tag","--target","--candidate","--health-url"].includes(args[i]) || !args[i+1] || args[i+1].startsWith("--"))
    throw new Error("Invalid update arguments; see the customer update guide");
  if(values.has(args[i]))throw new Error("Duplicate update argument");
  values.set(args[i],args[++i]);
}
try {
  if(mode==="stage" && values.has("--tag") && values.has("--target"))
    await stageCustomerRelease({root:process.cwd(),target:path.resolve(values.get("--target")!),tag:values.get("--tag")!});
  else if(mode==="activate" && values.has("--candidate") && values.has("--health-url"))
    await activateCustomerRelease({root:process.cwd(),candidate:path.resolve(values.get("--candidate")!),
      healthUrl:values.get("--health-url")!,confirmBackup:confirmed});
  else throw new Error("Select stage --tag/--target or activate --candidate/--health-url/--confirm-backup");
}catch(error){
  console.error(error instanceof Error ? error.message : "Customer update failed; no live data was replaced");
  process.exitCode=1;
}
