import express from 'express';
import compression from 'compression';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { assertConfig, config } from './config.js';
import { api } from './routes/api.js';
import { admin } from './routes/admin.js';
import { refreshAll, startScheduler } from './etl/refresh.js';
import * as cofre from './cofre.js';

assertConfig();

/**
 * A chave que cifra os segredos em repouso (hoje a do provedor de IA) PRECISA
 * vir do ambiente.
 *
 * Sem `SECRET_KEY`, `ia/cripto.js` gera uma e guarda em `data/.secret` — um
 * arquivo no volume da stack. Em 02/10/2026 a stack foi recriada do zero, o
 * volume foi junto, e com ele a chave: o `ia.json` virou texto cifrado que
 * ninguém mais consegue abrir. O banco guarda a configuração, mas não adianta
 * guardar o cadeado junto com o que ele tranca.
 *
 * O aviso é no boot e é barulhento de propósito. Em desenvolvimento a geração
 * automática continua valendo — é o que deixa clonar o repo e rodar.
 */
function avisarSeChaveEfemera() {
  if (process.env.SECRET_KEY) return;
  console.warn(
    '[cripto] SECRET_KEY não definida — a chave de cifra será gerada em disco e MORRE '
    + 'se a stack for recriada, levando junto a chave do provedor de IA. '
    + 'Defina SECRET_KEY no ambiente: openssl rand -base64 48',
  );
}

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(cors());
app.use(express.json());

// sessão, gestão de acessos e catálogo de queries
app.use('/api', admin);
// dados do dashboard
app.use('/api', api);

// SPA (build do Vite copiado para server/public na imagem Docker)
if (fs.existsSync(config.publicDir)) {
  app.use(express.static(config.publicDir, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(config.publicDir, 'index.html'));
  });
} else {
  console.warn(`[web] pasta ${config.publicDir} não encontrada — servindo apenas a API`);
}

/**
 * A CONFIGURAÇÃO VEM ANTES DE QUALQUER COISA.
 *
 * Papéis e acesso por tela são lidos de forma SÍNCRONA pelo middleware de toda
 * requisição, então precisam estar em memória antes da primeira delas. Por isso
 * o `await` aqui em cima, e não junto da carga de dados: o ETL pode demorar
 * minutos, o cofre leva milissegundos, e subir o servidor antes dele serviria
 * requisição com a matriz de acesso vazia — todo mundo caindo para o padrão.
 *
 * Falha do banco NÃO derruba o boot: `carregar` cai para o espelho local e
 * registra o erro, que a tela de Configurações mostra.
 */
await cofre.carregar();
avisarSeChaveEfemera();

const server = app.listen(config.port, () => {
  console.log(`[web] dashboard comercial em http://0.0.0.0:${config.port}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

console.log('[etl] carga inicial…');
refreshAll()
  .then(() => {
    console.log('[etl] carga inicial concluída');
    startScheduler();
  })
  .catch((err) => {
    console.error('[etl] falha na carga inicial:', err);
    startScheduler();
  });

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[web] ${sig} recebido, encerrando…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
