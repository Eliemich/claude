/** Erreur HTTP « métier » : le message est affiché tel quel à l'utilisateur. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra); // ex. { code, fields }
  }
}

export const badRequest = (msg, extra) => new HttpError(400, msg, extra);
export const unauthorized = (msg = 'Vous devez être connecté.') => new HttpError(401, msg, { code: 'AUTH_REQUIRED' });
export const forbidden = (msg = 'Accès refusé.', extra) => new HttpError(403, msg, extra);
export const notFound = (what = 'Ressource') => new HttpError(404, `${what} introuvable.`);
/** Erreur rattachée à un champ du formulaire (encadré en rouge dans l'interface). */
export const fieldError = (field, msg) => badRequest(msg, { fields: { [field]: msg } });
