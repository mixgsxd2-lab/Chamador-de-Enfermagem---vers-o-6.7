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
    } catch (e) {
      listaAndares.innerHTML = `<p class="texto-carregando">Não foi possível carregar os leitos.</p>`;
    }
  }

  carregar();
})();
