import { Router } from 'express';
import { config } from '../config.js';
import { exigirAuth } from '../auth/middleware.js';
import {
  definirEscopo, definirPapel, definirPowerUser, definirTela, definirTelasDoEmail,
  listarTelas, listarUsuarios, matrizDeAcesso, papelDe, removerUsuario, telasDoUsuario,
} from '../auth/access.js';
import { listarQueries, testarQuery } from '../model/catalogo.js';
import { definirJanela, estadoRecarga, janela, marcarRecarga, restaurarJanela } from '../janela.js';
import { refreshAll } from '../etl/refresh.js';
import { getState } from '../model/store.js';
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
    // quem enxerga uma fatia precisa saber disso, senão conclui que o número está
    // errado; a interface avisa no topo em vez de deixar o recorte invisível
    escopo: req.usuario.escopo?.equipes || null,
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

/**
 * A mesma permissão pelo lado da pessoa — é o que a tela de acessos usa.
 *
 * `matriz()` existe para que LER e GRAVAR devolvam o mesmo formato. Quando só o
 * GET incluía `equipes`, o front — que troca o estado pela resposta — ficava sem a
 * lista depois do primeiro clique, e o seletor de equipes abria vazio.
 */
const matriz = () => ({ ...matrizDeAcesso(), equipes: getState().dims?.equipes || [] });

admin.get('/access/matriz', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json(matriz());
});

admin.put('/access/users/:email/telas', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    definirTelasDoEmail(req.params.email, req.body?.telas, req.usuario.email);
    res.json(matriz());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Escopo de dados: as equipes que a pessoa enxerga, em todas as telas. */
admin.put('/access/users/:email/escopo', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    definirEscopo(req.params.email, req.body?.equipes, req.usuario.email);
    res.json(matriz());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// ----------------------------------------------------- janela de dados
/**
 * Recorte histórico da carga. Mudar isso implica reler tudo, então a recarga roda
 * em segundo plano: a resposta volta na hora e o front acompanha por `recarga`.
 * Enquanto ela não termina, os dados antigos continuam servindo — ninguém fica
 * olhando tela vazia por causa de uma mudança de configuração.
 */
function recarregar(motivo) {
  marcarRecarga({ rodando: true, erro: null });
  refreshAll()
    .then(() => marcarRecarga({ rodando: false, erro: null, concluidaEm: new Date().toISOString() }))
    .catch((err) => {
      console.error(`[janela] recarga após ${motivo} falhou: ${err.message}`);
      marcarRecarga({ rodando: false, erro: err.message, concluidaEm: new Date().toISOString() });
    });
}

admin.get('/janela', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  const s = getState();
  res.json({
    ...janela(),
    recarga: estadoRecarga(),
    contratos: s.facts?.length ?? 0,
    carregadoEm: s.builtAt || null,
  });
});

admin.put('/janela', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const antes = janela();
    const depois = definirJanela(req.body || {}, req.usuario.email);
    const mudou = antes.since !== depois.since || antes.phoneSince !== depois.phoneSince;
    if (mudou) {
      console.log(`[janela] ${req.usuario.email}: ${antes.since} -> ${depois.since} (telefonia ${depois.phoneSince})`);
      recarregar('alteração da janela');
    }
    return res.json({ ...depois, recarga: estadoRecarga(), recarregando: mudou });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

admin.post('/janela/restaurar', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  const antes = janela();
  const depois = restaurarJanela();
  const mudou = antes.since !== depois.since || antes.phoneSince !== depois.phoneSince;
  if (mudou) recarregar('restauração do .env');
  return res.json({ ...depois, recarga: estadoRecarga(), recarregando: mudou });
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
