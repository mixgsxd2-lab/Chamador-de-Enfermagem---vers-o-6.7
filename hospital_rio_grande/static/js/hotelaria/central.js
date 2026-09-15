(function () {
  "use strict";

  const escapeHtml = HRG.escapeHtml;

  const colunas = {
    pendente: document.getElementById("colunaPendente"),
    em_andamento: document.getElementById("colunaAndamento"),
    finalizado: document.getElementById("colunaFinalizado"),
  };
  const contagens = {
    pendente: document.getElementById("contagemPendente"),
    em_andamento: document.getElementById("contagemAndamento"),
    finalizado: document.getElementById("contagemFinalizado"),
  };
  const contagensAba = {
    pendente: document.getElementById("contagemAbaPendente"),
    em_andamento: document.getElementById("contagemAbaAndamento"),
    finalizado: document.getElementById("contagemAbaFinalizado"),
  };
  const filtroBusca = document.getElementById("filtroBusca");
  const filtroServico = document.getElementById("filtroServico");
  const filtroAndar = document.getElementById("filtroAndar");
  const filtrosAtivosEl = document.getElementById("filtrosAtivos");
  const abasMobile = document.getElementById("abasMobile");
  const fundoModal = document.getElementById("fundoModal");
  const modalChamado = document.getElementById("modalChamado");

  const filtros = {};
  let chamadoAbertoId = null;
  let controladorPollingModal = null;
  let ultimoSnapshotModal = null;
  const detectorLista = HRG.criarDetectorDeMudanca();
  // Detecta chegada de chamados novos (toca o alerta sonoro) — nunca de
  // novo para o mesmo chamado, mesmo que ele continue aparecendo em polls
  // seguintes (ver static/js/common.js).
  const detectorNovosChamados = HRG.criarDetectorDeNovosChamados();

  const ICONE_FECHAR = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  async function carregarChamados() {
    const params = new URLSearchParams({ servico: filtroServico.value });
    if (filtroAndar.value) params.set("andar", filtroAndar.value);
    if (filtroBusca.value.trim()) params.set("q", filtroBusca.value.trim());

    let chamados;
    try {
      const { dados } = await HRG.fetchJSON(`/hotelaria/api/central/chamados?${params.toString()}`);
      chamados = dados;
    } catch (e) {
      return; // mantém a última visão conhecida na tela em caso de instabilidade de rede
    }

    const novos = detectorNovosChamados(chamados);
    if (novos.length) HRG.tocarAlertaNovoChamado();

    if (!detectorLista(chamados)) return;
    renderColunas(chamados);
  }

  function renderColunas(chamados) {
    const grupos = { pendente: [], em_andamento: [], finalizado: [] };
    chamados.forEach((c) => grupos[c.status] && grupos[c.status].push(c));

    Object.entries(grupos).forEach(([status, lista]) => {
      contagens[status].textContent = lista.length;
      if (contagensAba[status]) contagensAba[status].textContent = lista.length;
      colunas[status].innerHTML = lista.length
        ? lista.map(cartaoChamadoHtml).join("")
        : `<div class="vazio-coluna">Nenhum chamado</div>`;
    });

    document.querySelectorAll(".cartao-chamado").forEach((elCard) => {
      elCard.addEventListener("click", () => abrirModal(parseInt(elCard.dataset.id, 10)));
    });
  }

  function indicadoresHtml(c) {
    const pontos = [];
    if (c.nao_lida) pontos.push('<span class="ponto-indicador laranja" title="Nova mensagem"></span>');
    if (c.nao_resolvido) pontos.push('<span class="ponto-indicador vermelho" title="Atendimento não resolvido"></span>');
    return pontos.length ? `<span class="indicadores-cartao">${pontos.join("")}</span>` : "";
  }

  function localHtml(c) {
    return `
      <div class="local-cartao">
        ${c.andar ? `<span class="local-andar">${escapeHtml(c.andar)}</span>` : ""}
        <span class="local-leito">Leito ${escapeHtml(c.leito)}</span>
      </div>
    `;
  }

  function cartaoChamadoHtml(c) {
    return `
      <button type="button" class="cartao-chamado ${c.status} surgir" data-id="${c.id}">
        <div class="linha-cartao-topo">
          ${localHtml(c)}
          <span class="servico-etiqueta">${escapeHtml(c.servico_nome)}</span>
        </div>
        <p class="descricao-cartao">${escapeHtml(c.descricao_exibicao || c.descricao)}</p>
        <div class="rodape-cartao">
          ${indicadoresHtml(c)}
          <span>Aberto às ${c.criado_em}</span>
        </div>
      </button>
    `;
  }

  // ---------------------------------------------------------------------
  // Abas mobile (Kanban vira abas em telas estreitas — ver hotelaria.css)
  // ---------------------------------------------------------------------
  abasMobile.querySelectorAll("button").forEach((botaoAba) => {
    botaoAba.addEventListener("click", () => {
      abasMobile.querySelectorAll("button").forEach((b) => b.classList.remove("ativo"));
      botaoAba.classList.add("ativo");
      document.querySelectorAll(".coluna-central").forEach((col) => {
        col.classList.toggle("aba-ativa", col.dataset.coluna === botaoAba.dataset.aba);
      });
    });
  });

  // ---------------------------------------------------------------------
  // Filtros ativos (busca/andar) — servico já tem seu próprio select visível.
  // ---------------------------------------------------------------------
  function renderFiltrosAtivos() {
    const ativos = [];
    if (filtroBusca.value.trim()) ativos.push({ chave: "busca", texto: `Busca: "${filtroBusca.value.trim()}"` });
    if (filtroAndar.value) ativos.push({ chave: "andar", texto: `Andar: ${filtroAndar.value}` });

    if (!ativos.length) { filtrosAtivosEl.innerHTML = ""; return; }
    filtrosAtivosEl.innerHTML = ativos.map((a) => `
      <span class="filtro-ativo-chip" data-chave="${a.chave}">${escapeHtml(a.texto)}<button type="button" aria-label="Remover filtro">✕</button></span>
    `).join("");
    filtrosAtivosEl.querySelectorAll(".filtro-ativo-chip button").forEach((botao) => {
      botao.addEventListener("click", () => {
        const chave = botao.parentElement.dataset.chave;
        if (chave === "busca") filtroBusca.value = "";
        if (chave === "andar") filtroAndar.value = "";
        renderFiltrosAtivos();
        carregarChamados();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Modal do chamado
  // ---------------------------------------------------------------------
  async function abrirModal(id) {
    chamadoAbertoId = id;
    fundoModal.classList.add("aberto");
    modalChamado.innerHTML = `<p style="text-align:center; padding:40px;">Carregando...</p>`;
    ultimoSnapshotModal = null;

    await renderModal();
    iniciarPollingModal();
  }

  async function renderModal() {
    if (!chamadoAbertoId) return;
    let c;
    try {
      const { dados } = await HRG.fetchJSON(`/hotelaria/api/chamados/${chamadoAbertoId}`);
      c = dados;
    } catch (e) {
      modalChamado.innerHTML = `<p style="text-align:center; padding:40px;">Não foi possível carregar este chamado.</p>`;
      return;
    }
    ultimoSnapshotModal = `${c.status}|${c.confirmacao_resolucao}|${c.tem_avaliacao}`;

    const confirmacaoTexto = {
      pendente: "Aguardando confirmação do paciente",
      resolvido: "✅ Paciente confirmou: problema resolvido",
      nao_resolvido: "⚠️ Paciente informou: problema não resolvido",
      expirada: "⏱ Prazo de confirmação expirado sem resposta",
      nao_aplicavel: "—",
    }[c.confirmacao_resolucao] || "—";

    const avaliacaoHtml = c.avaliacao
      ? `<div class="avaliacao-exibicao">${"★".repeat(c.avaliacao.estrelas)}${"☆".repeat(5 - c.avaliacao.estrelas)} <span style="color:var(--texto-suave); font-weight:500;">(${c.avaliacao.estrelas}/5)</span></div>
         ${c.avaliacao.comentario ? `<p style="font-size:0.85rem; color:var(--texto-suave); margin-top:6px;">"${escapeHtml(c.avaliacao.comentario)}"</p>` : ""}`
      : `<span style="color:var(--texto-suave); font-size:0.85rem;">Ainda não avaliado</span>`;

    const acoes = [];
    if (c.status === "pendente") {
      acoes.push(`<button class="botao" id="botaoAssumir">Assumir chamado</button>`);
    }
    if (c.status === "em_andamento") {
      acoes.push(`<button class="botao sucesso" id="botaoFinalizar">Finalizar atendimento</button>`);
    }

    modalChamado.innerHTML = `
      <div class="modal-topo">
        <div>
          <h2 style="margin:0 0 4px;">Leito ${escapeHtml(c.leito)}</h2>
          <span class="servico-etiqueta">${escapeHtml(c.servico_nome)}</span>
        </div>
        <button class="fechar-modal" id="botaoFecharModal" aria-label="Fechar">${ICONE_FECHAR}</button>
      </div>

      <div class="bloco-info-modal">
        <div><b>Local:</b> ${c.andar ? escapeHtml(c.andar) + " · " : ""}Leito ${escapeHtml(c.leito)}</div>
        <div><b>Status:</b> ${rotuloStatus(c.status)}</div>
        <div><b>Descrição:</b> ${escapeHtml(c.descricao_exibicao || c.descricao)}</div>
        <div><b>Aberto em:</b> ${c.criado_em}</div>
        ${c.iniciado_em ? `<div><b>Assumido em:</b> ${c.iniciado_em}</div>` : ""}
        ${c.finalizado_em ? `<div><b>Finalizado em:</b> ${c.finalizado_em}</div>` : ""}
        ${c.status === "finalizado" ? `<div><b>Confirmação:</b> ${confirmacaoTexto}</div>` : ""}
      </div>

      <div class="linha-acoes-modal">${acoes.join("")}</div>

      <div class="bloco-info-modal" style="margin-top:14px;">
        <b>Avaliação do paciente</b><br>
        ${avaliacaoHtml}
      </div>
    `;

    document.getElementById("botaoFecharModal").addEventListener("click", fecharModal);
    const btnAssumir = document.getElementById("botaoAssumir");
    if (btnAssumir) btnAssumir.addEventListener("click", () => HRG.comBotaoTravado(btnAssumir, () => alterarStatus(c.id, "em_andamento", true)));
    const btnFinalizar = document.getElementById("botaoFinalizar");
    if (btnFinalizar) btnFinalizar.addEventListener("click", () => HRG.comBotaoTravado(btnFinalizar, () => alterarStatus(c.id, "finalizado")));
  }

  function rotuloStatus(status) {
    return { pendente: "Pendente", em_andamento: "Em andamento", finalizado: "Finalizado" }[status] || status;
  }

  function fecharModal() {
    fundoModal.classList.remove("aberto");
    chamadoAbertoId = null;
    pararPollingModal();
  }

  async function alterarStatus(id, novoStatus, assumir) {
    const endpoint = assumir ? `/hotelaria/api/central/chamados/${id}/assumir` : `/hotelaria/api/central/chamados/${id}/status`;
    const opcoes = { method: "POST", headers: { "Content-Type": "application/json" } };
    if (!assumir) opcoes.body = JSON.stringify({ status: novoStatus });
    try {
      await HRG.fetchJSON(endpoint, opcoes);
      await renderModal();
      await carregarChamados();
    } catch (err) {
      HRG.toast(err.message, "erro");
    }
  }

  // ---------------------------------------------------------------------
  // Polling do modal aberto: se o status/confirmação/avaliação mudou (ex.:
  // o paciente avaliou, ou a confirmação expirou), o modal é atualizado.
  // ---------------------------------------------------------------------
  function iniciarPollingModal() {
    pararPollingModal();
    controladorPollingModal = HRG.pollWhileVisible(async () => {
      if (!chamadoAbertoId) return;
      let c;
      try {
        const { dados } = await HRG.fetchJSON(`/hotelaria/api/chamados/${chamadoAbertoId}`);
        c = dados;
      } catch (e) {
        return;
      }
      const snapshot = `${c.status}|${c.confirmacao_resolucao}|${c.tem_avaliacao}`;
      if (snapshot !== ultimoSnapshotModal) {
        await renderModal();
      }
    }, 4000);
  }

  function pararPollingModal() {
    if (controladorPollingModal) { controladorPollingModal.parar(); controladorPollingModal = null; }
  }

  filtroServico.addEventListener("change", carregarChamados);
  filtroAndar.addEventListener("change", () => { renderFiltrosAtivos(); carregarChamados(); });
  filtroBusca.addEventListener("input", HRG.debounce(() => { renderFiltrosAtivos(); carregarChamados(); }, 350));
  fundoModal.addEventListener("click", (e) => { if (e.target === fundoModal) fecharModal(); });
  HRG.fecharComEsc(() => fundoModal.classList.contains("aberto"), fecharModal);

  HRG.pollWhileVisible(carregarChamados, 5000);
})();
