/**
 * Recorte histórico da carga — o antigo `DATA_SINCE`.
 *
 * Ele decide o alcance de TODO o relatório: quanto histórico existe para comparar
 * meses, montar coortes e projetar. Isso é decisão de negócio, não de infraestrutura,
 * e estava preso no `.env` — mudar exigia editar o stack e subir o container de novo.
 *
 * Agora o `.env` é apenas a SEMENTE: vale enquanto ninguém definiu nada na tela.
 * O que a tela grava tem precedência e vive no volume de dados, junto de access.json.
 *
 * `config.since` lê daqui através de um getter, e todos os pontos que montam SQL já
 * liam `config.since` de forma preguiçosa — então a próxima carga usa o valor novo
 * sem precisar reiniciar nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arquivo = () => (process.env.JANELA_PATH
  ? path.resolve(process.env.JANELA_PATH)
  : path.resolve(__dirname, '../data/janela.json'));

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const hoje = () => new Date().toISOString().slice(0, 10);

/**
 * Data existe de verdade? O V8 não recusa dia inválido em string ISO — ele rola
 * para frente ("2025-02-31" vira 3 de março). Só a ida e volta denuncia.
 */
const dataReal = (v) => {
  if (!ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Semente do .env — lida na hora da chamada, nunca no import (o dotenv roda depois). */
function semente() {
  const d = process.env.DATA_SINCE;
  const p = process.env.PHONE_SINCE;
  const c = process.env.CRM_SINCE;
  const rl = process.env.REL_SINCE;
  return {
    since: ISO.test(d || '') ? d : '2024-01-01',
    phoneSince: ISO.test(p || '') ? p : '2024-11-01',
    // O recorte do CRM (leads e negociações). No `.pbip` de Leads é a constante
    // '2026-01-01' escrita dentro das duas consultas; aqui ele entrou junto dos
    // outros dois para o admin mexer nos três no mesmo lugar.
    crmSince: ISO.test(c || '') ? c : '2026-01-01',
    /**
     * Recorte de Relatórios Comercial: cesta de produtos, pesquisa de cancelamento
     * e base de clientes.
     *
     * Ganhou data própria porque é o conjunto mais PESADO do dashboard e o mais
     * operacional. Medido: a cesta são 220 mil linhas e 89 MB com o recorte de 2024,
     * e aquelas telas respondem "onde está este contrato agora" — raramente sobre
     * 2024. Amarrá-la à janela dos contratos obrigava a escolher entre histórico na
     * Diretoria e memória no container.
     *
     * Sem valor definido vale a data inicial, para que ligar esta versão não mude
     * número nenhum sem alguém pedir.
     */
    relSince: ISO.test(rl || '') ? rl : null,
  };
}

function ler() {
  try {
    const p = arquivo();
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn(`[janela] não foi possível ler o recorte salvo: ${err.message} — usando o .env`);
    return {};
  }
}

function gravar(dados) {
  const p = arquivo();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
}

/** Estado da recarga disparada pela última alteração — o front mostra o progresso. */
let recarga = { rodando: false, erro: null, concluidaEm: null };

export const estadoRecarga = () => ({ ...recarga });

export function marcarRecarga(estado) {
  recarga = { ...recarga, ...estado };
}

/** Recorte em vigor. */
export function janela() {
  const base = semente();
  const salvo = ler();
  const valido = (v) => (ISO.test(v || '') ? v : null);
  return {
    since: valido(salvo.since) || base.since,
    phoneSince: valido(salvo.phoneSince) || base.phoneSince,
    crmSince: valido(salvo.crmSince) || base.crmSince,
    // sem definição própria, segue a data inicial dos contratos
    relSince: valido(salvo.relSince) || base.relSince || (valido(salvo.since) || base.since),
    origem: valido(salvo.since) ? 'tela' : 'env',
    semente: base,
    atualizadoEm: salvo.atualizadoEm || null,
    atualizadoPor: salvo.atualizadoPor || null,
  };
}

/**
 * Valida e grava. Recusa data futura, formato inválido e telefonia começando antes
 * da base — a ativação de telefonia só faz sentido dentro do recorte principal.
 *
 * O CRM NÃO tem essa amarra com a data inicial: leads e negociações vivem num
 * modelo próprio, e nada impede querer mais histórico de CRM que de contrato (ou
 * o contrário). Amarrar os dois só criaria um erro de validação sem motivo.
 */
export function definirJanela({ since, phoneSince, crmSince, relSince }, porQuem) {
  const atual = janela();
  const novo = {
    since: since ?? atual.since,
    phoneSince: phoneSince ?? atual.phoneSince,
    crmSince: crmSince ?? atual.crmSince,
    relSince: relSince ?? atual.relSince,
  };

  for (const [campo, rotulo] of [
    ['since', 'Data inicial'],
    ['phoneSince', 'Início da telefonia'],
    ['crmSince', 'Início do CRM'],
    ['relSince', 'Início dos relatórios'],
  ]) {
    if (!ISO.test(novo[campo])) throw new Error(`${rotulo}: use o formato AAAA-MM-DD.`);
    if (!dataReal(novo[campo])) throw new Error(`${rotulo}: ${novo[campo]} não existe no calendário.`);
    if (novo[campo] > hoje()) throw new Error(`${rotulo} não pode estar no futuro.`);
    if (novo[campo] < '2010-01-01') throw new Error(`${rotulo}: anterior a 2010, provavelmente é engano.`);
  }
  if (novo.phoneSince < novo.since) {
    throw new Error('O início da telefonia não pode ser anterior à data inicial da base.');
  }

  gravar({
    ...novo,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: String(porQuem || '').toLowerCase(),
  });
  return janela();
}

/** Volta a obedecer o .env. */
export function restaurarJanela() {
  const p = arquivo();
  if (fs.existsSync(p)) fs.rmSync(p);
  return janela();
}
