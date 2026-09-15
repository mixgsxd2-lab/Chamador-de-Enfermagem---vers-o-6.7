(function () {
  "use strict";

  const ICONES = {
    urgencia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    dor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>',
    soro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69s-5.5 6.24-5.5 10.19a5.5 5.5 0 0 0 11 0C17.5 8.93 12 2.69 12 2.69Z"/></svg>',
    falar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    outros: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };
  const ICONE_CHECK = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const ICONE_ENCAMINHADO = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

  const CATEGORIAS_ORDEM = Object.keys(window.CATEGORIAS || {});
  const LS_ULTIMO_LEITO = "rg_enfermagem_ultimo_leito";
  // "Falar com Enfermagem" é a única categoria sem passo de confirmação: o
  // chamado é criado assim que o paciente escolhe a subopção — pedido
  // explícito do hospital para agilizar solicitações simples (dúvidas,
  // orientação) que não são urgentes. Todas as demais categorias passam
  // pelo passo 4 (confirmação) antes do envio.
  const CATEGORIA_ENVIO_DIRETO = "Falar com Enfermagem";
  // Mesma ideia já usada pela Hotelaria: guardamos apenas a REFERÊNCIA
  // (id + leito) do chamado ativo neste dispositivo. O conteúdo do chamado
  // em si nunca é lido daqui — sempre vem do banco de dados via API. Isso
  // existe só para que um F5 / fechar-e-reabrir o navegador não faça o
  // paciente "perder" o chamado que acabou de enviar antes de clicar em
  // "Acompanhar chamado".
  const LS_ATIVO = "rg_enfermagem_chamado_ativo";

  const el = {
    tela: document.getElementById("telaPaciente"),
    barra: document.getElementById("barraInferior"),
    botaoVoltar: document.getElementById("botaoVoltar"),
    trilha: document.querySelectorAll("#trilhaPassos span"),
  };

  const state = {
    passo: 1,
    andar: "",
    leito: "",
    categoria: "",
    subcategoria: "",
  };

  const escapeHtml = HRG.escapeHtml;

  function definirPasso(numero) {
    state.passo = numero;
    el.trilha.forEach((span) => {
      span.classList.toggle("ativo", parseInt(span.dataset.passo, 10) <= numero);
    });
    el.botaoVoltar.style.visibility = numero === 1 ? "hidden" : "visible";
  }

  // -------------------------------------------------------------------
  // Passo 1: Andar → Leito
  // -------------------------------------------------------------------
  function renderPasso1() {
    definirPasso(1);
    el.tela.innerHTML = `
      <div class="cabecalho-passo">
        <h1>Chamador de Enfermagem</h1>
        <p>Selecione seu leito para solicitar atendimento</p>
      </div>
      <div class="cartao-passo surgir">
        <div class="campo">
          <label for="selectAndar">Andar</label>
          <select id="selectAndar">
            <option value="" disabled selected>Selecione o andar</option>
            ${Object.keys(window.ANDARES).map((a) => `<option value="${a}">${a}</option>`).join("")}
          </select>
        </div>
        <div class="campo campo-ultimo">
          <label for="selectLeito">Leito</label>
          <select id="selectLeito" disabled>
            <option value="" disabled selected>Selecione o andar primeiro</option>
          </select>
        </div>
        <div class="aviso-lgpd">
          <span>🔒</span>
          <span>Para sua privacidade (LGPD), não pedimos seu nome. Você é identificado apenas pelo número do leito.</span>
        </div>
      </div>
    `;
    el.barra.innerHTML = `<button class="botao botao-primario botao-bloco" id="botaoContinuar1" disabled>Continuar</button>`;

    const selectAndar = document.getElementById("selectAndar");
    const selectLeito = document.getElementById("selectLeito");
    const botaoContinuar = document.getElementById("botaoContinuar1");

    selectAndar.addEventListener("change", () => {
      const leitos = window.ANDARES[selectAndar.value] || [];
      selectLeito.disabled = false;
      selectLeito.innerHTML = `<option value="" disabled selected>Selecione o leito</option>` +
        leitos.map((l) => `<option value="${l}">Leito ${l}</option>`).join("");
      atualizarBotao();
    });
    selectLeito.addEventListener("change", atualizarBotao);

    function atualizarBotao() {
      botaoContinuar.disabled = !(selectAndar.value && selectLeito.value);
    }

    botaoContinuar.addEventListener("click", () => {
      state.andar = selectAndar.value;
      state.leito = selectLeito.value;
      try { localStorage.setItem(LS_ULTIMO_LEITO, JSON.stringify({ andar: state.andar, leito: state.leito })); } catch (e) {}
      renderPasso2();
    });

    // Conveniência: pré-selecionar o último leito usado neste dispositivo
    // (apenas uma lembrança de digitação — o chamado em si nunca é salvo
    // no navegador, sempre vem do banco de dados).
    try {
      const salvo = JSON.parse(localStorage.getItem(LS_ULTIMO_LEITO) || "null");
      if (salvo && window.ANDARES[salvo.andar]) {
        selectAndar.value = salvo.andar;
        selectAndar.dispatchEvent(new Event("change"));
        if (window.ANDARES[salvo.andar].includes(salvo.leito)) {
          selectLeito.value = salvo.leito;
          atualizarBotao();
        }
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------------
  // Passo 2: "Como podemos ajudar?"
  // -------------------------------------------------------------------
  function renderPasso2() {
    definirPasso(2);
    const botoes = CATEGORIAS_ORDEM.map((nome) => {
      const dados = window.CATEGORIAS[nome];
      return `
        <button type="button" class="cartao-categoria cor-${dados.cor}" data-categoria="${escapeHtml(nome)}">
          <span class="icone-categoria">${ICONES[dados.icone] || ""}</span>
          <span class="texto-categoria">
            <strong>${escapeHtml(nome)}</strong>
            <small>${escapeHtml(dados.descricao)}</small>
          </span>
        </button>
      `;
    }).join("");

    el.tela.innerHTML = `
      <div class="cabecalho-passo">
        <h1>Como podemos ajudar?</h1>
        <p>Leito ${escapeHtml(state.leito)} · ${escapeHtml(state.andar)}</p>
      </div>
      <div class="grade-categorias surgir">${botoes}</div>
    `;
    el.barra.innerHTML = "";
    el.botaoVoltar.onclick = renderPasso1;

    el.tela.querySelectorAll(".cartao-categoria").forEach((botao) => {
      botao.addEventListener("click", () => {
        state.categoria = botao.dataset.categoria;
        state.subcategoria = "";
        renderPasso3();
      });
    });
  }

  // -------------------------------------------------------------------
  // Passo 3: subopções
  // -------------------------------------------------------------------
  function renderPasso3() {
    definirPasso(3);
    const dados = window.CATEGORIAS[state.categoria];
    const envioDireto = state.categoria === CATEGORIA_ENVIO_DIRETO;
    const opcoesHtml = dados.opcoes.map((texto) => `
      <button type="button" class="opcao-subcategoria" data-opcao="${escapeHtml(texto)}">
        <span>${escapeHtml(texto)}</span>
        <span class="marcador-opcao"></span>
      </button>
    `).join("");

    el.tela.innerHTML = `
      <div class="cabecalho-passo">
        <h1>${escapeHtml(state.categoria)}</h1>
        <p>${envioDireto ? "Escolha o assunto — o chamado é enviado na hora" : "Escolha a opção que melhor descreve a situação"}</p>
      </div>
      <div class="lista-subcategorias surgir">${opcoesHtml}</div>
    `;
    el.botaoVoltar.onclick = renderPasso2;

    if (envioDireto) {
      // Sem passo de confirmação: a própria escolha da subopção já cria o
      // chamado.
      el.barra.innerHTML = "";
      let enviando = false;
      el.tela.querySelectorAll(".opcao-subcategoria").forEach((botao) => {
        botao.addEventListener("click", () => {
          if (enviando) return;
          enviando = true;
          el.tela.querySelectorAll(".opcao-subcategoria").forEach((b) => { b.disabled = true; });
          botao.classList.add("selecionada");
          state.subcategoria = botao.dataset.opcao;
          enviarChamado();
        });
      });
      return;
    }

    el.barra.innerHTML = `<button class="botao botao-primario botao-bloco" id="botaoContinuar3" disabled>Continuar</button>`;
    const botaoContinuar = document.getElementById("botaoContinuar3");
    el.tela.querySelectorAll(".opcao-subcategoria").forEach((botao) => {
      botao.addEventListener("click", () => {
        el.tela.querySelectorAll(".opcao-subcategoria").forEach((b) => b.classList.remove("selecionada"));
        botao.classList.add("selecionada");
        state.subcategoria = botao.dataset.opcao;
        botaoContinuar.disabled = false;
      });
    });

    botaoContinuar.addEventListener("click", renderPasso4);
  }

  // -------------------------------------------------------------------
  // Passo 4: resumo + envio
  // -------------------------------------------------------------------
  function renderPasso4() {
    definirPasso(4);
    el.tela.innerHTML = `
      <div class="cabecalho-passo">
        <h1>Confirme seu chamado</h1>
        <p>Revise as informações antes de enviar</p>
      </div>
      <div class="cartao-passo surgir">
        <div class="resumo-linha"><span>Leito</span><b>${escapeHtml(state.leito)}</b></div>
        <div class="resumo-linha"><span>Andar</span><b>${escapeHtml(state.andar)}</b></div>
        <div class="resumo-linha"><span>Motivo</span><b>${escapeHtml(state.categoria)}</b></div>
        <div class="resumo-linha"><span>Solicitação</span><b>${escapeHtml(state.subcategoria)}</b></div>
      </div>
    `;
    el.barra.innerHTML = `<button class="botao botao-primario botao-bloco" id="botaoEnviar">Enviar chamado</button>`;
    el.botaoVoltar.onclick = renderPasso3;

    document.getElementById("botaoEnviar").addEventListener("click", enviarChamado);
  }

  // Trava contra duplo-envio mesmo que o usuário consiga clicar duas vezes
  // muito rápido (o backend também protege contra isso — ver
  // enfermagem/api.py — mas evitar a segunda requisição já no cliente
  // poupa uma viagem de rede desnecessária).
  let enviandoChamado = false;

  async function enviarChamado() {
    if (enviandoChamado) return;
    enviandoChamado = true;

    // Existe apenas no fluxo com passo de confirmação (passo 4); no envio
    // direto de "Falar com Enfermagem" (a partir do passo 3) não há botão
    // — os próprios cartões de subopção já foram desabilitados.
    const botao = document.getElementById("botaoEnviar");
    if (botao) {
      botao.disabled = true;
      botao.textContent = "Enviando...";
    }

    try {
      const { dados } = await HRG.fetchJSON("/api/enfermagem/chamados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          andar: state.andar,
          leito: state.leito,
          categoria: state.categoria,
          subcategoria: state.subcategoria,
        }),
      });

      if (dados.encaminhado_hotelaria) {
        renderEncaminhadoHotelaria(dados);
      } else {
        try { localStorage.setItem(LS_ATIVO, JSON.stringify({ id: dados.id, leito: dados.leito })); } catch (e) {}
        renderConfirmacao(dados);
      }
    } catch (err) {
      HRG.toast(err.message, "erro");
      enviandoChamado = false;
      if (botao) {
        botao.disabled = false;
        botao.textContent = "Enviar chamado";
      } else {
        // Envio direto (sem passo de confirmação): reabre o passo 3 para
        // que o paciente possa tentar novamente.
        renderPasso3();
      }
      return;
    }
    enviandoChamado = false;
  }

  // -------------------------------------------------------------------
  // Confirmação: chamado de enfermagem enviado
  // -------------------------------------------------------------------
  function renderConfirmacao(chamado) {
    definirPasso(4);
    el.botaoVoltar.style.visibility = "hidden";
    el.tela.innerHTML = `
      <div class="cartao-passo texto-centro surgir">
        <div class="icone-confirmacao icone-sucesso">${ICONE_CHECK}</div>
        <h2>Chamado enviado!</h2>
        <p class="texto-suave">A equipe de enfermagem foi notificada.</p>
        <div class="resumo-linha"><span>Nº do chamado</span><b>#${chamado.id}</b></div>
        <div class="resumo-linha"><span>Leito</span><b>${escapeHtml(chamado.leito)}</b></div>
        <div class="resumo-linha"><span>Solicitação</span><b>${escapeHtml(chamado.subcategoria)}</b></div>
      </div>
    `;
    el.barra.innerHTML = `<a class="botao botao-primario botao-bloco" href="/enfermagem/acompanhar/${chamado.id}">Acompanhar chamado</a>`;
  }

  // -------------------------------------------------------------------
  // Confirmação: encaminhado para a Central de Hotelaria
  // -------------------------------------------------------------------
  function renderEncaminhadoHotelaria(dados) {
    definirPasso(4);
    el.botaoVoltar.style.visibility = "hidden";
    el.tela.innerHTML = `
      <div class="cartao-passo texto-centro surgir">
        <div class="icone-confirmacao icone-hotelaria">${ICONE_ENCAMINHADO}</div>
        <h2>Encaminhado para a Hotelaria!</h2>
        <p class="texto-suave">Sua solicitação foi enviada para a equipe de <b>${escapeHtml(dados.servico_nome)}</b>.</p>
        <div class="resumo-linha"><span>Leito</span><b>${escapeHtml(dados.leito)}</b></div>
        <div class="resumo-linha"><span>Serviço</span><b>${escapeHtml(dados.servico_nome)}</b></div>
      </div>
    `;
    // Mesmo mecanismo de retomada já usado pela própria Hotelaria: grava
    // apenas a REFERÊNCIA do chamado (id + leito) no localStorage deste
    // dispositivo — o conteúdo do chamado em si sempre vem do banco de
    // dados. A tela /hotelaria/paciente já sabe ler essa chave e retomar
    // o acompanhamento automaticamente.
    try {
      localStorage.setItem("rg_hospital_chamado_ativo", JSON.stringify({ id: dados.hotelaria_chamado_id, leito: dados.leito }));
    } catch (e) {}

    el.barra.innerHTML = `<a class="botao botao-primario botao-bloco" href="/hotelaria/paciente">Acompanhar solicitação</a>`;
  }

  // -------------------------------------------------------------------
  // Inicialização: retomar chamado ativo (se houver) antes de começar um
  // novo. Evita que uma atualização de página (F5) ou o fechamento
  // acidental da aba antes de clicar em "Acompanhar chamado" faça o
  // paciente perder de vista um chamado que já foi enviado.
  // -------------------------------------------------------------------
  async function iniciar() {
    let salvo = null;
    try { salvo = JSON.parse(localStorage.getItem(LS_ATIVO) || "null"); } catch (e) {}

    if (salvo && salvo.id) {
      try {
        const resp = await fetch(`/api/enfermagem/chamados/${salvo.id}`);
        if (resp.ok) {
          const chamado = await resp.json();
          if (chamado.status !== "finalizado") {
            // Chamado ainda em andamento: leva o paciente direto para o
            // acompanhamento em vez de reiniciar o fluxo do zero.
            window.location.href = `/enfermagem/acompanhar/${chamado.id}`;
            return;
          }
        }
      } catch (e) {}
      // Chamado já finalizado (ou não encontrado/erro de rede): libera o
      // dispositivo para um novo chamado — a avaliação, quando aplicável,
      // já foi oferecida na própria tela de acompanhamento enquanto o
      // chamado estava ativo, e é sempre opcional.
      try { localStorage.removeItem(LS_ATIVO); } catch (e) {}
    }

    renderPasso1();
  }

  iniciar();
})();
