import { Router } from 'express';
import { config } from '../config.js';
import { exigirAuth } from '../auth/middleware.js';
import {
  definirPapel, definirPowerUser, definirTela, listarTelas, listarUsuarios, papelDe,
  removerUsuario, telasDoUsuario,
} from '../auth/access.js';
import { listarQueries, testarQuery } from '../model/catalogo.js';
import { estado as estadoIA, listarModelos, remover as removerIA, salvar as salvarIA, testar as testarIA } from '../ia/registro.js';
import { ROTULO_TIPO, TIPOS } from '../ia/provedor.js';

export const admin = Router();

// ------------------------------------------------------------------ sessão
/** Configuração pública: o front precisa do client_id para montar o botão. */
admin.get('/auth/config', (req, res) => {
  res.json({
    clientId: config.auth.clientId,
    dominio: config.auth.dominio,
    habilitado: config.auth.habilitado,
  });
});

/** Quem sou eu: papel efetivo + telas que posso abrir. */
admin.get('/me', exigirAuth(), (req, res) => {
  res.json({
    email: req.usuario.email,
    nome: req.usuario.nome,
    foto: req.usuario.foto || null,
    papel: req.usuario.papel,
    powerUser: !!req.usuario.powerUser,
    telas: telasDoUsuario(req.usuario),
  });
});

// ------------------------------------------------------- usuários e papéis
admin.get('/access/users', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({ usuarios: listarUsuarios(), papeis: ['viewer', 'dev', 'admin'] });
});

admin.put('/access/users/:email', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const papel = definirPapel(req.params.email, req.body?.papel);
    res.json({ ok: true, email: req.params.email.toLowerCase(), papel });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Atributo de power user — independente do papel, por isso rota própria. */
admin.put('/access/users/:email/poweruser', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const powerUser = definirPowerUser(req.params.email, !!req.body?.ativo);
    res.json({ ok: true, email: req.params.email.toLowerCase(), powerUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.delete('/access/users/:email', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  const email = String(req.params.email || '').toLowerCase();
  if (email === req.usuario.email && papelDe(email) === 'admin') {
    return res.status(400).json({ error: 'Você não pode remover o seu próprio acesso de administrador.' });
  }
  const removido = removerUsuario(email);
  return res.json({ ok: true, removido });
});

// ------------------------------------------------------------ acesso/telas
admin.get('/access/screens', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({ telas: listarTelas() });
});

admin.put('/access/screens/:id', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const tela = definirTela(req.params.id, {
      modo: req.body?.modo,
      emails: req.body?.emails,
    }, req.usuario.email);
    res.json({ ok: true, tela });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------- catálogo de queries (DEV)
// Exclusivo de power users: administrar pessoas e enxergar o SQL do sistema são
// atribuições diferentes, então o papel de admin, sozinho, não entra aqui.
admin.get('/queries', exigirAuth({ powerUser: true }), (req, res) => {
  res.json({ queries: listarQueries(), since: config.since, phoneSince: config.phoneSince });
});

admin.post('/queries/:id/test', exigirAuth({ powerUser: true }), async (req, res) => {
  try {
    const resultado = await testarQuery(req.params.id, req.body?.limite);
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------- provedor de IA
admin.get('/ia', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({ ...estadoIA(), tipos: TIPOS.map((t) => ({ id: t, label: ROTULO_TIPO[t] })) });
});

admin.put('/ia', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    res.json(salvarIA(req.body || {}, req.usuario.email));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.delete('/ia', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json(removerIA());
});

admin.post('/ia/modelos', exigirAuth({ minPapel: 'admin' }), async (req, res) => {
  try {
    res.json({ modelos: await listarModelos(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.post('/ia/testar', exigirAuth({ minPapel: 'admin' }), async (req, res) => {
  try {
    res.json(await testarIA());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
