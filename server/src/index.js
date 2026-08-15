import express from 'express';
import compression from 'compression';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { assertConfig, config } from './config.js';
import { api } from './routes/api.js';
import { admin } from './routes/admin.js';
import { refreshAll, startScheduler } from './etl/refresh.js';

assertConfig();

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
