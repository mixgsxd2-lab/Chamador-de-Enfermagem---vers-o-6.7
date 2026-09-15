(function () {
  "use strict";

  const escapeHtml = HRG.escapeHtml;

  const ICONES = {
    bed: '<svg class="svg-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>',
    utensils: '<svg class="svg-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
    shirt: '<svg class="svg-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/></svg>',
    wrench: '<svg class="svg-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94Z"/></svg>',
    sparkles: '<svg class="svg-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M5 5l2.5 2.5M16.5 16.5 19 19M3 12h4M17 12h4M5 19l2.5-2.5M16.5 7.5 19 5"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  const ICONE_CHECK = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  const el = {
    tela: document.getElementById("telaPaciente"),
    barra: document.getElementById("barraInferior"),
    titulo: document.getElementById("tituloTela"),
    subtitulo: document.getElementById("subtituloTela"),
    seloLeitoWrap: document.getElementById("seloLeitoWrap"),
    botaoVoltar: document.getElementById("botaoVoltar"),
    passos: document.querySelectorAll("#indicadorPassos span"),
  };

  const LS_KEY = "rg_hospital_chamado_ativo";

  const state = {
    passo: "leito", // leito | servicos | descricao | status
    andar: "",
    leito: "",
    servico: null,
    descricao: "",
    chamado: null,
  };

  let controladorPolling = null;
  let enviandoChamado = false;

  function definirPasso(passo) {
    state.passo = passo;
    const mapa = { leito: 0, servicos: 1, descricao: 2, status: 3 };
    el.passos.forEach((p, i) => p.classList.toggle("ativo", i <= mapa[passo]));
    el.botaoVoltar.style.visibility = passo === "leito" ? "hidden" : "visible";
  }

  function atualizarCabecalho(titulo, subtitulo) {
    el.titulo.textContent = titulo;
    el.subtitulo.textContent = subtitulo;
  }

  function mostrarSeloLeito(mostrar) {
    el.seloLeitoWrap.innerHTML = mostrar
      ? `<div class="selo-leito">🛏 ${escapeHtml(state.andar)} · Leito ${escapeHtml(state.leito)}</div>`
      : "";
  }

  // -------------------------------------------------------------------
  // Passo 1: Andar → Leito — mesmo seletor já usado no Chamador de
  // Enfermagem (antes era um campo de texto livre aqui, sujeito a erro de
  // digitação e sem permitir métricas de "distribuição por andar").
  // -------------------------------------------------------------------
  function renderLeito() {
    pararPolling();
    definirPasso("leito");
    mostrarSeloLeito(false);
    atualizarCabecalho("Bem-vindo", "Selecione seu leito para começar");

    el.tela.innerHTML = `
      <div class="form-leito surgir">
        <div class="campo">
          <label for="selectAndar">Andar</label>
          <select id="selectAndar">
            <option value="" disabled selected>Selecione o andar</option>
            ${Object.keys(window.ANDARES).map((a) => `<option value="${a}">${a}</option>`).join("")}
          </select>
        </div>
        <div class="campo">
          <label for="selectLeito">Leito</label>
          <select id="selectLeito" disabled>
            <option value="" disabled selected>Selecione o andar primeiro</option>
          </select>
        </div>
        <div class="aviso-lgpd">
          <span>🔒</span>
          <span>Para sua privacidade (LGPD), não solicitamos ou armazenamos seu nome. Você será identificado apenas pelo número do leito.</span>
        </div>
      </div>
    `;
    el.barra.innerHTML = `<button class="botao largo" id="botaoContinuarLeito" disabled>Continuar</button>`;

    const selectAndar = document.getElementById("selectAndar");
    const selectLeito = document.getElementById("selectLeito");
    const botao = document.getElementById("botaoContinuarLeito");

    selectAndar.addEventListener("change", () => {
      const leitos = window.ANDARES[selectAndar.value] || [];
      selectLeito.disabled = false;
      selectLeito.innerHTML = `<option value="" disabled selected>Selecione o leito</option>` +
        leitos.map((l) => `<option value="${l}">Leito ${l}</option>`).join("");
      atualizarBotao();
    });
    selectLeito.addEventListener("change", atualizarBotao);
    botao.addEventListener("click", () => {
      state.andar = selectAndar.value;
      state.leito = selectLeito.value;
      renderServicos();
    });

    function atualizarBotao() {
      botao.disabled = !(selectAndar.value && selectLeito.value);
    }
  }

  // -------------------------------------------------------------------
  // Passo 2: selecionar serviço
  // -------------------------------------------------------------------
  function renderServicos() {
    definirPasso("servicos");
    mostrarSeloLeito(true);
    atualizarCabecalho("Selecione o serviço", "Escolha o setor responsável pela sua solicitação");

    // "outros" é um serviço interno, usado apenas para receber encaminhamentos
    // automáticos do Chamador de Enfermagem — o paciente da Hotelaria nunca o
    // escolhe diretamente por aqui.
    const cartoes = Object.entries(window.SERVICOS).filter(([chave]) => chave !== "outros").map(([chave, s]) => `
      <button type="button" class="cartao-servico" data-servico="${chave}">
        <div class="icone-servico">${ICONES[s.icone] || ""}</div>
        <div class="texto-servico">
          <h3>${escapeHtml(s.nome)}</h3>
          <p>${escapeHtml(s.descricao)}</p>
        </div>
      </button>
    `).join("");

    el.tela.innerHTML = `<div class="grade-servicos surgir">${cartoes}</div>`;
    el.barra.innerHTML = "";

    el.tela.querySelectorAll(".cartao-servico").forEach((botao) => {
      botao.addEventListener("click", () => {
        state.servico = botao.dataset.servico;
        renderDescricao();
      });
    });

    el.botaoVoltar.onclick = renderLeito;
  }

  // -------------------------------------------------------------------
  // Passo 3: descrever solicitação
  // -------------------------------------------------------------------
  function renderDescricao() {
    definirPasso("descricao");
    const s = window.SERVICOS[state.servico];
    atualizarCabecalho("Descreva sua solicitação", `Serviço selecionado: ${s.nome}`);

    el.tela.innerHTML = `
      <div class="surgir">
        <span class="rotulo">O que você precisa?</span>
        <div class="campo-descricao">
          <textarea id="inputDescricao" maxlength="500" placeholder="Ex.: O ar-condicionado do quarto não está funcionando."></textarea>
        </div>
      </div>
    `;
    el.barra.innerHTML = `
      <button class="botao largo" id="botaoEnviarChamado">Enviar chamado</button>
    `;

    document.getElementById("botaoEnviarChamado").addEventListener("click", enviarChamado);
    el.botaoVoltar.onclick = renderServicos;
  }

  async function enviarChamado() {
    if (enviandoChamado) return;
    const textarea = document.getElementById("inputDescricao");
    const descricao = textarea.value.trim();
    if (!descricao) { textarea.focus(); return; }

    enviandoChamado = true;
    const botao = document.getElementById("botaoEnviarChamado");
    botao.disabled = true;
    botao.textContent = "Enviando...";

    try {
      const { dados } = await HRG.fetchJSON("/hotelaria/api/chamados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ andar: state.andar, leito: state.leito, servico: state.servico, descricao }),
      });

      state.chamado = dados;
      try { localStorage.setItem(LS_KEY, JSON.stringify({ id: dados.id, leito: state.leito })); } catch (e) {}
      renderStatus();
    } catch (err) {
      HRG.toast(err.message, "erro");
      botao.disabled = false;
      botao.textContent = "Enviar chamado";
    }
    enviandoChamado = false;
  }

  // -------------------------------------------------------------------
  // Passo 4: acompanhar status + confirmação + avaliação
  // -------------------------------------------------------------------
  async function buscarChamado(id) {
    const { dados } = await HRG.fetchJSON(`/hotelaria/api/chamados/${id}`);
    return dados;
  }

  function renderStatus() {
    definirPasso("status");
    const c = state.chamado;
    const s = window.SERVICOS[c.servico];
    atualizarCabecalho("Acompanhar chamado", `${s.nome} · Leito ${c.leito}`);
    el.barra.innerHTML = "";
    el.botaoVoltar.style.visibility = "hidden";

    const passos = [
      { chave: "pendente", rotulo: "Recebido" },
      { chave: "em_andamento", rotulo: "Em andamento" },
      { chave: "finalizado", rotulo: "Finalizado" },
    ];
    const ordemAtual = passos.findIndex((p) => p.chave === c.status);

    const trilhaHtml = passos.map((p, i) => {
      let classe = "";
      if (i < ordemAtual) classe = "concluido";
      else if (i === ordemAtual) classe = "ativo";
      const numero = i < ordemAtual ? "✓" : i + 1;
      const linha = i < passos.length - 1
        ? `<div class="linha-status ${i < ordemAtual ? "preenchida" : ""}"></div>`
        : "";
      return `
        <div class="passo-status ${classe}">
          <div class="bola">${numero}</div>
          <span class="rotulo-passo">${p.rotulo}</span>
        </div>
        ${linha}
      `;
    }).join("");

    el.tela.innerHTML = `
      <p id="avisoSemConexaoHotelaria" class="banner-status banner-status-sem_conexao" hidden style="margin-bottom:12px;">
        <span class="banner-status-icone">📶</span>
        <span>Sem conexão no momento — mostrando os últimos dados recebidos.</span>
      </p>
      <div class="cartao-status surgir">
        <span class="selo-status-grande ${c.status}">${rotuloStatus(c.status)}</span>
        <div class="trilha-status">${trilhaHtml}</div>
        <div class="resumo-chamado">
          <div><b>Serviço:</b> ${escapeHtml(s.nome)}</div>
          <div><b>Solicitação:</b> ${escapeHtml(c.descricao)}</div>
          <div><b>Aberto em:</b> ${c.criado_em}</div>
        </div>
      </div>

      <div id="areaAvaliacao"></div>
    `;

    renderAreaAvaliacao();
    iniciarPolling();
  }

  function rotuloStatus(status) {
    return { pendente: "Pendente", em_andamento: "Em andamento", finalizado: "Finalizado" }[status] || status;
  }

  // -------------------------------------------------------------------
  // Atualização em quase tempo real por polling (sem depender de nenhuma
  // biblioteca externa de WebSocket): se o status/confirmação/avaliação
  // mudou, a tela é redesenhada. Pausa quando a aba não está visível.
  // -------------------------------------------------------------------
  const detectorEstado = HRG.criarDetectorDeMudanca();

  function snapshotEstado(c) {
    return `${c.status}|${c.confirmacao_resolucao}|${c.tem_avaliacao}`;
  }

  function pararPolling() {
    if (controladorPolling) { controladorPolling.parar(); controladorPolling = null; }
  }

  function iniciarPolling() {
    pararPolling();
    detectorEstado(snapshotEstado(state.chamado));
    controladorPolling = HRG.pollWhileVisible(async () => {
      if (!state.chamado) return;
      let atualizado;
      try {
        atualizado = await buscarChamado(state.chamado.id);
      } catch (e) {
        const aviso = document.getElementById("avisoSemConexaoHotelaria");
        if (aviso) aviso.hidden = false;
        return;
      }
      const aviso = document.getElementById("avisoSemConexaoHotelaria");
      if (aviso) aviso.hidden = true;
      const mudou = detectorEstado(snapshotEstado(atualizado));
      state.chamado = atualizado;
      if (mudou) renderStatus();
    }, 4000);
  }

  // -------------------------------------------------------------------
  // Avaliação
  // -------------------------------------------------------------------
  let estrelasSelecionadas = 0;
  let enviandoAvaliacao = false;

  function renderAreaAvaliacao() {
    const area = document.getElementById("areaAvaliacao");
    const c = state.chamado;
    if (!area) return;

    if (c.status !== "finalizado") { area.innerHTML = ""; return; }

    if (c.tem_avaliacao) {
      area.innerHTML = `
        <div class="mensagem-agradecimento surgir">
          <div class="icone-check">${ICONE_CHECK}</div>
          <h3>Obrigado pela sua avaliação!</h3>
          <p style="color:var(--texto-suave);">Seu feedback ajuda a melhorar nosso atendimento.</p>
        </div>
      `;
      return;
    }

    const estrelasHtml = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} estrela${n > 1 ? "s" : ""}">★</button>`).join("");
    area.innerHTML = `
      <div class="caixa-avaliacao surgir">
        <h3 style="margin:0;">Como foi o atendimento?</h3>
        <div class="estrelas" id="estrelasAvaliacao">${estrelasHtml}</div>
        <textarea id="comentarioAvaliacao" maxlength="300" placeholder="Comentário (opcional)" aria-label="Comentário sobre o atendimento"></textarea>
        <button class="botao largo" id="botaoEnviarAvaliacao" style="margin-top:12px;">Enviar avaliação</button>
        <button class="botao secundario largo" id="botaoSairSemAvaliar" style="margin-top:8px;">Sair sem avaliar</button>
      </div>
    `;

    const botoesEstrela = area.querySelectorAll("#estrelasAvaliacao button");
    botoesEstrela.forEach((b) => {
      b.addEventListener("click", () => {
        estrelasSelecionadas = parseInt(b.dataset.n, 10);
        botoesEstrela.forEach((x) => x.classList.toggle("ativa", parseInt(x.dataset.n, 10) <= estrelasSelecionadas));
      });
    });

    document.getElementById("botaoEnviarAvaliacao").addEventListener("click", enviarAvaliacao);
    document.getElementById("botaoSairSemAvaliar").addEventListener("click", sairSemAvaliar);
  }

  // Encerra o acompanhamento sem enviar avaliação: limpa a referência local
  // ao chamado (o chamado em si continua salvo normalmente no servidor,
  // só deixa de ser retomado automaticamente neste dispositivo) e volta
  // para a tela inicial, liberando o paciente para abrir um novo chamado.
  function sairSemAvaliar() {
    pararPolling();
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    state.chamado = null;
    renderLeito();
  }

  async function enviarAvaliacao() {
    if (enviandoAvaliacao) return;
    if (estrelasSelecionadas < 1) { HRG.toast("Selecione de 1 a 5 estrelas.", "info"); return; }
    enviandoAvaliacao = true;
    const comentario = document.getElementById("comentarioAvaliacao").value.trim();
    const botao = document.getElementById("botaoEnviarAvaliacao");
    await HRG.comBotaoTravado(botao, async () => {
      try {
        await HRG.fetchJSON(`/hotelaria/api/chamados/${state.chamado.id}/avaliacao`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estrelas: estrelasSelecionadas, comentario }),
        });
        state.chamado.tem_avaliacao = true;
        renderAreaAvaliacao();
      } catch (err) {
        HRG.toast(err.message, "erro");
      }
    });
    enviandoAvaliacao = false;
  }

  // -------------------------------------------------------------------
  // Inicialização: retomar chamado ativo salvo localmente
  // -------------------------------------------------------------------
  async function iniciar() {
    let salvo = null;
    try { salvo = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch (e) {}

    if (salvo && salvo.id) {
      try {
        const chamado = await buscarChamado(salvo.id);
        if (chamado.status !== "finalizado" || !chamado.tem_avaliacao) {
          state.andar = chamado.andar || "";
          state.leito = salvo.leito;
          state.servico = chamado.servico;
          state.chamado = chamado;
          renderStatus();
          return;
        }
        localStorage.removeItem(LS_KEY);
      } catch (e) {
        try { localStorage.removeItem(LS_KEY); } catch (e2) {}
      }
    }
    renderLeito();
  }

  iniciar();
})();
