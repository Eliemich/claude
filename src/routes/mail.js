/**
 * /api — interface d'envoi (connexion obligatoire pour tout)
 *  GET  /status                      mode d'envoi (Zoho ou test), expéditeur, compte connecté
 *  GET  /stats                       compteurs (aujourd'hui, 7 jours, total) + envois des 14 derniers jours
 *  GET  /modeles                     liste des modèles          POST /modeles   import d'un fichier .html
 *  GET  /modeles/:slug               un modèle (avec son HTML)  DELETE /modeles/:slug
 *  GET  /modele-exemple              fichier exemple à télécharger
 *  POST /apercu                      { modele, to, vars } → email rempli (les balises vides restent visibles)
 *  POST /envoi                       { modele, to, vars } → envoi (toutes les balises sont obligatoires)
 *  GET  /historique                  300 derniers envois
 */
import { Router } from 'express';
import { db, now } from '../db.js';
import { config } from '../config.js';
import { badRequest, fieldError, notFound } from '../errors.js';
import { findById } from '../users.js';
import { requireAuth, limits } from '../security.js';
import { sendMail, mailMode, fromAddress } from '../mailer.js';
import {
  listModeles, readModele, saveModele, deleteModele, fillModele, valueProblem,
  inlineAttachments, previewImages, validSlug, EXAMPLE_FILE, MAX_SIZE, MAX_MODELES,
} from '../modeles.js';
import {
  FACTURE_TAGS, factureInput, facturePreviewData, factureVars, createFacture, deleteFacture, factureExampleValues,
} from '../factures.js';
import {
  listFactureModeles, readFactureModele, saveFactureModele, deleteFactureModele,
  getActiveSlug as getActiveFactureSlug, setActiveSlug as setActiveFactureSlug,
  renderFacture, FACTURE_BALISES, FEXAMPLE_FILE, FMAX_SIZE, FMAX, validSlug as validFactureSlug,
} from '../facture-modeles.js';

