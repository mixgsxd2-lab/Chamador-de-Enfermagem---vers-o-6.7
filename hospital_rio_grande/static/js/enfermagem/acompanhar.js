(function () {
  "use strict";

  const tela = document.getElementById("telaAcompanhar");
  const chamadoId = window.CHAMADO_ID;
  const escapeHtml = HRG.escapeHtml;
  const formatarMinutos = HRG.formatarMinutos;
  let chamado = null;
  let intervaloTick = null;
  let estrelasSelecionadas = 0;
  let enviandoAvaliacao = false;
  let falhasSeguidas = 0;

  const PASSOS = [
    { chave: "recebido", rotulo: "Recebido" },
    { chave: "pendente", rotulo: "Aguardando enfermagem" },
    { chave: "em_atendimento", rotulo: "Em atendimento" },
    { chave: "finalizado", rotulo: "Finalizado" },
  ];

  // Além da trilha de progresso, um banner grande e explícito com o status
  // atual — para que "assumido/em andamento" e "finalizado" fiquem
  // impossíveis de não perceber, mesmo para quem não olhar a trilha.
  const BANNERS_STATUS = {
    pendente: { classe: "pendente", icone: "🕐", titulo: "Aguardando enfermagem", texto: "Seu chamado foi recebido e está na fila de atendimento." },
    em_atendimento: { classe: "em_atendimento", icone: "🩺", titulo: "Chamado assumido — em atendimento", texto: "Um profissional está a caminho ou já está com você." },
    finalizado: { classe: "finalizado", icone: "✅", titulo: "Atendimento finalizado", texto: "Este chamado foi concluído pela equipe de enfermagem." },
  };

  function indiceAtual(status) {
    if (status === "pendente") return 1;
    if (status === "em_atendimento") return 2;
    if (status === "finalizado") return 3;
    return 0;
  }

  async function buscar() {
    try {
      const { dados } = await HRG.fetchJSON(`/api/enfermagem/chamados/${chamadoId}`);
      falhasSeguidas = 0;
      return dados;
    } catch (err) {
      falhasSeguidas += 1;
      if (err.status === 404) {
        tela.innerHTML = `<p class="texto-carregando">Chamado não encontrado.</p>`;
      } else if (!chamado) {
        // Primeira carga já falhou por rede — não há nada anterior pra
        // manter na tela, então mostra um estado dedicado em vez de deixar
        // a tela em branco.
        tela.innerHTML = `<p class="texto-carregando">Não foi possível carregar o chamado. Verifique sua conexão.</p>`;
      } else if (falhasSeguidas >= 2) {
        // Já havia um chamado carregado: mantém a última tela conhecida na
        // tela, só avisa que a atualização está falhando (evita "piscar"
        // para um estado de erro a cada instabilidade momentânea de rede).
        mostrarAvisoSemConexao(true);
      }
      return null;
    }
  }

  function mostrarAvisoSemConexao(mostrar) {
    const aviso = document.getElementById("avisoSemConexao");
    if (aviso) aviso.hidden = !mostrar;
  }

  function trilhaHtml() {
    const atual = indiceAtual(chamado.status);
    return PASSOS.map((p, i) => {
      let classe = "";
      if (i < atual) classe = "concluido";
      else if (i === atual) classe = "ativo";
      const linha = i < PASSOS.length - 1 ? `<div class="linha-timeline ${i < atual ? "preenchida" : ""}"></div>` : "";
      return `
        <div class="passo-timeline ${classe}">
          <div class="bola-timeline">${i < atual ? "✓" : ""}</div>
          <span>${p.rotulo}</span>
        </div>
        ${linha}
      `;
    }).join("");
  }

  function render() {
    if (!chamado) return;
    const finalizado = chamado.status === "finalizado";
    const banner = BANNERS_STATUS[chamado.status] || BANNERS_STATUS.pendente;

    tela.innerHTML = `
      <div class="cabecalho-passo">
        <h1>Acompanhar chamado</h1>
        <p>Nº ${chamado.id} · Leito ${escapeHtml(chamado.leito)}</p>
      </div>

      <p id="avisoSemConexao" class="banner-status banner-status-sem_conexao" hidden>
        <span class="banner-status-icone">📶</span>
        <span>Sem conexão no momento — mostrando os últimos dados recebidos.</span>
      </p>

      <div class="banner-status banner-status-${banner.classe} surgir">
        <span class="banner-status-icone">${banner.icone}</span>
        <div>
          <strong>${banner.titulo}</strong>
          <p>${banner.texto}</p>
        </div>
      </div>

      <div class="cartao-passo surgir">
        <span class="selo-prioridade selo-${chamado.prioridade}">${chamado.prioridade_emoji} ${chamado.prioridade_label}</span>
        <div class="timeline-acompanhamento">${trilhaHtml()}</div>
        <div class="resumo-linha"><span>Solicitação</span><b>${escapeHtml(chamado.categoria)} — ${escapeHtml(chamado.subcategoria)}</b></div>
        ${chamado.detalhe ? `<div class="resumo-linha"><span>Detalhe</span><b>${escapeHtml(chamado.detalhe)}</b></div>` : ""}
        <div class="resumo-linha"><span>Aberto às</span><b>${chamado.criado_em_hora}</b></div>
        <div class="resumo-linha"><span>Tempo de espera</span><b id="tempoEspera">${formatarMinutos(chamado.tempo_espera_min)}</b></div>
      </div>

      <div id="areaAvaliacao"></div>
    `;

    renderAvaliacao();

    clearInterval(intervaloTick);
    if (!finalizado) {
      intervaloTick = setInterval(() => {
        chamado.tempo_espera_min = (chamado.tempo_espera_min || 0) + (1 / 60);
        const span = document.getElementById("tempoEspera");
        if (span) span.textContent = formatarMinutos(chamado.tempo_espera_min);
      }, 1000);
    }
  }

  function renderAvaliacao() {
    const area = document.getElementById("areaAvaliacao");
    if (!area) return;
    if (chamado.status !== "finalizado") { area.innerHTML = ""; return; }

    if (chamado.avaliacao != null) {
      area.innerHTML = `
        <div class="cartao-passo texto-centro surgir">
          <p class="texto-suave">Obrigado pela sua avaliação!</p>
          <div class="estrelas-exibicao">${"★".repeat(chamado.avaliacao)}${"☆".repeat(5 - chamado.avaliacao)}</div>
        </div>
      `;
      return;
    }

    area.innerHTML = `
      <div class="cartao-passo texto-centro surgir">
        <p><b>Como foi o atendimento?</b></p>
        <p class="texto-suave" style="margin-top:-8px;">A avaliação é sempre opcional.</p>
        <div class="estrelas-selecao" id="estrelasSelecao">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} estrela${n > 1 ? "s" : ""}">★</button>`).join("")}
        </div>
        <textarea id="comentarioAvaliacao" maxlength="300" placeholder="Comentário (opcional)" aria-label="Comentário sobre o atendimento"></textarea>
        <button class="botao botao-primario botao-bloco" id="botaoEnviarAvaliacao" style="margin-top:12px;">Enviar avaliação</button>
        <button class="botao-sair-sem-avaliar" id="botaoSairSemAvaliar" type="button">
          Sair sem avaliar
        </button>
      </div>
    `;

    const botoes = area.querySelectorAll("#estrelasSelecao button");
    botoes.forEach((b) => {
      b.addEventListener("click", () => {
        estrelasSelecionadas = parseInt(b.dataset.n, 10);
        botoes.forEach((x) => x.classList.toggle("ativa", parseInt(x.dataset.n, 10) <= estrelasSelecionadas));
      });
    });

    document.getElementById("botaoEnviarAvaliacao").addEventListener("click", enviarAvaliacao);
    document.getElementById("botaoSairSemAvaliar").addEventListener("click", sairSemAvaliar);
  }

  // "Sair sem avaliar": libera o dispositivo (remove a referência do
  // chamado ativo salva no navegador) e leva o paciente de volta à tela
  // inicial, sem tocar em nada no banco. A avaliação é OPCIONAL — nunca
  // pode bloquear o paciente de sair.
  function sairSemAvaliar() {
    try { localStorage.removeItem("rg_enfermagem_chamado_ativo"); } catch (e) {}
    clearInterval(intervaloTick);
    window.location.href = "/enfermagem/paciente";
  }

  async function enviarAvaliacao() {
    if (enviandoAvaliacao) return;
    if (estrelasSelecionadas < 1) {
      HRG.toast("Selecione de 1 a 5 estrelas, ou apenas ignore — a avaliação é opcional.", "info");
      return;
    }
    enviandoAvaliacao = true;
    const comentario = document.getElementById("comentarioAvaliacao").value.trim();
    const botao = document.getElementById("botaoEnviarAvaliacao");
    await HRG.comBotaoTravado(botao, async () => {
      try {
        const { dados } = await HRG.fetchJSON(`/api/enfermagem/chamados/${chamadoId}/avaliar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avaliacao: estrelasSelecionadas, comentario }),
        });
        chamado = dados;
        renderAvaliacao();
      } catch (err) {
        HRG.toast(err.message, "erro");
      }
    });
    enviandoAvaliacao = false;
  }

  // Atualização em quase tempo real por polling — sem depender de nenhuma
  // biblioteca externa de WebSocket. Pausa quando a aba não está visível.
  HRG.pollWhileVisible(async () => {
    const dados = await buscar();
    if (dados) {
      chamado = dados;
      mostrarAvisoSemConexao(false);
      render();
    }
  }, 5000);
})();
