import type {Database} from '../db.js';

const day=24*60*60*1000;

/**
 * Removes authentication records that can no longer grant or block anything. Without this the session and login-throttle
 * tables grow forever (one throttle row per distinct email an attacker tries). Active, recently revoked and recently
 * expired sessions are kept for a week so incident review still has context.
 */
export async function purgeStaleAuthRecords(db:Database,now=new Date()){
 const sessionCutoff=new Date(now.getTime()-7*day);
 const throttleCutoff=new Date(now.getTime()-day);
 const [sessions,throttles]=await Promise.all([
  db.staffSession.deleteMany({where:{OR:[{expiresAt:{lt:sessionCutoff}},{revokedAt:{lt:sessionCutoff}}]}}),
  db.authThrottle.deleteMany({where:{windowStart:{lt:throttleCutoff}}}),
 ]);
 return {sessions:sessions.count,throttles:throttles.count};
}
