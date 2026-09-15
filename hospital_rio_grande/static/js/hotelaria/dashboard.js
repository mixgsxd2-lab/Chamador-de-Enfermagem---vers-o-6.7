(function () {
  "use strict";

  const escapeHtml = HRG.escapeHtml;
  const formatarMinutos = HRG.formatarMinutos;

  const filtros = {};
  const filtroBusca = document.getElementById("filtroBusca");
  const filtroServico = document.getElementById("filtroServico");
  const filtroStatus = document.getElementById("filtroStatus");
  const filtroAndar = document.getElementById("filtroAndar");
  const filtroPeriodo = document.getElementById("filtroPeriodo");
  const filtrosAtivosEl = document.getElementById("filtrosAtivos");

  function tendenciaHtml(comparativo) {
    if (!comparativo) return "";
    const delta = comparativo.delta_percentual;
    let classe = "tendencia-neutra", seta = "→";
    if (delta > 0) { classe = "tendencia-alta"; seta = "▲"; }
    else if (delta < 0) { classe = "tendencia-baixa"; seta = "▼"; }
    return `<span class="tendencia ${classe}">${seta} ${HRG.formatarPercentual(delta)}</span>`;
  }

  async function carregar() {
    const params = new URLSearchParams();
    Object.entries(filtros).forEach(([chave, valor]) => { if (valor) params.set(chave, valor); });

    try {
      const { dados } = await HRG.fetchJSON(`/hotelaria/api/dashboard/resumo?${params.toString()}`);
      renderCartoes(dados);
      renderGraficoServico(dados.por_servico);
      renderGraficoPeriodo(dados.por_dia);
      renderGraficoAndar(dados.por_andar, dados.chamados_sem_andar);
    } catch (e) {
      HRG.toast("Não foi possível atualizar o dashboard.", "erro");
    }
  }

  function renderCartoes(d) {
    const cartoes = [
      { rotulo: "Total de chamados", valor: d.total, destaque: true, extra: tendenciaHtml(d.comparativo_periodo_anterior) },
      { rotulo: "Pendentes", valor: d.pendentes },
      { rotulo: "Em andamento", valor: d.andamento },
      { rotulo: "Finalizados", valor: d.finalizados },
      { rotulo: "Taxa de finalização", valor: d.taxa_finalizacao != null ? `${d.taxa_finalizacao}%` : "—" },
      { rotulo: "Tempo até ser assumido", valor: formatarMinutos(d.tempo_medio_espera_min) },
      { rotulo: "Tempo de atendimento", valor: formatarMinutos(d.tempo_medio_atendimento_min) },
      { rotulo: "Avaliação média", valor: d.total_avaliacoes ? `${d.media_avaliacao} ★` : "—" },
      { rotulo: "Encaminhados pela Enfermagem", valor: d.encaminhados_enfermagem },
    ];
    document.getElementById("cartoesResumo").innerHTML = cartoes.map((c) => `
      <div class="cartao-dash ${c.destaque ? "destaque" : ""}">
        <div class="rotulo-dash">${c.rotulo}</div>
        <div class="valor-dash">${c.valor}${c.extra || ""}</div>
      </div>
    `).join("");
  }

  function renderGraficoServico(porServico) {
    const container = document.getElementById("graficoServico");
    const entradas = Object.entries(porServico || {});
    if (!entradas.length || entradas.every(([, v]) => v === 0)) {
      container.innerHTML = `<div class="vazio-dash">Sem dados ainda</div>`;
      return;
    }
    const max = Math.max(...entradas.map(([, v]) => v), 1);
    container.innerHTML = entradas.map(([nome, valor]) => `
      <div class="barra-grafico-linha">
        <span class="rotulo-barra">${escapeHtml(nome)}</span>
        <div class="trilha-barra"><div class="preenchimento-barra" style="width:${(valor / max) * 100}%"></div></div>
        <span class="valor-barra">${valor}</span>
      </div>
    `).join("");
  }

  function renderGraficoPeriodo(porDia) {
    const container = document.getElementById("graficoPeriodo");
    const entradas = Object.entries(porDia || {});
    if (!entradas.length) {
      container.innerHTML = `<div class="vazio-dash">Sem dados ainda</div>`;
      return;
    }
    const max = Math.max(...entradas.map(([, v]) => v), 1);
    container.innerHTML = `
      <div class="grafico-periodo">
        ${entradas.map(([dia, valor]) => `
          <div class="coluna-periodo">
            <div class="barra-vertical" style="height:${Math.max((valor / max) * 100, 4)}%"></div>
            <span class="legenda-periodo">${dia}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderGraficoAndar(porAndar, semAndar) {
    const container = document.getElementById("graficoAndar");
    const entradas = Object.entries(porAndar || {});
    if (!entradas.length) {
      container.innerHTML = `<div class="vazio-dash">Sem dados ainda</div>`;
      return;
    }
    const max = Math.max(...entradas.map(([, v]) => v), 1);
    let html = entradas.map(([andar, valor]) => `
      <div class="barra-grafico-linha">
        <span class="rotulo-barra">${escapeHtml(andar)}</span>
        <div class="trilha-barra"><div class="preenchimento-barra" style="width:${(valor / max) * 100}%"></div></div>
        <span class="valor-barra">${valor}</span>
      </div>
    `).join("");
    if (semAndar) {
      html += `<p class="texto-suave" style="font-size:0.76rem; margin-top:8px;">+ ${semAndar} chamado(s) antigo(s) sem andar registrado.</p>`;
    }
    container.innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------
  function renderFiltrosAtivos() {
    const definicoes = [
      { chave: "q", el: filtroBusca, rotulo: (v) => `Busca: "${v}"` },
      { chave: "servico", el: filtroServico, ignorar: "todos", rotulo: () => `Serviço: ${filtroServico.selectedOptions[0].textContent}` },
      { chave: "status", el: filtroStatus, ignorar: "todos", rotulo: () => `Status: ${filtroStatus.selectedOptions[0].textContent}` },
      { chave: "andar", el: filtroAndar, rotulo: (v) => `Andar: ${v}` },
      { chave: "periodo", el: filtroPeriodo, rotulo: () => filtroPeriodo.selectedOptions[0].textContent },
    ];
    const ativos = definicoes.filter((d) => d.el.value && d.el.value !== d.ignorar);
    if (!ativos.length) { filtrosAtivosEl.innerHTML = ""; return; }
    filtrosAtivosEl.innerHTML = ativos.map((d) => `
      <span class="filtro-ativo-chip" data-chave="${d.chave}">${escapeHtml(d.rotulo(d.el.value))}<button type="button" aria-label="Remover filtro">✕</button></span>
    `).join("");
    filtrosAtivosEl.querySelectorAll(".filtro-ativo-chip button").forEach((botao) => {
      botao.addEventListener("click", () => {
        const chave = botao.parentElement.dataset.chave;
        const def = definicoes.find((d) => d.chave === chave);
        if (def) { def.el.value = def.ignorar || ""; delete filtros[chave]; }
        renderFiltrosAtivos();
        carregar();
      });
    });
  }

  filtroBusca.addEventListener("input", HRG.debounce(() => {
    filtros.q = filtroBusca.value.trim();
    renderFiltrosAtivos();
    carregar();
  }, 350));
  [["servico", filtroServico], ["status", filtroStatus], ["andar", filtroAndar], ["periodo", filtroPeriodo]].forEach(([chave, elemento]) => {
    elemento.addEventListener("change", () => {
      filtros[chave] = elemento.value;
      renderFiltrosAtivos();
      carregar();
    });
  });

  HRG.pollWhileVisible(carregar, 30000);
})();
