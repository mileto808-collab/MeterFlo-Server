import type { Pool } from "pg";
import { auditContext, auditingEnabled, serviceAuditContext } from "./auditContext";

/**
 * Attach verified application context to the same connection/transaction as a
 * mutation. DB triggers write sanitized business diffs atomically, including SQL
 * paths which bypass storage helpers. Raw external SQL has no application marker.
 */
export function instrumentAuditPool(pool:Pool) {
  const originalConnect = pool.connect.bind(pool);
  pool.connect = function(callback?:any):any {
    const connect = async () => {
      const client:any = await originalConnect();
      if (!client.__auditOriginalQuery) client.__auditOriginalQuery = client.query.bind(client);
      const raw = client.__auditOriginalQuery;
      let transaction = false;
      let pending:Promise<unknown>=Promise.resolve();
      const queryAsync = async (args:any[]) => {
        const text = typeof args[0]==="string" ? args[0] : args[0]?.text || "";
        const context = auditContext.getStore();
        // Startup migrations/bootstrap and read-only operations are not business
        // events. Only application writes receive the transaction-local marker.
        const mutation = /^\s*(INSERT|UPDATE|DELETE|WITH)\b/i.test(text);
        if (!auditingEnabled || !mutation) {
          const result = await raw(...args);
          if (/^\s*BEGIN\b/i.test(text)) transaction=true;
          if (/^\s*(COMMIT|ROLLBACK)\s*(;|$)/i.test(text)) transaction=false;
          return result;
        }
        const ctx = context || serviceAuditContext("system");
        const implicit = !transaction;
        if (implicit) await raw("BEGIN");
        try {
          await raw("SELECT set_config('meterflo.audit_context',$1,true)",[JSON.stringify(ctx)]);
          const result = await raw(...args);
          if (implicit) await raw("COMMIT");
          return result;
        } catch(error) {
          if (implicit) await raw("ROLLBACK");
          throw error;
        }
      };
      client.query = (...args:any[]) => {
        const callback = typeof args.at(-1)==="function" ? args.pop() : undefined;
        // pg serializes statements, but an implicit audited write consists of
        // several statements. Keep that whole group ordered on this connection.
        const promise = pending.then(()=>queryAsync(args));
        pending=promise.then(()=>undefined,()=>undefined);
        if (callback) { promise.then(r=>callback(null,r),e=>callback(e)); return; }
        return promise;
      };
      return client;
    };
    if (callback) { connect().then(c=>callback(null,c,c.release.bind(c)),e=>callback(e)); return; }
    return connect();
  } as any;
}
