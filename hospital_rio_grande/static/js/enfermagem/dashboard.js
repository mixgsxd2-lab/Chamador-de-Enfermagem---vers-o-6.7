(function () {
  "use strict";

  const escapeHtml = HRG.escapeHtml;
  const formatarMinutos = HRG.formatarMinutos;

  // Mesmas cores/rótulos já usados nos selos de prioridade (ver
  // static/css/base.css e enfermagem/constants.py::PRIORIDADE_LABELS) — só 3
  // faixas: Crítico, Médio, Baixo.
  const CORES_PRIORIDADE = { critica: "#b3261e", media: "#52606d", baixa: "#1f7a53" };
  const ROTULOS_PRIORIDADE = { critica: "Crítico", media: "Médio", baixa: "Baixo" };

  const filtros = {};
  const filtroBusca = document.getElementById("filtroBusca");
  const filtroStatus = document.getElementById("filtroStatus");
  const filtroPrioridade = document.getElementById("filtroPrioridade");
  const filtroAndar = document.getElementById("filtroAndar");
  const filtroCategoria = document.getElementById("filtroCategoria");
  const filtroPeriodo = document.getElementById("filtroPeriodo");
  const filtroDataInicio = document.getElementById("filtroDataInicio");
  const filtroDataFim = document.getElementById("filtroDataFim");
  const botaoLimparFiltrosDash = document.getElementById("botaoLimparFiltrosDash");
  const filtrosAtivosEl = document.getElementById("filtrosAtivos");
  const botaoFiltrosAvancados = document.getElementById("botaoFiltrosAvancados");
  const painelFiltrosAvancados = document.getElementById("painelFiltrosAvancados");

  if (botaoFiltrosAvancados && painelFiltrosAvancados) {
    botaoFiltrosAvancados.addEventListener("click", () => {
      const abrir = painelFiltrosAvancados.hidden;
      painelFiltrosAvancados.hidden = !abrir;
      botaoFiltrosAvancados.setAttribute("aria-expanded", String(abrir));
    });
  }

  const TODOS_OS_CAMPOS = [filtroBusca, filtroStatus, filtroPrioridade, filtroAndar, filtroCategoria, filtroPeriodo, filtroDataInicio, filtroDataFim];

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
      const { dados } = await HRG.fetchJSON(`/api/enfermagem/metricas?${params.toString()}`);
      renderCartoes(dados);
      renderGraficoCategoria(dados.por_categoria);
      renderGraficoPrioridade(dados.por_prioridade);
      renderGraficoPeriodo(dados.por_dia);
    } catch (e) {
      HRG.toast("Não foi possível atualizar o dashboard.", "erro");
    }
  }

  function renderCartoes(d) {
    const cartoes = [
      { rotulo: "Total de chamados", valor: d.total, destaque: true, extra: tendenciaHtml(d.comparativo_periodo_anterior) },
      { rotulo: "Pendentes", valor: d.pendentes },
      { rotulo: "Em atendimento", valor: d.em_atendimento },
      { rotulo: "Finalizados", valor: d.finalizados },
      { rotulo: "Tempo médio de espera", valor: formatarMinutos(d.tempo_medio_espera_min) },
      { rotulo: "Tempo médio de atendimento", valor: formatarMinutos(d.tempo_medio_atendimento_min) },
      { rotulo: "Avaliação média", valor: d.total_avaliacoes ? `${d.avaliacao_media} ★` : "—" },
    ];
    document.getElementById("cartoesResumo").innerHTML = cartoes.map((c) => `
      <div class="cartao-dash ${c.destaque ? "destaque" : ""} ${c.acento ? "acento-critica" : ""}">
        <div class="rotulo-dash">${c.rotulo}</div>
        <div class="valor-dash">${c.valor}${c.extra || ""}</div>
      </div>
    `).join("");
  }

  function renderGraficoCategoria(porCategoria) {
    const container = document.getElementById("graficoCategoria");
    const entradas = Object.entries(porCategoria || {});
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

  function renderGraficoPrioridade(porPrioridade) {
    const container = document.getElementById("graficoPrioridade");
    const entradas = Object.entries(porPrioridade || {});
    const total = entradas.reduce((s, [, v]) => s + v, 0);
    if (!total) {
      container.innerHTML = `<div class="vazio-dash">Sem dados ainda</div>`;
      return;
    }
    const max = Math.max(...entradas.map(([, v]) => v), 1);
    container.innerHTML = entradas.map(([chave, valor]) => `
      <div class="barra-grafico-linha">
        <span class="rotulo-barra">${ROTULOS_PRIORIDADE[chave] || chave}</span>
        <div class="trilha-barra"><div class="preenchimento-barra" style="width:${(valor / max) * 100}%; background:${CORES_PRIORIDADE[chave] || "#8fb7e0"}"></div></div>
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

  // ---------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------
  function renderFiltrosAtivos() {
    const definicoes = [
      { chave: "q", el: filtroBusca, rotulo: (v) => `Busca: "${v}"` },
      { chave: "status", el: filtroStatus, rotulo: () => `Status: ${filtroStatus.selectedOptions[0].textContent}` },
      { chave: "prioridade", el: filtroPrioridade, rotulo: () => `Prioridade: ${filtroPrioridade.selectedOptions[0].textContent}` },
      { chave: "andar", el: filtroAndar, rotulo: (v) => `Andar: ${v}` },
      { chave: "categoria", el: filtroCategoria, rotulo: (v) => `Tipo: ${v}` },
      { chave: "periodo", el: filtroPeriodo, rotulo: () => filtroPeriodo.selectedOptions[0].textContent },
      { chave: "data_inicio", el: filtroDataInicio, rotulo: (v) => `De ${v}` },
      { chave: "data_fim", el: filtroDataFim, rotulo: (v) => `Até ${v}` },
    ];
    const ativos = definicoes.filter((d) => d.el.value);
    if (!ativos.length) { filtrosAtivosEl.innerHTML = ""; return; }
    filtrosAtivosEl.innerHTML = ativos.map((d) => `
      <span class="filtro-ativo-chip" data-chave="${d.chave}">${escapeHtml(d.rotulo(d.el.value))}<button type="button" aria-label="Remover filtro">✕</button></span>
    `).join("");
    filtrosAtivosEl.querySelectorAll(".filtro-ativo-chip button").forEach((botao) => {
      botao.addEventListener("click", () => {
        const chave = botao.parentElement.dataset.chave;
        const def = definicoes.find((d) => d.chave === chave);
        if (def) { def.el.value = ""; delete filtros[chave]; }
        renderFiltrosAtivos();
        carregar();
      });
    });
  }

  function ligarFiltro(el, chave, evento) {
    el.addEventListener(evento || "change", () => {
      filtros[chave] = el.value.trim ? el.value.trim() : el.value;
      renderFiltrosAtivos();
      carregar();
    });
  }

  filtroBusca.addEventListener("input", HRG.debounce(() => {
    filtros.q = filtroBusca.value.trim();
    renderFiltrosAtivos();
    carregar();
  }, 350));
  ligarFiltro(filtroStatus, "status");
  ligarFiltro(filtroPrioridade, "prioridade");
  ligarFiltro(filtroAndar, "andar");
  ligarFiltro(filtroCategoria, "categoria");
  ligarFiltro(filtroPeriodo, "periodo");
  ligarFiltro(filtroDataInicio, "data_inicio");
  ligarFiltro(filtroDataFim, "data_fim");

  botaoLimparFiltrosDash.addEventListener("click", () => {
    TODOS_OS_CAMPOS.forEach((el) => { el.value = ""; });
    Object.keys(filtros).forEach((chave) => delete filtros[chave]);
    renderFiltrosAtivos();
    carregar();
  });

  // `pollWhileVisible` já faz a primeira chamada imediatamente, então não é
  // preciso chamar `carregar()` de novo aqui antes de agendar o polling.
  HRG.pollWhileVisible(carregar, 30000);
})();
