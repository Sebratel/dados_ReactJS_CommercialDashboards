/**
 * Criptografia dos segredos em repouso (hoje: a chave do provedor de IA).
 * AES-256-GCM autenticado — adulteração é detectada na leitura.
 * Formato do blob: iv:tag:texto, tudo em base64.
 *
 * A chave vem de SECRET_KEY (env). Se não houver, é gerada uma e guardada em
 * data/.secret, ao lado do access.json — assim funciona sem configuração
 * extra, e como o diretório é um volume, sobrevive ao recriar o container.
 * Definir SECRET_KEY no stack continua sendo o caminho recomendado.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let cacheChave = null;

function arquivoDoSegredo() {
  return path.join(path.dirname(config.accessPath), '.secret');
}

function segredo() {
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  if (cacheChave) return cacheChave;

  const arquivo = arquivoDoSegredo();
  try {
    if (fs.existsSync(arquivo)) {
      cacheChave = fs.readFileSync(arquivo, 'utf8').trim();
      if (cacheChave) return cacheChave;
    }
    cacheChave = randomBytes(48).toString('base64');
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(arquivo, `${cacheChave}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`[cripto] chave de cifra gerada em ${arquivo} — defina SECRET_KEY no ambiente para controlá-la`);
    return cacheChave;
  } catch (err) {
    throw new Error(
      'Não foi possível preparar a chave de cifra dos segredos. '
      + `Defina SECRET_KEY no ambiente (ex.: openssl rand -base64 48). Detalhe: ${err.message}`,
    );
  }
}

const chave = () => createHash('sha256').update(segredo()).digest();

export function cifrar(texto) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decifrar(blob) {
  const [ivB, tagB, encB] = String(blob || '').split(':');
  if (!ivB || !tagB || !encB) throw new Error('Segredo gravado em formato inválido.');
  const decipher = createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
}
