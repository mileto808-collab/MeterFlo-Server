import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { withAuditContext } from "../server/auditContext";
import { initializeSubStatusTables, installProjectSubStatuses, listSubStatuses, restoreSubStatusDefinitions } from "../server/workOrderSubStatuses";

test("sub-statuses enforce parent/scope, retirement, stable identity and portable project restore", async () => {
  const client = await pool.connect();
  try {
    await withAuditContext({ actorKind:"system",actorLabel:"Sub-status fixture",source:"sub-status-test",operationId:randomUUID() }, async () => {
      await client.query("BEGIN");
      await initializeSubStatusTables(client);
      const parents = (await client.query("SELECT id,code FROM public.work_order_statuses WHERE code IN ('Trouble','Open','Completed')")).rows;
      const trouble = parents.find(p=>p.code==="Trouble").id;
      const open = parents.find(p=>p.code==="Open").id;
      const schemas = [`project_substatus_${randomUUID().replaceAll("-","")}`,`project_substatus_${randomUUID().replaceAll("-","")}`];
      const projects: number[] = [];
      for (const schema of schemas) {
        const {rows:[p]} = await client.query("INSERT INTO public.projects(name,database_name) VALUES($1,$2) RETURNING id", [schema,schema]);
        projects.push(p.id);
        await client.query(`CREATE SCHEMA "${schema}"; CREATE TABLE "${schema}".work_orders(id integer PRIMARY KEY,status varchar(50) NOT NULL)`);
        await installProjectSubStatuses(client,schema);
      }
      const shared = randomUUID(), local = randomUUID(), foreign = randomUUID();
      for (const [id,projectId,code,parent] of [[shared,null,"SHARED",trouble],[local,projects[0],"LOCAL",trouble],[foreign,projects[1],"FOREIGN",open]] as const)
        await client.query("INSERT INTO public.work_order_sub_statuses(id,project_id,parent_status_id,code,label) VALUES($1,$2,$3,$4,$4)",[id,projectId,parent,code]);
      const expectFailure = async (sql: string, values: unknown[], code: string) => {
        await client.query("SAVEPOINT invalid_substatus");
        await assert.rejects(client.query(sql,values), (e:any)=>e.code===code);
        await client.query("ROLLBACK TO SAVEPOINT invalid_substatus");
      };
      await client.query(`INSERT INTO "${schemas[0]}".work_orders VALUES(1,'Trouble',$1)`,[local]);
      await expectFailure(`INSERT INTO "${schemas[0]}".work_orders VALUES(2,'Open',$1)`,[local],"23514");
      await expectFailure(`INSERT INTO "${schemas[0]}".work_orders VALUES(2,'Open',$1)`,[foreign],"23514");
      await expectFailure("UPDATE public.work_order_sub_statuses SET parent_status_id=$2 WHERE id=$1",[local,open],"23514");
      await expectFailure("DELETE FROM public.work_order_sub_statuses WHERE id=$1",[local],"23503");
      await client.query("UPDATE public.work_order_sub_statuses SET label='Awaiting permit',active=false WHERE id=$1",[local]);
      await client.query(`UPDATE "${schemas[0]}".work_orders SET status='Trouble' WHERE id=1`);
      await expectFailure(`INSERT INTO "${schemas[0]}".work_orders VALUES(2,'Trouble',$1)`,[local],"23514");
      assert.equal((await client.query(`SELECT sub_status_id FROM "${schemas[0]}".work_orders WHERE id=1`)).rows[0].sub_status_id,local);
      const defs = await listSubStatuses(projects[0],client);
      assert.ok(defs.some(d=>d.id===shared));
      assert.ok(!defs.some(d=>d.id===foreign));
      await client.query(`UPDATE "${schemas[0]}".work_orders SET status='Open' WHERE id=1`);
      assert.equal((await client.query(`SELECT sub_status_id FROM "${schemas[0]}".work_orders WHERE id=1`)).rows[0].sub_status_id,null);
      const mapping = await restoreSubStatusDefinitions(client,schemas[1],defs.filter(d=>d.id===shared||d.id===local));
      assert.equal(mapping.get(shared),shared);
      assert.notEqual(mapping.get(local),local,"Cloning a project must not steal another project's UUID");
      await client.query(`INSERT INTO "${schemas[1]}".work_orders VALUES(1,'Trouble',$1)`,[mapping.get(local)]);
      assert.equal((await client.query("SELECT project_id,active,label FROM public.work_order_sub_statuses WHERE id=$1",[mapping.get(local)])).rows[0].active,false);
      await client.query("ROLLBACK");
    });
  } finally { client.release(); await pool.end(); }
});
