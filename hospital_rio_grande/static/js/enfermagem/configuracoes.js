(function () {
  "use strict";

  const escapeHtml = HRG.escapeHtml;

  const listaAndares = document.getElementById("listaAndares");
  const buscaLeito = document.getElementById("buscaLeito");
  const totalAtivos = document.getElementById("totalAtivos");
  const totalInativos = document.getElementById("totalInativos");

  let andares = [];

  function atualizarResumo() {
    let ativos = 0;
    let inativos = 0;
    andares.forEach((a) => a.leitos.forEach((l) => (l.ativo ? ativos++ : inativos++)));
    totalAtivos.textContent = ativos;
    totalInativos.textContent = inativos;
  }

  function leitoHtml(andar, l) {
    return `
      <button type="button" class="leito-config ${l.ativo ? "ativo" : "inativo"}" data-andar="${escapeHtml(andar)}" data-leito="${escapeHtml(l.leito)}" aria-pressed="${l.ativo}">
        <span class="leito-config-numero">${escapeHtml(l.leito)}</span>
        <span class="interruptor" aria-hidden="true"><span class="interruptor-bola"></span></span>
      </button>
    `;
  }

  function render(filtro) {
    const termo = (filtro || "").trim().toLowerCase();
    const grupos = andares
      .map((a) => {
        const leitosFiltrados = termo
          ? a.leitos.filter((l) => l.leito.toLowerCase().includes(termo) || a.andar_label.toLowerCase().includes(termo))
          : a.leitos;
        return { ...a, leitosFiltrados };
      })
      .filter((a) => a.leitosFiltrados.length);

    if (!grupos.length) {
      listaAndares.innerHTML = `<p class="texto-carregando">Nenhum leito encontrado.</p>`;
      return;
    }

    listaAndares.innerHTML = grupos.map((a) => `
      <div class="grupo-andar-config">
        <h3>${escapeHtml(a.andar_label)}</h3>
        <div class="grade-leitos-config">
          ${a.leitosFiltrados.map((l) => leitoHtml(a.andar, l)).join("")}
        </div>
      </div>
    `).join("");
  }

  async function alternar(botao) {
    const andar = botao.dataset.andar;
    const leito = botao.dataset.leito;
    const ativoAtual = botao.classList.contains("ativo");
    const novoAtivo = !ativoAtual;

    botao.disabled = true;
    try {
      await HRG.fetchJSON("/api/enfermagem/leitos/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ andar, leito, ativo: novoAtivo }),
      });
      const grupo = andares.find((a) => a.andar === andar);
      const item = grupo && grupo.leitos.find((l) => l.leito === leito);
      if (item) item.ativo = novoAtivo;
      botao.classList.toggle("ativo", novoAtivo);
      botao.classList.toggle("inativo", !novoAtivo);
      botao.setAttribute("aria-pressed", String(novoAtivo));
      atualizarResumo();
    } catch (e) {
      alert(e.message || "Não foi possível atualizar o leito.");
    } finally {
      botao.disabled = false;
    }
  }

  listaAndares.addEventListener("click", (ev) => {
    const botao = ev.target.closest(".leito-config");
    if (botao) alternar(botao);
  });

  buscaLeito.addEventListener("input", () => render(buscaLeito.value));

  async function carregar() {
    try {
      const { dados } = await HRG.fetchJSON("/api/enfermagem/leitos");
      andares = dados.andares;
      atualizarResumo();
      render(buscaLeito.value);
      popularSelectAndarQrcode();
    } catch (e) {
      listaAndares.innerHTML = `<p class="texto-carregando">Não foi possível carregar os leitos.</p>`;
    }
  }

  carregar();

  // ---------------------------------------------------------------------
  // Acesso do Paciente (QR Code) — copiar link + revogar todos os acessos
  // ---------------------------------------------------------------------
  const imagemQrcode = document.getElementById("imagemQrcode");
  const linkAcessoPaciente = document.getElementById("linkAcessoPaciente");
  const botaoCopiarLink = document.getElementById("botaoCopiarLink");
  const botaoRevogarAcesso = document.getElementById("botaoRevogarAcesso");
  const fundoModalRevogar = document.getElementById("fundoModalRevogar");
  const botaoFecharModalRevogar = document.getElementById("botaoFecharModalRevogar");
  const botaoCancelarRevogar = document.getElementById("botaoCancelarRevogar");
  const botaoConfirmarRevogar = document.getElementById("botaoConfirmarRevogar");

  function abrirModalRevogar() {
    fundoModalRevogar.classList.add("aberto");
  }
  function fecharModalRevogar() {
    fundoModalRevogar.classList.remove("aberto");
  }

  botaoRevogarAcesso.addEventListener("click", abrirModalRevogar);
  botaoFecharModalRevogar.addEventListener("click", fecharModalRevogar);
  botaoCancelarRevogar.addEventListener("click", fecharModalRevogar);
  fundoModalRevogar.addEventListener("click", (ev) => {
    if (ev.target === fundoModalRevogar) fecharModalRevogar();
  });
  HRG.fecharComEsc(() => fundoModalRevogar.classList.contains("aberto"), fecharModalRevogar);

  botaoCopiarLink.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(linkAcessoPaciente.value);
      HRG.toast("Link copiado.", "sucesso");
    } catch (e) {
      linkAcessoPaciente.select();
      HRG.toast("Selecione e copie o link manualmente.", "info");
    }
  });

  botaoConfirmarRevogar.addEventListener("click", () =>
    HRG.comBotaoTravado(botaoConfirmarRevogar, async () => {
      try {
        const { dados } = await HRG.fetchJSON("/api/enfermagem/acesso/revogar", { method: "POST" });
        linkAcessoPaciente.value = dados.url;
        // Cache-busting: mesma URL de sempre, mas o token mudou — sem o
        // parâmetro extra o navegador poderia reaproveitar o QR antigo do
        // cache em vez de buscar o novo.
        imagemQrcode.src = `${imagemQrcode.src.split("?")[0]}?t=${Date.now()}`;
        fecharModalRevogar();
        HRG.toast("Acesso revogado. Novo QR Code gerado — imprima e afixe nos leitos.", "sucesso");
        // O QR Code por leito (se algum estiver selecionado) usava o token
        // antigo — atualiza junto para não deixar a equipe imprimir um QR
        // já revogado sem perceber.
        atualizarQrcodeLeitoSelecionado();
      } catch (e) {
        HRG.toast(e.message || "Não foi possível revogar o acesso.", "erro");
      }
    })
  );

  // ---------------------------------------------------------------------
  // Gerador de QR Code por Leito
  // ---------------------------------------------------------------------
  const selectAndarQrcode = document.getElementById("selectAndarQrcode");
  const selectLeitoQrcode = document.getElementById("selectLeitoQrcode");
  const blocoQrcodeLeito = document.getElementById("blocoQrcodeLeito");
  const avisoSemLeitoQrcode = document.getElementById("avisoSemLeitoQrcode");
  const imagemQrcodeLeito = document.getElementById("imagemQrcodeLeito");
  const linkQrcodeLeito = document.getElementById("linkQrcodeLeito");
  const botaoCopiarLinkLeito = document.getElementById("botaoCopiarLinkLeito");
  const botaoBaixarQrcodeLeito = document.getElementById("botaoBaixarQrcodeLeito");

  function popularSelectAndarQrcode() {
    selectAndarQrcode.innerHTML = `<option value="" selected>Selecione o andar</option>` +
      andares.map((a) => `<option value="${escapeHtml(a.andar)}">${escapeHtml(a.andar_label)}</option>`).join("");
  }

  function popularSelectLeitoQrcode(nomeAndar) {
    const grupo = andares.find((a) => a.andar === nomeAndar);
    // Só leitos ATIVOS entram aqui: um leito desativado não recebe chamados
    // mesmo que o paciente escaneie o QR Code (ver enfermagem/leitos.py),
    // então gerar um QR Code pra ele só confundiria a equipe.
    const leitosAtivos = grupo ? grupo.leitos.filter((l) => l.ativo) : [];
    selectLeitoQrcode.disabled = leitosAtivos.length === 0;
    selectLeitoQrcode.innerHTML = leitosAtivos.length
      ? `<option value="" selected>Selecione o leito</option>` +
        leitosAtivos.map((l) => `<option value="${escapeHtml(l.leito)}">Leito ${escapeHtml(l.leito)}</option>`).join("")
      : `<option value="" selected>Nenhum leito ativo neste andar</option>`;
  }

  async function atualizarQrcodeLeitoSelecionado() {
    const andar = selectAndarQrcode.value;
    const leito = selectLeitoQrcode.value;
    if (!andar || !leito) {
      blocoQrcodeLeito.hidden = true;
      avisoSemLeitoQrcode.hidden = false;
      return;
    }

    const parametros = `andar=${encodeURIComponent(andar)}&leito=${encodeURIComponent(leito)}`;
    try {
      const { dados } = await HRG.fetchJSON(`/api/enfermagem/acesso?${parametros}`);
      linkQrcodeLeito.value = dados.url;
      imagemQrcodeLeito.src = `/enfermagem/configuracoes/qrcode.svg?${parametros}&t=${Date.now()}`;
      botaoBaixarQrcodeLeito.href = imagemQrcodeLeito.src;
      botaoBaixarQrcodeLeito.download = `qrcode-leito-${leito.replace(/\s+/g, "_")}.svg`;
      avisoSemLeitoQrcode.hidden = true;
      blocoQrcodeLeito.hidden = false;
    } catch (e) {
      HRG.toast(e.message || "Não foi possível gerar o QR Code deste leito.", "erro");
    }
  }

  selectAndarQrcode.addEventListener("change", () => {
    popularSelectLeitoQrcode(selectAndarQrcode.value);
    atualizarQrcodeLeitoSelecionado();
  });
  selectLeitoQrcode.addEventListener("change", atualizarQrcodeLeitoSelecionado);

  botaoCopiarLinkLeito.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(linkQrcodeLeito.value);
      HRG.toast("Link copiado.", "sucesso");
    } catch (e) {
      linkQrcodeLeito.select();
      HRG.toast("Selecione e copie o link manualmente.", "info");
    }
  });
})();
