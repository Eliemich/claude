/** Appels au serveur (cookie de session + jeton anti-CSRF). */
let csrf = null;

export class ApiError extends Error {
  constructor(message, { status, code, fields } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields || {};
  }
}

async function token(force = false) {
  if (!csrf || force) csrf = (await (await fetch('/api/auth/csrf', { credentials: 'same-origin' })).json()).token;
  return csrf;
}

export async function http(method, url, body, retried = false) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = await token();
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Connexion au serveur impossible.', { code: 'NETWORK' });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === 'CSRF' && !retried) { await token(true); return http(method, url, body, true); }
  if (res.status === 401 && !url.startsWith('/auth')) {
    location.replace('/connexion');
    throw new ApiError('Session expirée.', { status: 401 });
  }
  if (!res.ok) throw new ApiError(data.error || `Erreur ${res.status}`, { status: res.status, code: data.code, fields: data.fields });
  if (data && data.csrf) csrf = data.csrf;
  return data;
}

export const A = {
  login: (email, password) => http('POST', '/auth/login', { email, password }),
  totp: (code) => http('POST', '/auth/totp', { code }),
  me: async () => (await http('GET', '/auth/me')).user,
  logout: () => http('POST', '/auth/logout'),

  status: () => http('GET', '/status'),
  stats: () => http('GET', '/stats'),
  modeles: () => http('GET', '/modeles'),
  modele: (slug) => http('GET', `/modeles/${encodeURIComponent(slug)}`),
  importModele: (fichier, html) => http('POST', '/modeles', { fichier, html }),
  deleteModele: (slug) => http('DELETE', `/modeles/${encodeURIComponent(slug)}`),
  apercu: (p) => http('POST', '/apercu', p),
  envoi: (p) => http('POST', '/envoi', p),
  historique: () => http('GET', '/historique'),

  // Modèles de factures (designs de la page facture)
  factureModeles: () => http('GET', '/factures/modeles'),
  factureModele: (slug) => http('GET', `/factures/modeles/${encodeURIComponent(slug)}`),
  importFactureModele: (fichier, html) => http('POST', '/factures/modeles', { fichier, html }),
  deleteFactureModele: (slug) => http('DELETE', `/factures/modeles/${encodeURIComponent(slug)}`),
  setFactureActive: (slug) => http('PUT', '/factures/modeles/active', { slug }),
};
