// Uses the disposable inventory-ui-fixture's accounts; never saves global settings.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");
const sections = [
  ["account","profile","Profile"],["account","appearance","Appearance"],["account","session","Session security"],
  ["access","user-groups","User Groups"],["access","access-levels","Access Levels"],
  ["work-orders","statuses","Statuses"],["work-orders","trouble-codes","Trouble Codes"],["work-orders","service-types","Service Types"],
  ["equipment","system-types","System Types"],["equipment","module-types","Module Types"],
  ["files","project-files","Project Files Directory"],["files","upload-settings","Upload Settings"],
  ["files","file-import-history","File Import History"],["files","external-import-history","External DB Import History"],
  ["api","contact-support","Contact & Support Forms"],
  ["security","security-settings","Security Settings"],
  ["updates","mobile-updates","Mobile Updates"],["updates","web-updates","Web Updates"],
  ["system","timezone","Timezone"],["system","log-maintenance","Log Maintenance"],
];
async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const browser = await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
  const out = "generated-artifacts/settings-workspace";
  await fs.mkdir(out,{recursive:true});
  try {
    const context = await browser.newContext({baseURL:require("./support/workspace-ui-base.cjs")(),
      hasTouch:true,
      viewport:{width:1440,height:1000},hasTouch:true,isMobile:true});
    assert.equal((await context.request.post("/api/auth/local/login",{data:fixture})).status(),200);
    const page = await context.newPage(), errors=[], writes=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("request",request=>{
      if(request.url().includes("/api/settings/")&&!["GET","HEAD"].includes(request.method()))writes.push(request.url());
    });
    await page.goto("/settings");
    const header = page.getByTestId("settings-sticky-header"), content = page.getByTestId("settings-content");
    const choose = async ([group,section,label]) => {
      const menu = page.getByTestId("settings-mobile-menu");
      if(await menu.isVisible()) {
        // Touch avoids desktop hover-scroll arrows moving the phone menu's last
        // option between pointer-down and pointer-up.
        await menu.click(); await page.getByRole("option",{name:label,exact:true}).tap();
        await expect(page.locator('[role="listbox"]')).toHaveCount(0);
      } else {
        await page.getByTestId(`settings-tab-${group}`).click();
        await page.getByTestId(`settings-section-nav-${section}`).click();
      }
      const card = page.locator(`[data-settings-section="${section}"]`);
      try {await expect(card).toBeVisible();}
      catch(error) {
        console.error("Navigation failure",JSON.stringify({section,viewport:page.viewportSize(),
          visible:await page.locator("[data-settings-section]:visible").evaluateAll(els=>els.map(el=>el.dataset.settingsSection))}));
        await page.screenshot({path:`${out}/navigation-failure.jpg`});
        throw error;
      }
      await expect(page.locator("[data-settings-section]:visible")).toHaveCount(1);
      return card;
    };
    const widthCheck = async (card,label) => {
      const size = await card.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth}));
      assert.ok(size.content<=size.width+2,`${label}: setting content clipped horizontally (${size.content}/${size.width})`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${label}: whole page overflows`);
    };
    for(const entry of sections) await widthCheck(await choose(entry),entry[1]);
    await page.getByTestId("settings-tab-account").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("settings-tab-access")).toHaveAttribute("aria-selected","true");
    await page.keyboard.press("Home");
    await expect(page.getByTestId("settings-tab-account")).toHaveAttribute("aria-selected","true");
    await choose(sections.find(entry=>entry[1]==="contact-support"));
    await content.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await choose(sections.find(entry=>entry[1]==="security-settings"));
    await expect.poll(()=>content.evaluate(el=>el.scrollTop)).toBe(0);
    await choose(sections.find(entry=>entry[1]==="project-files"));
    const path = page.getByTestId("input-project-files-path");
    await path.fill("Unsaved-fixture-path-do-not-save");
    await choose(sections.find(entry=>entry[1]==="timezone"));
    const zone = page.getByTestId("select-timezone");
    if(await zone.isEnabled()) {await zone.click(); await page.getByRole("option",{name:"UTC (Coordinated Universal Time)",exact:true}).click();}
    await choose(sections[0]);
    await choose(sections.find(entry=>entry[1]==="project-files"));
    await expect(path).toHaveValue("Unsaved-fixture-path-do-not-save");
    await choose(sections[0]);
    await page.getByTestId("button-edit-profile").click();
    const profile = page.getByRole("dialog",{name:"Edit Profile",exact:true});
    await profile.getByLabel("First Name",{exact:true}).fill("Settings Fixture");
    await page.getByTestId("button-save-profile").click();
    await expect(profile).toBeHidden();
    await expect(page.locator('[data-settings-section="profile"]')).toContainText("Settings Fixture");
    await page.screenshot({path:`${out}/desktop.jpg`});
    for(const viewport of [{width:390,height:844},{width:844,height:390},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await expect(page.getByTestId("settings-mobile-menu")).toBeVisible();
      await expect(header.getByRole("tab")).toHaveCount(0);
      for(const entry of sections) await widthCheck(await choose(entry),`${viewport.width}-${entry[1]}`);
      await choose(sections.find(entry=>entry[1]==="project-files"));
      await expect(path).toHaveValue("Unsaved-fixture-path-do-not-save");
      const before = await header.boundingBox();
      await content.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      const after = await header.boundingBox();
      assert.ok(before&&after&&Math.abs(before.y-after.y)<1,"Settings header remains visible while content scrolls");
      await page.getByTestId("settings-mobile-menu").click();
      assert.equal(await page.evaluate(()=>["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)),false,"navigation must not focus a phone text field");
      await page.keyboard.press("Escape");
      await content.evaluate(el=>{el.scrollTop=0;});
      const bounds = await content.boundingBox();
      assert.ok(bounds&&bounds.height>50&&bounds.y+bounds.height<=viewport.height+1,"usable content fits viewport after rotation");
      await page.screenshot({path:`${out}/phone-${viewport.width}.jpg`});
    }
    assert.deepEqual(writes,[],"navigation/draft editing must never save global configuration automatically");
    // A delegated role sees only personal settings plus the explicitly granted section.
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`,
      {data:{permissions:["nav.settings","settings.fileUpload"]}})).status(),200);
    const delegated = await browser.newContext({baseURL:require("./support/workspace-ui-base.cjs")(),viewport:{width:1440,height:1000}});
    assert.equal((await delegated.request.post("/api/auth/local/login",{data:fixture.viewer})).status(),200);
    const limited = await delegated.newPage();
    await limited.goto("/settings");
    await expect(limited.getByTestId("settings-tab-files")).toBeVisible();
    await expect(limited.getByTestId("settings-tab-access")).toHaveCount(0);
    await expect(limited.getByTestId("settings-tab-security")).toHaveCount(0);
    await limited.getByTestId("settings-tab-files").click();
    await expect(limited.locator('[data-settings-section="upload-settings"]')).toBeVisible();
    await expect(limited.getByTestId("settings-section-nav-project-files")).toHaveCount(0);
    assert.equal((await limited.request.get("/api/settings/security")).status(),403);
    await limited.setViewportSize({width:390,height:844});
    await limited.getByTestId("settings-mobile-menu").click();
    await expect(limited.getByRole("option")).toHaveCount(4);
    await expect(limited.getByRole("option",{name:"Access Levels",exact:true})).toHaveCount(0);
    assert.deepEqual(errors,[]);
    console.log("Settings workspace passed: all 21 sections, desktop/phone/touch-landscape, content widths, sticky header, draft retention, normal profile save, no automatic global writes and delegated-role navigation.");
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
