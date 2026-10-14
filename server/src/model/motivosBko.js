// Usado por slaBko.js — ver categoriaMotivo().
/**
 * Padronização dos motivos de devolução do BKO (uMov).
 *
 * A partir de ~05/10/2026 o BKO passou a escrever o motivo como
 * "<Categoria> - (<detalhe>)". Antes disso o texto era livre. A regra:
 *  1. tira o prefixo "Motivo da reprovação" que algumas pessoas colam antes;
 *  2. se o texto COMEÇA com uma das categorias padrão, usa ela (caso do novo modelo);
 *  3. senão, procura palavras-chave no texto inteiro (recupera parte do histórico);
 *  4. se seguiu o modelo "<algo> - (...)" mas <algo> não é categoria conhecida, usa <algo>
 *     como categoria própria (o BKO pode ter criado outra);
 *  5. o resto vira "Outros (texto livre)"; motivo vazio/"-" vira "Sem motivo informado".
 */
const sem = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const CATEGORIAS_MOTIVO = [
  'Endereço com pendência',
  'Comprovante não atende os requisitos',
  'Sem viabilidade/Área restrita',
  'Cliente ativo',
  'Documento vencido',
  'Bloqueio Financeiro',
  'Duplicado',
  'Divergência no cadastro',
  'Multiplas Contratações',
  'Cliente com pendência no CPF junto a Sebratel',
  'Venda já está sendo tratada por outro vendedor',
  'Arquivos não estão abrindo',
  'Sem comprovante/documento anexado',
  'Erro no cadastro',
  'Condomínio não adequado',
  'Cliente tem que entrar em contato para reabrir a venda',
  'Ajuste de CTO',
  'Necessário localização fixa',
  'Encerrado por falta de contato 3/ Desistência',
];
export const SEM_MOTIVO = 'Sem motivo informado';
export const OUTROS = 'Outros (texto livre)';

// prefixos aceitos para cada categoria (sem acento, minúsculas) — o 1º é o próprio nome
const PREFIXOS = new Map(CATEGORIAS_MOTIVO.map((c) => [c, [sem(c)]]));
PREFIXOS.get('Sem viabilidade/Área restrita').push('sem viabilidade', 'area restrita');
PREFIXOS.get('Venda já está sendo tratada por outro vendedor').push('venda ja esta sendo tratada');
PREFIXOS.get('Encerrado por falta de contato 3/ Desistência').push('encerrado por falta de contato', 'desistencia');
PREFIXOS.get('Cliente com pendência no CPF junto a Sebratel').push('cliente com pendencia no cpf');
PREFIXOS.get('Cliente tem que entrar em contato para reabrir a venda').push('cliente tem que entrar em contato');
PREFIXOS.get('Sem comprovante/documento anexado').push('sem comprovante', 'sem documento');
PREFIXOS.get('Duplicado').push('venda duplicada');
PREFIXOS.get('Cliente ativo').push('possui cliente ativo');

// palavras-chave, na ORDEM de prioridade (a primeira que casar vence)
const CHAVES = [
  ['Encerrado por falta de contato 3/ Desistência', [/falta de contato/, /desist/]],
  ['Cliente tem que entrar em contato para reabrir a venda', [/reabrir/]],
  ['Venda já está sendo tratada por outro vendedor', [/outro vendedor/, /sendo tratad/]],
  ['Multiplas Contratações', [/multiplas contrata/]],
  ['Duplicado', [/duplicad/, /duplicid/, /ja (foi )?reenviad/]],
  ['Cliente com pendência no CPF junto a Sebratel', [/pendencia (no|do|de) cpf/, /cpf.{0,20}pendenc/, /cpf (esta )?pendente/, /cliente (possui|com) pendencia/]],
  ['Bloqueio Financeiro', [/bloqueio financeiro/, /bloqueado (no )?financeiro/]],
  ['Arquivos não estão abrindo', [/nao (estao )?abr(e|em|indo)/, /nao foi possivel abrir/, /corrompid/, /senha/]],
  ['Sem comprovante/documento anexado', [/sem (o )?comprovante/, /sem (o )?documento/, /nao (foi )?anexad/, /falt(a|ou) (o )?(comprovante|documento)/, /(encaminhar|enviar|anexar) (o )?(comprovante|documento)/]],
  ['Comprovante não atende os requisitos', [/comprovante (enviado )?(nao atende|nao aceito|invalido|excede)/, /excede (os )?3 meses/]],
  ['Documento vencido', [/vencid/, /de 10 anos/, /documento muito antigo/]],
  ['Endereço com pendência', [/endereco.{0,20}pendencia/, /pendencia no endereco/, /endereco pendente/]],
  ['Sem viabilidade/Área restrita', [/viabilidade/, /area restrita/, /fora da area/]],
  ['Condomínio não adequado', [/condominio/]],
  ['Ajuste de CTO', [/\bcto\b/]],
  ['Necessário localização fixa', [/localizacao fixa/]],
  ['Divergência no cadastro', [/divergen/, /diferente/, /nome d[oa] client/, /cpf do solicitante/]],
  ['Erro no cadastro', [/erro no (cadastro|campo)/, /corrig/, /\bcampo\b/, /incorret/, /\bcep\b/, /telefone/, /\bfone\b/, /e ?mail/, /digito/, /data de nascimento/, /\bbloco\b/, /apartamento/]],
  ['Comprovante não atende os requisitos', [/comprovante/]],
  ['Cliente ativo', [/cliente ativo/, /contrato ativo/, /cliente (ja )?(tem|possui) contrato/]],
];

const RE_PREFIXO_MOTIVO = /^motivo da reprovacao\s*[:\-–]?\s*/;

export function categoriaMotivo(texto) {
  const bruto = String(texto || '').replace(/\s+/g, ' ').trim();
  let t = sem(bruto);
  if (!t || /^[-–.\s]*$/.test(t)) return SEM_MOTIVO;
  t = t.replace(RE_PREFIXO_MOTIVO, '');
  if (!t || /^[-–.\s]*$/.test(t)) return SEM_MOTIVO;
  for (const [cat, prefixos] of PREFIXOS) {
    if (prefixos.some((p) => t.startsWith(p))) return cat;
  }
  for (const [cat, regras] of CHAVES) {
    if (regras.some((r) => r.test(t))) return cat;
  }
  // seguiu o modelo "<Categoria> - (...)" com uma categoria que não está na lista
  const semPrefixo = bruto.replace(/^motivo da reprova[cç][aã]o\s*[:\-–]?\s*/i, '');
  const m = semPrefixo.match(/^([^\-–()]{3,60}?)\s*[-–]\s*\(/);
  if (m) {
    const nome = m[1].trim().replace(/[.:;,]+$/, '');
    return nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase();
  }
  return OUTROS;
}
