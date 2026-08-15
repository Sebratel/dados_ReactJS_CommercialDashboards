/**
 * Registro do provedor de IA: guarda a configuração em data/ia.json com a chave
 * cifrada. A chave nunca sai numa resposta da API — só uma dica com os quatro
 * últimos caracteres, para o admin reconhecer qual cadastrou.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { cifrar, decifrar } from './cripto.js';
import { TIPOS, construir, provedorDoEnv } from './provedor.js';

const arquivo = () => path.join(path.dirname(config.accessPath), 'ia.json');

function ler() {
  try {
    if (!fs.existsSync(arquivo())) return null;
    const raw = fs.readFileSync(arquivo(), 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn('[ia] não foi possível ler a configuração:', err.message);
    return null;
  }
}

function gravar(dados) {
  fs.mkdirSync(path.dirname(arquivo()), { recursive: true });
  fs.writeFileSync(arquivo(), `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

const dica = (chave) => (chave && chave.length > 4 ? `••••${chave.slice(-4)}` : null);

/** Visão pública: tudo menos a chave. */
export function estado() {
  const salvo = ler();
  const env = provedorDoEnv();
  if (!salvo && !env) {
    return { configurado: false, origem: null, tipo: 'anthropic', modelo: '', baseUrl: null, dica: null };
  }
  if (!salvo && env) {
    return {
      configurado: true,
      origem: 'env',
      tipo: env.tipo,
      modelo: env.modelo,
      baseUrl: env.baseUrl,
      dica: dica(env.chave),
      aviso: 'Configuração vinda do .env. Cadastre pela tela para poder trocar sem redeploy.',
    };
  }
  return {
    configurado: !!salvo.chaveCifrada,
    origem: 'tela',
    tipo: salvo.tipo,
    modelo: salvo.modelo,
    baseUrl: salvo.baseUrl || null,
    maxTokens: salvo.maxTokens || 4000,
    dica: salvo.dica || null,
    atualizadoEm: salvo.atualizadoEm || null,
    atualizadoPor: salvo.atualizadoPor || null,
    ultimoTeste: salvo.ultimoTeste || null,
  };
}

/** Configuração completa (com a chave em claro) para uso interno. */
export function configuracaoAtiva() {
  const salvo = ler();
  if (salvo?.chaveCifrada) {
    try {
      return {
        tipo: salvo.tipo,
        modelo: salvo.modelo,
        chave: decifrar(salvo.chaveCifrada),
        baseUrl: salvo.baseUrl || null,
        maxTokens: salvo.maxTokens || 4000,
        origem: 'tela',
      };
    } catch (err) {
      console.warn('[ia] chave gravada não pôde ser lida:', err.message);
    }
  }
  return provedorDoEnv();
}

export function provedorAtivo() {
  const cfg = configuracaoAtiva();
  return cfg ? { provedor: construir(cfg), cfg } : null;
}

export function validar(entrada) {
  if (!TIPOS.includes(entrada.tipo)) throw new Error('Provedor inválido. Escolha Anthropic, OpenAI ou Gemini.');
  if (!entrada.modelo?.trim()) throw new Error('Informe o modelo (ex.: claude-sonnet-5).');
  if (entrada.baseUrl) {
    try {
      const u = new URL(entrada.baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad');
    } catch {
      throw new Error('URL base inválida (use http ou https).');
    }
  }
  if (entrada.maxTokens != null && (entrada.maxTokens < 256 || entrada.maxTokens > 64000)) {
    throw new Error('O teto de tokens deve ficar entre 256 e 64.000.');
  }
}

/** Salva. `chave` ausente mantém a atual; string vazia remove tudo. */
export function salvar(entrada, porQuem) {
  validar(entrada);
  const atual = ler();
  const trocaChave = entrada.chave !== undefined && entrada.chave !== null;
  const chave = trocaChave ? String(entrada.chave).trim() : null;

  if (trocaChave && !chave) {
    if (fs.existsSync(arquivo())) fs.unlinkSync(arquivo());
    return estado();
  }
  if (!atual?.chaveCifrada && !chave) {
    throw new Error('Informe a chave de API do provedor.');
  }

  gravar({
    tipo: entrada.tipo,
    modelo: entrada.modelo.trim(),
    baseUrl: entrada.baseUrl?.trim() || null,
    maxTokens: entrada.maxTokens || 4000,
    chaveCifrada: chave ? cifrar(chave) : atual.chaveCifrada,
    dica: chave ? dica(chave) : atual.dica,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: porQuem,
    ultimoTeste: atual?.ultimoTeste || null,
  });
  return estado();
}

export function remover() {
  if (fs.existsSync(arquivo())) fs.unlinkSync(arquivo());
  return estado();
}

/** Modelos que a chave alcança — aceita uma chave ainda não salva. */
export async function listarModelos({ tipo, chave, baseUrl }) {
  let cfg;
  if (chave) {
    cfg = { tipo, modelo: '', chave, baseUrl: baseUrl || null };
  } else {
    cfg = configuracaoAtiva();
    if (!cfg) throw new Error('Nenhuma chave cadastrada.');
    if (tipo) cfg = { ...cfg, tipo };
    if (baseUrl !== undefined) cfg = { ...cfg, baseUrl };
  }
  return construir(cfg).modelos();
}

/** Teste de conexão: separa "chave errada" de "modelo inexistente". */
export async function testar() {
  const ativo = provedorAtivo();
  if (!ativo) throw new Error('Nenhum provedor de IA configurado.');
  const inicio = Date.now();
  let resultado;
  try {
    const texto = await ativo.provedor.conversar(
      'Você é um teste de conectividade. Responda apenas: OK',
      'Responda apenas OK.',
    );
    resultado = { ok: true, ms: Date.now() - inicio, amostra: (texto || '').slice(0, 120) };
  } catch (err) {
    resultado = { ok: false, ms: Date.now() - inicio, erro: err.message };
  }
  const salvo = ler();
  if (salvo) {
    gravar({ ...salvo, ultimoTeste: { ...resultado, em: new Date().toISOString() } });
  }
  return resultado;
}
