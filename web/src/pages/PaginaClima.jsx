import { useDados } from '../api';
import { Erro, Kpi, Loading, Vazio, Visual } from '../components/ui';
import { CHUVA } from '../components/charts';
import { Tabela } from '../components/tables';
import { Icone } from '../components/Icone';
import { dec1, int, labelData } from '../format';

/**
 * Aba CLIMA — previsão de chuva por cidade.
 *
 * É a única tela do dashboard que não fala com banco nosso: os dados vêm da
 * Open-Meteo, dois endpoints públicos sem chave, e só latitude e longitude saem
 * daqui. Por isso ela abre mesmo quando as consultas do Voalle falham — e o inverso
 * também vale: se a Open-Meteo cair, esta aba avisa e as outras seis continuam.
 *
 * Por que ela existe num dashboard comercial: instalação de fibra é serviço de rua.
 * A previsão de dezesseis dias é a que permite remarcar agenda antes de o dia chegar,
 * e o acumulado do ano explica um mês de ativação fraca.
 */

export function PaginaClima({ filtros }) {
  const { data, error, isLoading } = useDados('/relatorios/clima', filtros);
  const vazio = isLoading && !data;

  if (error) return <Erro erro={error} />;

  if (!vazio && data.erro && !data.dias.length) {
    return (
      <section className="grid">
        <Visual title="CLIMA" className="v-tabela">
          <Vazio texto={`A Open-Meteo não respondeu: ${data.erro}. Nenhuma outra tela depende desta busca.`} />
        </Visual>
      </section>
    );
  }

  const colunasAcumulado = [
    { key: 'cidade', titulo: 'CIDADE', align: 'left' },
    // a barra usa a cor da própria faixa de chuva, não um azul solto
    { key: 'mm', titulo: 'CHUVA NO ANO (MM)', fmt: dec1, databar: { cor: CHUVA.Moderada.cor } },
    { key: 'comChuva', titulo: 'DIAS COM CHUVA', fmt: int },
    { key: 'fortes', titulo: 'DIAS DE CHUVA FORTE', fmt: int },
    { key: 'dias', titulo: 'DIAS MEDIDOS', fmt: int },
  ];

  const totalFortes = vazio ? 0 : data.acumulado.reduce((a, l) => a + l.fortes, 0);

  return (
    <>
      <section className="grid linha-quatro">
        <Kpi
          value={vazio ? '—' : int(data.cidades.length)}
          label="CIDADES"
          desc="acompanhadas pela previsão"
          title="As sete cidades do relatório de origem, com as coordenadas de lá."
        />
        <Kpi
          value={vazio ? '—' : int(data.dias.length)}
          label="DIAS DE PREVISÃO"
          desc="a partir de hoje"
          title="A Open-Meteo entrega até dezesseis dias de previsão. Antes de hoje, o que existe é histórico fechado."
        />
        <Kpi
          value={vazio ? '—' : int(totalFortes)}
          label="DIAS DE CHUVA FORTE"
          desc="acima de 20 mm, no ano, somando cidades"
          title="Faixas da origem: sem chuva 0 mm, fraca até 5, moderada até 20, forte acima de 20."
        />
        <Kpi
          value={vazio ? '—' : (data.buscadoEm ? labelData(data.buscadoEm.slice(0, 10)) : '—')}
          label="BUSCADO EM"
          desc="uma busca por dia, guardada em disco"
          title="Chuva de ontem não muda, e a previsão de hoje não melhora se pedirmos de dez em dez minutos. Bater numa API de terceiro sem ganho não se faz."
        />
      </section>

      {!vazio && data.erro && (
        <p className="aviso-recorte">
          <Icone nome="alerta" tamanho={12} />
          A última busca falhou ({data.erro}). O que está na tela é a leitura anterior — clima de
          ontem é melhor que nenhum.
        </p>
      )}

      <section className="grid">
        <Visual
          title="PREVISÃO POR CIDADE"
          sub={vazio ? null : `${data.cidades.length} cidades × ${data.dias.length} dias · fonte Open-Meteo · passe o mouse para ver os milímetros`}
          className="v-tabela"
        >
          {vazio ? <Loading /> : data.dias.length
            ? (
              <div className="tbl-wrap">
                <table className="pbi matriz">
                  <thead>
                    <tr>
                      <th className="left col-nome">CIDADE</th>
                      {data.dias.map((d) => (
                        <th key={d} className="center" title={labelData(d)}>
                          {d.slice(8)}/{d.slice(5, 7)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.previsao.map((linha) => (
                      <tr key={linha.cidade}>
                        <td className="left col-nome">{linha.cidade}</td>
                        {linha.dias.map((cel, i) => {
                          const ic = cel ? CHUVA[cel.classificacao] : null;
                          return (
                            <td
                              key={data.dias[i]}
                              className="center"
                              title={cel
                                ? `${labelData(cel.data)} · ${ic.rotulo} · ${dec1(cel.mm)} mm${cel.probabilidade !== null ? ` · ${cel.probabilidade}% de chance` : ''}`
                                : 'sem previsão'}
                            >
                              {ic ? <Icone nome={ic.icone} tamanho={14} style={{ color: ic.cor }} /> : '–'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Vazio texto="Sem previsão disponível" />}
        </Visual>
      </section>

      <section className="grid">
        <Visual
          title="CHUVA ACUMULADA NO ANO"
          sub={vazio ? null : 'histórico fechado, do primeiro de janeiro até ontem'}
          className="v-tabela"
        >
          {vazio ? <Loading /> : data.acumulado.length
            ? (
              <Tabela
                colunas={colunasAcumulado}
                dados={data.acumulado.map((l) => ({ ...l, __key: l.cidade }))}
                ordemInicial={{ key: 'mm', dir: 'desc' }}
              />
            ) : <Vazio />}
        </Visual>
      </section>

      <section className="grid">
        <Visual title="COMO A CHUVA É CLASSIFICADA" className="v-auto">
          <ul className="legenda-clima">
            {['Sem chuva', 'Fraca', 'Moderada', 'Forte'].map((k) => (
              <li key={k}>
                <Icone nome={CHUVA[k].icone} tamanho={15} style={{ color: CHUVA[k].cor }} />
                <b>{CHUVA[k].rotulo}</b>
                <span>{CHUVA[k].faixa}</span>
              </li>
            ))}
          </ul>
        </Visual>
      </section>
    </>
  );
}