const EMAIL_RE = /^[^\s@<>,;"'()]+@[^\s@<>,;"'()]+\.[a-z]{2,}$/i;

/** Lit et vérifie la demande (modèle, destinataire, valeurs des balises, champs facture f_*). */
function emailInput(body = {}) {
  const slug = typeof body.modele === 'string' ? body.modele : '';
  const t = validSlug(slug) ? readModele(slug) : null;
  if (!t) throw fieldError('modele', 'Ce modèle n\'existe plus : rechargez la page.');
  const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  const vars = {};
  for (const [k, v] of Object.entries(body.vars && typeof body.vars === 'object' ? body.vars : {})) {
    if (/^[\p{L}\p{N}_]{1,30}$/u.test(k) && typeof v === 'string') vars[k.toLowerCase()] = v.trim().slice(0, 2000);
  }
  return { t, to, vars, body };
}

export function mailRouter() {
  const r = Router();
  r.use(requireAuth);

  r.get('/status', (req, res) => {
    res.json({ mode: mailMode, from: fromAddress, user: (({ id, email, nom }) => ({ id, email, nom }))(findById(req.session.userId) || {}), sendsPerHour: config.sendsPerHour });
  });

  r.get('/stats', (_req, res) => {
    const day = (offset) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
    const rows = db.prepare(`SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM envois
      WHERE statut != 'echec' AND created_at >= ? GROUP BY d`).all(day(13));
    const byDay = Object.fromEntries(rows.map((x) => [x.d, x.n]));
    const parJour = Array.from({ length: 14 }, (_, i) => byDay[day(13 - i)] || 0);
    res.json({
      aujourdhui: parJour[13],
      semaine: parJour.slice(7).reduce((a, b) => a + b, 0),
      total: db.prepare('SELECT COUNT(*) AS n FROM envois WHERE statut != \'echec\'').get().n,
      echecs: db.prepare('SELECT COUNT(*) AS n FROM envois WHERE statut = \'echec\'').get().n,
      parJour,
    });
  });

  /* ---- Modèles ---- */
  const slugParam = (req) => {
    if (!validSlug(req.params.slug)) throw badRequest('Nom de modèle invalide.');
    return req.params.slug;
  };

  r.get('/modeles', (_req, res) => res.json(listModeles()));

  r.get('/modeles/:slug', (req, res) => {
    const t = readModele(slugParam(req));
    if (!t) throw notFound('Modèle');
    res.json({ ...t, apercu: previewImages(t.html) });
  });

  r.get('/modele-exemple', (_req, res) => {
    res.type('html').attachment('modele-exemple-trading-bara.html').sendFile(EXAMPLE_FILE);
  });

  r.post('/modeles', (req, res) => {
    const fichier = typeof req.body?.fichier === 'string' ? req.body.fichier.trim().slice(0, 120) : '';
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    if (!/\.html?$/i.test(fichier)) throw badRequest('Choisissez un fichier .html');
    if (!html) throw badRequest('Le fichier est vide.');
    if (html.length > MAX_SIZE) throw badRequest('Fichier trop lourd (500 Ko maximum) : mettez les images en ligne et utilisez leur adresse https://…');
    if (!/<(html|body|table|div|p)\b/i.test(html)) throw badRequest('Ce fichier ne ressemble pas à une page HTML.');
    if (listModeles().length >= MAX_MODELES) throw badRequest(`${MAX_MODELES} modèles maximum : supprimez-en un avant d'en importer un autre.`);
    let t;
    try { t = saveModele(fichier, html); } catch (e) { throw badRequest(e.message); }
    console.log(`[modèle] ${t.replaced ? 'remplacé' : 'importé'} : ${t.slug}.html (compte ${req.session.userId})`);
    res.status(t.replaced ? 200 : 201).json(t);
  });

  r.delete('/modeles/:slug', (req, res) => {
    const slug = slugParam(req);
    if (!deleteModele(slug)) throw notFound('Modèle');
    console.log(`[modèle] supprimé : ${slug}.html (compte ${req.session.userId})`);
    res.json({ ok: true });
  });

  /* ---- Modèles de FACTURES (designs .html de la page facture) ---- */
  const fslugParam = (req) => {
    if (!validFactureSlug(req.params.slug)) throw badRequest('Nom de modèle invalide.');
    return req.params.slug;
  };

  r.get('/factures/modeles', (_req, res) => res.json({ modeles: listFactureModeles(), actif: getActiveFactureSlug(), balises: FACTURE_BALISES }));

  r.get('/factures/modele-exemple', (_req, res) => {
    res.type('html').attachment('modele-facture-exemple-trading-bara.html').sendFile(FEXAMPLE_FILE);
  });

  r.get('/factures/modeles/:slug', (req, res) => {
    const t = readFactureModele(fslugParam(req));
    if (!t) throw notFound('Modèle de facture');
    res.json({ ...t, apercu: renderFacture(t.slug, factureExampleValues(), { example: true }) });
  });

  r.post('/factures/modeles', (req, res) => {
    const fichier = typeof req.body?.fichier === 'string' ? req.body.fichier.trim().slice(0, 120) : '';
    const html = typeof req.body?.html === 'string' ? req.body.html : '';
    if (!/\.html?$/i.test(fichier)) throw badRequest('Choisissez un fichier .html');
    if (!html) throw badRequest('Le fichier est vide.');
    if (html.length > FMAX_SIZE) throw badRequest('Fichier trop lourd (600 Ko maximum) : mettez les images en ligne et utilisez leur adresse https://…');
    if (!/<(html|body|table|div|p)\b/i.test(html)) throw badRequest('Ce fichier ne ressemble pas à une page HTML.');
    if (listFactureModeles().length >= FMAX) throw badRequest(`${FMAX} modèles maximum : supprimez-en un avant d'en importer un autre.`);
    let t;
    try { t = saveFactureModele(fichier, html); } catch (e) { throw badRequest(e.message); }
    console.log(`[facture-modèle] ${t.replaced ? 'remplacé' : 'importé'} : ${t.slug}.html (compte ${req.session.userId})`);
    res.status(t.replaced ? 200 : 201).json(t);
  });

  r.put('/factures/modeles/active', (req, res) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    try { setActiveFactureSlug(slug); } catch (e) { throw badRequest(e.message); }
    res.json({ ok: true, actif: getActiveFactureSlug() });
  });

  r.delete('/factures/modeles/:slug', (req, res) => {
    const slug = fslugParam(req);
    if (listFactureModeles().length <= 1) throw badRequest('Gardez au moins un modèle de facture.');
    if (!deleteFactureModele(slug)) throw notFound('Modèle de facture');
    console.log(`[facture-modèle] supprimé : ${slug}.html (compte ${req.session.userId})`);
    res.json({ ok: true, actif: getActiveFactureSlug() });
  });

  /* ---- Aperçu et envoi ---- */
  // Balises d'un modèle facture gérées par l'encadré Facture (pas demandées comme simples cases).
  const autoTags = (t) => (t.facture ? FACTURE_TAGS : []);

  const subjectOf = (body) => (typeof body.subject === 'string' ? body.subject.slice(0, 200) : '');

  r.post('/apercu', (req, res) => {
    const { t, to, vars, body } = emailInput(req.body);
    // Modèle facture : l'aperçu montre les infos saisies ; le lien pointe sur /facture/apercu (aucune facture créée).
    if (t.facture) Object.assign(vars, factureVars(facturePreviewData({ ...body, prenom: vars.prenom }), 'apercu'));
    const m = fillModele(t, vars, subjectOf(body));
    const auto = autoTags(t);
    const missing = t.balises.filter((b) => !vars[b.nom] && !auto.includes(b.nom)).map((b) => b.nom);
    res.json({ to, from: fromAddress, subject: m.subject, html: previewImages(m.html), missing, facture: t.facture });
  });

  r.post('/envoi', limits.send, async (req, res) => {
    const { t, to, vars, body } = emailInput(req.body);
    if (!to) throw fieldError('to', 'Indiquez l\'adresse email du destinataire.');
    if (to.length > 254 || !EMAIL_RE.test(to)) throw fieldError('to', 'Adresse email du destinataire invalide.');
    // On valide TOUT avant d'écrire quoi que ce soit (pas de facture orpheline).
    const auto = autoTags(t);
    for (const b of t.balises) {
      if (auto.includes(b.nom)) continue; // rempli par l'encadré Facture
      const problem = valueProblem(b, vars[b.nom]);
      if (problem) throw fieldError(`var_${b.nom}`, problem);
    }
    const factureData = t.facture ? factureInput({ ...body, prenom: vars.prenom }) : null; // lève si montant manquant

    const user = findById(req.session.userId);
    // Modèle facture : on crée la facture (id de lien non devinable), puis on remplit {{lien_facture}} & co.
    let facture = null;
    if (t.facture) {
      const mailVars = { ...vars }; // balises du mail déjà remplies (prenom…), pour le modèle de facture
      facture = createFacture(factureData, { client_email: to, user, modele: getActiveFactureSlug(), vars: mailVars });
      Object.assign(vars, factureVars(facture, facture.id));
    }
    const m = fillModele(t, vars, subjectOf(body));
    if (!m.subject) { if (facture) deleteFacture(facture.id); throw fieldError('subject', 'Indiquez l\'objet de l\'email (ou ajoutez une balise <title> au modèle).'); }

    const result = await sendMail({ to, subject: m.subject, html: m.html, text: m.text, attachments: inlineAttachments(m.html) });
    if (!result.ok && facture) deleteFacture(facture.id); // l'email n'est pas parti : pas de facture fantôme
    db.prepare(`INSERT INTO envois (created_at, user_id, user_nom, destinataire, modele, objet, statut, erreur)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(now(), user.id, user.nom, to, t.nom, m.subject,
      result.ok ? (result.mode === 'test' ? 'test' : 'envoye') : 'echec', result.error || null);
    if (!result.ok) throw badRequest(result.error);
    res.json({ ok: true, to, mode: result.mode, facture: facture ? { url: vars.lien_facture, numero: facture.numero } : null });
  });

  r.get('/historique', (_req, res) => {
    res.json(db.prepare(`SELECT id, created_at AS date, user_nom AS par, destinataire, modele, objet, statut, erreur
      FROM envois ORDER BY id DESC LIMIT 300`).all());
  });

  return r;
}
