/**
 * Stockage des sessions dans la base SQLite (table « sessions »).
 * Garde l'id de l'utilisateur pour pouvoir fermer toutes ses sessions (changement de mot de passe).
 */
import session from 'express-session';

export class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs }) {
    super();
    this.ttlMs = ttlMs;
    this.q = {
      get: db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?'),
      set: db.prepare(`INSERT INTO sessions (sid, sess, expires, user_id) VALUES (@sid, @sess, @expires, @user_id)
        ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires, user_id = excluded.user_id`),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires < ?'),
    };
    // Nettoyage des sessions expirées toutes les heures
    this.timer = setInterval(() => this.q.prune.run(Date.now()), 3600e3);
    this.timer.unref();
  }

  expiresOf(sess) {
    const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(exp) ? exp : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.q.get.get(sid);
      cb(null, row && row.expires > Date.now() ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      this.q.set.run({ sid, sess: JSON.stringify(sess), expires: this.expiresOf(sess), user_id: sess.userId ?? null });
      cb?.(null);
    } catch (e) { cb?.(e); }
  }

  touch(sid, sess, cb) {
    try { this.q.touch.run(this.expiresOf(sess), sid); cb?.(null); } catch (e) { cb?.(e); }
  }

  destroy(sid, cb) {
    try { this.q.destroy.run(sid); cb?.(null); } catch (e) { cb?.(e); }
  }
}
