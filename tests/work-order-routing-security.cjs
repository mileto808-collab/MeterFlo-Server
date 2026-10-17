// Real app endpoints, disposable accounts/project, no provider calls or key reads.
const {request}=require("@playwright/test");
const fs=require("node:fs");
const assert=require("node:assert/strict");
(async()=>{
  const f=JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const baseURL=`https://${process.env.REPLIT_DEV_DOMAIN}`;
  const admin=await request.newContext({baseURL}),editor=await request.newContext({baseURL});
  const root=`/api/projects/${f.projectId}`,settings=`${root}/routing/settings`;
  const json=async(context,method,url,data,expected=200)=>{
    const res=await context.fetch(url,{method,data});
    assert.equal(res.status(),expected,`${method} ${url}: unexpected status ${res.status()}`);
    return res.json();
  };
  let original,originalRole;
  try{
    await json(admin,"POST","/api/auth/local/login",f);
    const roles=await json(admin,"GET","/api/subroles");
    const role=roles.find(r=>r.id===f.viewerRoleId);
    originalRole=role;
    await json(admin,"PUT",`/api/subroles/${role.id}`,{...role,permissions:[
      "projects.view","projects.edit","projects.create","workOrders.view","workOrders.optimizeRoute",
    ]});
    await json(editor,"POST","/api/auth/local/login",f.viewer);
    original=(await json(admin,"GET",settings)).configuration;
    const config={mode:"override",provider:"google",serverKeyEnv:`METERFLO_ROUTING_PROJECT_${f.projectId}_SERVER`,
      browserKeyEnv:`METERFLO_ROUTING_PROJECT_${f.projectId}_BROWSER`,maxStops:20,dailyPlans:5};
    await json(editor,"PUT",settings,config);
    for(const field of ["routingConfiguration","routing_configuration"]){
      for(const key of ["SESSION_SECRET","GOOGLE_MAPS_OTHER_ACCOUNT_BROWSER","GOOGLE_MAPS_SERVER_API_KEY"]){
        const injected={...config,serverKeyEnv:"",browserKeyEnv:key};
        await json(editor,"PATCH",root,{[field]:injected},400);
        await json(editor,"POST","/api/projects",{name:"Forbidden routing injection",[field]:injected},400);
        await json(editor,"POST",`${root}/copy`,{name:"Forbidden routing copy",[field]:injected},400);
        assert.deepEqual((await json(admin,"GET",settings)).configuration,config,"Rejected generic writes must preserve valid routing");
        // Assert status before reading a response body; never retrieve a secret
        // value even if a regression accidentally creates a public key response.
        const map=await editor.get(`${root}/routing/map-config`);
        assert.equal(map.status(),503,"Missing own browser key, not an exposed injected secret");
      }
      await json(editor,"PATCH",root,{[field]:null,notes:"Routing write-boundary acceptance fixture"});
      assert.deepEqual((await json(admin,"GET",settings)).configuration,config,"Redacted null must not clear routing");
    }
    await json(editor,"PUT",settings,{...config,serverKeyEnv:"",browserKeyEnv:"SESSION_SECRET"},400);
    await json(editor,"PUT",settings,{...config,serverKeyEnv:"",browserKeyEnv:config.serverKeyEnv},400);
    await json(editor,"PUT",settings,{...config,browserKeyEnv:"METERFLO_ROUTING_PROJECT_999999_BROWSER"},403);
    assert.equal((await json(editor,"GET",root)).routingConfiguration,null,"Ordinary project response stays redacted");
    assert.deepEqual((await json(admin,"GET",settings)).configuration,config);
    console.log("Routing security: real project-editor PATCH/create/copy injection blocked; camel/snake aliases and redacted null round-trips protected; SESSION_SECRET/server-key map exposure and cross-account credential selection rejected.");
  }finally{
    if(original)await json(admin,"PUT",settings,original);
    if(originalRole)await json(admin,"PUT",`/api/subroles/${originalRole.id}`,{...originalRole,permissions:["workOrders.view","projects.view"]});
    await editor.dispose();await admin.dispose();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
