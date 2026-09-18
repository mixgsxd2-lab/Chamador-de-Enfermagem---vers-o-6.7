/* ==========================================================================
   Dashboard Executivo — Enfermagem + Hotelaria.

   Consome GET /api/enfermagem/painel-executivo (payload já agregado pelo
   backend, ver enfermagem/painel.py) e desenha tudo com HTML/SVG puro — sem
   biblioteca de gráficos (a Content-Security-Policy do app só permite
   scripts do próprio servidor, e o projeto não tem etapa de build).
   Atualiza sozinho a cada 30 s (pausa com a aba oculta) e os cronômetros dos
   alertas avançam a cada segundo entre uma atualização e outra.
   ========================================================================== */
(function () {
  "use strict";

  const esc = HRG.escapeHtml;
  const fmtMin = HRG.formatarMinutos;
  const $ = (id) => document.getElementById(id);

  const COR = {
    enf: "#5c8fc4", hot: "#7c3aed", critica: "#b3261e", media: "#8a97a6", baixa: "#1f7a53",
    pendente: "#d49a1f", atendimento: "#5c8fc4", finalizado: "#1f7a53", hotelaria: "#7c3aed",
  };
  const ROTULO_PERIODO = { hoje: "Hoje", "7dias": "Últimos 7 dias", "30dias": "Últimos 30 dias", "": "Todo o histórico" };
  const ROTULO_PRIORIDADE = { critica: "Crítico", media: "Médio", baixa: "Baixo", hotelaria: "Hotelaria" };
  const ICONE_CATEGORIA = { "Urgência": "🚨", "Dor": "🤕", "Soro": "💧", "Falar com Enfermagem": "💬" };
  const COR_CATEGORIA = { "Urgência": "#b3261e", "Dor": "#e07a3f", "Soro": "#5c8fc4", "Falar com Enfermagem": "#1f7a53" };
  const COR_SERVICO = { hotelaria: "#7c3aed", nutricao: "#e07a3f", lavanderia: "#3f9dc9", manutencao: "#52606d", higienizacao: "#1f9a73" };

  const PREF_CHAVE = "rg_dashboard_executivo_pref";
  const estado = { periodo: "7dias", andar: "", modulo: "todos", calor: "ambos", dados: null, recebidoEm: 0 };
  try {
    const salvo = JSON.parse(localStorage.getItem(PREF_CHAVE) || "{}");
    ["periodo", "andar", "modulo", "calor"].forEach((k) => { if (typeof salvo[k] === "string") estado[k] = salvo[k]; });
  } catch (e) { /* armazenamento indisponível: usa os padrões */ }

  function salvarPreferencias() {
    try {
      localStorage.setItem(PREF_CHAVE, JSON.stringify({
        periodo: estado.periodo, andar: estado.andar, modulo: estado.modulo, calor: estado.calor,
      }));
    } catch (e) { /* ignora */ }
  }

  // -------------------------------------------------------------------
  // Formatação
  // -------------------------------------------------------------------
  const nf = new Intl.NumberFormat("pt-BR");
  const num = (v) => (v == null ? "—" : nf.format(v));
  const dec = (v, casas) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
  const pct = (v) => (v == null ? "—" : `${dec(v, 1)}%`);
  const minCurto = (v) => {
    if (v == null) return "—";
    const t = Math.round(v);
    if (t < 60) return `${t} min`;
    return `${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}`;
  };
  const plural = (n, s, p) => `${num(n)} ${n === 1 ? s : p}`;

  function classeSla(v) {
    if (v == null) return "neutro";
    if (v >= 90) return "bom";
    if (v >= 75) return "medio";
    return "ruim";
  }
  function classeNota(v) {
    if (v == null) return "neutro";
    if (v >= 4.3) return "bom";
    if (v >= 3.6) return "medio";
    return "ruim";
  }

  // -------------------------------------------------------------------
  // Tooltip único (qualquer elemento com data-tt)
  // -------------------------------------------------------------------
  const tooltip = $("exTooltip");
  let alvoTooltip = null;
  function posicionarTooltip(x, y) {
    const r = tooltip.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }
  function mostrarTooltip(el, x, y) {
    const texto = el.getAttribute("data-tt");
    if (!texto) return;
    alvoTooltip = el;
    tooltip.textContent = texto;
    tooltip.hidden = false;
    posicionarTooltip(x, y);
  }
  function esconderTooltip() { tooltip.hidden = true; alvoTooltip = null; }
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest("[data-tt]");
    if (el) mostrarTooltip(el, e.clientX, e.clientY);
    else if (alvoTooltip) esconderTooltip();
  });
  document.addEventListener("mousemove", (e) => { if (alvoTooltip) posicionarTooltip(e.clientX, e.clientY); });
  // Toque (mobile): tocar mostra, tocar fora esconde.
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-tt]");
    if (el && el.tagName !== "A" && !el.closest("button.ex-botao-icone")) {
      const r = el.getBoundingClientRect();
      mostrarTooltip(el, r.left + r.width / 2, r.bottom);
    } else if (!el) esconderTooltip();
  });
  window.addEventListener("scroll", esconderTooltip, { passive: true });

  const tt = (texto) => `data-tt="${esc(texto)}"`;

  // -------------------------------------------------------------------
  // Mini-componentes SVG
  // -------------------------------------------------------------------
  function sparkline(valores, cor) {
    const w = 110, h = 38, p = 3;
    const pontos = valores.map((v, i) => ({ v, i })).filter((p2) => p2.v != null);
    if (pontos.length < 2) return `<svg class="ex-kpi-spark" viewBox="0 0 ${w} ${h}"></svg>`;
    const vs = pontos.map((q) => q.v);
    const min = Math.min(...vs), max = Math.max(...vs);
    const faixa = max - min || 1;
    const x = (i) => p + (i / (valores.length - 1)) * (w - p * 2);
    const y = (v) => h - p - ((v - min) / faixa) * (h - p * 2);
    const linha = pontos.map((q, k) => `${k ? "L" : "M"}${x(q.i).toFixed(1)},${y(q.v).toFixed(1)}`).join(" ");
    const area = `${linha} L${x(pontos[pontos.length - 1].i).toFixed(1)},${h} L${x(pontos[0].i).toFixed(1)},${h} Z`;
    const ult = pontos[pontos.length - 1];
    const id = `g${Math.random().toString(36).slice(2, 8)}`;
    return `<svg class="ex-kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${cor}" stop-opacity=".28"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${linha}" fill="none" stroke="${cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${x(ult.i).toFixed(1)}" cy="${y(ult.v).toFixed(1)}" r="2.6" fill="${cor}"/>
    </svg>`;
  }

  function donut(segmentos, tamanho, espessura, centroValor, centroRotulo) {
    const total = segmentos.reduce((s, x) => s + x.valor, 0);
    const r = (tamanho - espessura) / 2;
    const c = tamanho / 2;
    const circ = 2 * Math.PI * r;
    let acumulado = 0;
    const arcos = total ? segmentos.filter((s) => s.valor > 0).map((s) => {
      const frac = s.valor / total;
      const tam = Math.max(frac * circ - (segmentos.length > 1 ? 2 : 0), 0.5);
      const arco = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.cor}" stroke-width="${espessura}"
        stroke-dasharray="${tam.toFixed(2)} ${(circ - tam).toFixed(2)}" stroke-dashoffset="${(-acumulado * circ).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})" ${tt(`${s.rotulo}: ${num(s.valor)} (${dec(frac * 100, 1)}%)`)} style="cursor:pointer"/>`;
      acumulado += frac;
      return arco;
    }).join("") : "";
    return `<svg viewBox="0 0 ${tamanho} ${tamanho}" role="img" aria-label="${esc(centroRotulo)}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#eef1f6" stroke-width="${espessura}"/>
      ${arcos}
      <text x="${c}" y="${c + 2}" text-anchor="middle" class="ex-donut-centro-valor">${esc(centroValor)}</text>
      <text x="${c}" y="${c + 17}" text-anchor="middle" class="ex-donut-centro-rotulo">${esc(centroRotulo)}</text>
    </svg>`;
  }

  function medidor(valor, cor) {
    // Semicírculo de 0 a 100%.
    const w = 96, h = 58, r = 40, cx = 48, cy = 50, esp = 10;
    const frac = valor == null ? 0 : Math.max(0, Math.min(valor, 100)) / 100;
    const arco = (f) => {
      const ang = Math.PI * (1 - f);
      return `${(cx + r * Math.cos(ang)).toFixed(2)},${(cy - r * Math.sin(ang)).toFixed(2)}`;
    };
    return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" fill="none" stroke="#eef1f6" stroke-width="${esp}" stroke-linecap="round"/>
      ${frac > 0 ? `<path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${arco(frac)}" fill="none" stroke="${cor}" stroke-width="${esp}" stroke-linecap="round"/>` : ""}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="ex-sla-pct">${valor == null ? "—" : `${Math.round(valor)}%`}</text>
    </svg>`;
  }

  function escalaY(max) {
    if (max <= 0) return { max: 4, passo: 1 };
    const bruto = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) || bruto;
    return { max: Math.ceil(max / passo) * passo, passo };
  }

  // -------------------------------------------------------------------
  // Seções
  // -------------------------------------------------------------------
  function renderAgora(d) {
    const a = d.agora;
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    const ativos = (mostraEnf ? a.pendentes_enf + a.em_atendimento_enf : 0) + (mostraHot ? a.pendentes_hot + a.andamento_hot : 0);
    const foraMeta = (mostraEnf ? a.fora_sla_enf : 0) + (mostraHot ? a.fora_meta_hot : 0);
    const aguardando = (mostraEnf ? a.pendentes_enf : 0) + (mostraHot ? a.pendentes_hot : 0);
    const emAtend = (mostraEnf ? a.em_atendimento_enf : 0) + (mostraHot ? a.andamento_hot : 0);
    const ocup = a.total_leitos ? Math.round((a.leitos_com_chamado / a.total_leitos) * 100) : 0;
    const maior = Math.max(mostraEnf ? a.maior_espera_enf || 0 : 0, mostraHot ? a.maior_espera_hot || 0 : 0);

    const itens = [
      { rotulo: "Chamados ativos", valor: num(ativos), sub: `${mostraEnf ? `<span>Enf. <b>${a.pendentes_enf + a.em_atendimento_enf}</b></span>` : ""}${mostraHot ? `<span>Hot. <b>${a.pendentes_hot + a.andamento_hot}</b></span>` : ""}` },
      { rotulo: "Críticos agora", valor: num(mostraEnf ? a.criticos_ativos : 0), classe: `alerta ${mostraEnf && a.criticos_ativos ? "ativo" : ""}`, sub: "Urgência e dor no peito" },
      { rotulo: "Acima do tempo", valor: num(foraMeta), classe: `alerta ${foraMeta ? "ativo" : ""}`, sub: `${mostraEnf ? `<span>Enf. <b>${a.fora_sla_enf}</b></span>` : ""}${mostraHot ? `<span>Hot. <b>${a.fora_meta_hot}</b></span>` : ""}` },
      { rotulo: "Aguardando", valor: num(aguardando), sub: `<span>Em atendimento <b>${emAtend}</b></span>` },
      { rotulo: "Maior espera atual", valor: maior ? minCurto(maior) : "—", sub: "Chamado pendente mais antigo" },
      { rotulo: "Leitos com chamado", valor: `${a.leitos_com_chamado}<small>/ ${a.total_leitos}</small>`, sub: `<span>${ocup}% dos leitos</span>`, barra: ocup },
    ];
    $("exAgora").innerHTML = itens.map((i) => `
      <div class="ex-agora-item ${i.classe || ""}">
        <div class="ex-agora-rotulo">${i.rotulo}</div>
        <div class="ex-agora-valor">${i.valor}</div>
        <div class="ex-agora-sub">${i.sub || ""}</div>
        ${i.barra != null ? `<div class="ex-ocupacao"><i style="width:${i.barra}%"></i></div>` : ""}
      </div>`).join("");
  }

  function deltaHtml(d, chave, melhor) {
    const c = d.comparativo && d.comparativo[chave];
    if (!c || c.delta_pct == null) return "";
    const v = c.delta_pct;
    let classe = "neutro";
    if (Math.abs(v) >= 0.5 && melhor !== "neutro") {
      const subiu = v > 0;
      classe = (melhor === "alto") === subiu ? "bom" : "ruim";
    }
    const seta = v > 0 ? "▲" : v < 0 ? "▼" : "→";
    const anterior = typeof c.anterior === "number" ? dec(c.anterior, Number.isInteger(c.anterior) ? 0 : 1) : "—";
    return `<span class="ex-delta ${classe}" ${tt(`Período anterior: ${anterior}`)}>${seta} ${dec(Math.abs(v), 1)}%</span>`;
  }

  function renderKpis(d) {
    const k = d.kpis;
    const t = d.tendencia_14d;
    const cartoes = [
      { m: "todos", rotulo: "Total de chamados", valor: num(estado.modulo === "enf" ? k.total_enf : estado.modulo === "hot" ? k.total_hot : k.total),
        spark: estado.modulo === "enf" ? t.enf : estado.modulo === "hot" ? t.hot : t.total, cor: COR.enf,
        delta: deltaHtml(d, estado.modulo === "enf" ? "total_enf" : estado.modulo === "hot" ? "total_hot" : "total", "neutro"),
        rodape: estado.modulo === "todos" ? `Enf. ${num(k.total_enf)} · Hot. ${num(k.total_hot)}` : "" },
      { m: "enf", rotulo: "Críticos (Enfermagem)", valor: num(k.criticos_enf), spark: t.criticos, cor: COR.critica,
        delta: deltaHtml(d, "criticos_enf", "baixo"), rodape: k.total_enf ? `${dec(k.criticos_enf / k.total_enf * 100, 1)}% do total` : "" },
      { m: "enf", rotulo: "Dentro da meta de tempo", valor: pct(k.sla_pct_enf), spark: t.sla_enf, cor: COR.baixa,
        delta: deltaHtml(d, "sla_pct_enf", "alto"), rodape: "Enfermagem · assumidos no prazo" },
      { m: "enf", rotulo: "Espera média (Enf.)", valor: minCurto(k.espera_media_enf), spark: t.espera_enf, cor: COR.pendente,
        delta: deltaHtml(d, "espera_media_enf", "baixo"), rodape: `Mediana ${minCurto(k.espera_mediana_enf)} · P90 ${minCurto(k.espera_p90_enf)}` },
      { m: "enf", rotulo: "Atendimento médio (Enf.)", valor: minCurto(k.atendimento_medio_enf), spark: null, cor: COR.enf,
        delta: deltaHtml(d, "atendimento_medio_enf", "neutro"), rodape: `Resolução ${pct(k.resolucao_pct_enf)}` },
      { m: "hot", rotulo: "Espera média (Hotelaria)", valor: minCurto(k.espera_media_hot), spark: t.espera_hot, cor: COR.hot,
        delta: deltaHtml(d, "espera_media_hot", "baixo"), rodape: `Dentro de ${d.metas.hotelaria_min} min: ${pct(k.sla_pct_hot)}` },
      { m: "hot", rotulo: "Atendimento médio (Hot.)", valor: minCurto(k.atendimento_medio_hot), spark: null, cor: COR.hot,
        delta: deltaHtml(d, "atendimento_medio_hot", "neutro"), rodape: `${num(k.encaminhados_enfermagem)} encaminhados pela Enfermagem` },
      { m: "todos", rotulo: "Satisfação", valor: k.satisfacao_geral == null ? "—" : `${dec(k.satisfacao_geral, 2)}<small>★</small>`,
        spark: t.satisfacao, cor: "#e0a100", delta: deltaHtml(d, "satisfacao_geral", "alto"),
        rodape: `NPS ${k.nps == null ? "—" : (k.nps > 0 ? "+" : "") + k.nps} · ${plural(k.total_avaliacoes, "avaliação", "avaliações")}` },
    ].filter((c) => c.m === "todos" || estado.modulo === "todos" || c.m === estado.modulo);

    $("exKpis").innerHTML = cartoes.map((c) => `
      <div class="ex-kpi" style="--kpi-cor:${c.cor}">
        <div class="ex-kpi-rotulo"><span>${c.rotulo}</span></div>
        <div class="ex-kpi-linha">
          <div class="ex-kpi-valor">${c.valor}</div>
          ${c.spark ? sparkline(c.spark, c.cor) : ""}
        </div>
        <div class="ex-kpi-rodape"><span>${c.rodape}</span>${c.delta}</div>
      </div>`).join("");
    $("exRotuloPeriodo").textContent = `· ${ROTULO_PERIODO[estado.periodo]}${estado.andar ? ` · ${estado.andar}` : ""}`;
  }

  function renderAlertas(d) {
    const lista = d.alertas.filter((a) => estado.modulo === "todos" || (estado.modulo === "enf") === (a.modulo === "enfermagem"));
    const contador = $("exTotalAlertas");
    contador.textContent = lista.length;
    contador.classList.toggle("zero", lista.length === 0);
    if (!lista.length) {
      $("exAlertas").innerHTML = `<div class="ex-vazio ok">Nenhum alerta no momento.<br>Todos os chamados estão dentro do tempo esperado.</div>`;
      return;
    }
    $("exAlertas").innerHTML = lista.map((a) => {
      const href = a.modulo === "enfermagem" ? "/enfermagem/central" : "/hotelaria/central";
      const statusTexto = a.status === "pendente" ? "Aguardando" : a.modulo === "enfermagem" ? "Em atendimento" : "Em andamento";
      return `
        <a class="ex-alerta p-${a.prioridade} ${a.status === "pendente" ? "pendente" : ""}" href="${href}"
           ${tt(`${a.modulo === "enfermagem" ? "Enfermagem" : "Hotelaria"} · chamado #${a.id}\nAberto às ${a.desde}\nMeta: ${a.meta_min} min · clique para abrir a Central`)}>
          <span class="ex-alerta-barra"></span>
          <div class="ex-alerta-leito"><b>${esc(a.leito)}</b><span>${esc(a.andar || "")}</span></div>
          <div class="ex-alerta-corpo">
            <strong>${esc(a.titulo)}</strong>
            <div class="ex-alerta-meta">
              <span class="ex-chip ${a.prioridade}">${ROTULO_PRIORIDADE[a.prioridade]}</span>
              <span class="ex-chip ${a.status === "pendente" ? "status-pendente" : "status-atendimento"}">${statusTexto}</span>
              <span>${esc(a.subtitulo)}</span>
            </div>
          </div>
          <div class="ex-alerta-tempo" data-espera="${a.espera_min}" data-meta="${a.meta_min}" data-pendente="${a.status === "pendente" ? 1 : 0}">
            <b>—</b>
            <div class="ex-alerta-progresso"><i></i></div>
            <small>meta ${a.meta_min} min</small>
          </div>
        </a>`;
    }).join("");
    atualizarCronometros();
  }

  // Cronômetros dos alertas: avançam a cada segundo a partir do valor
  // recebido do servidor (sem esperar o próximo polling).
  function atualizarCronometros() {
    const decorrido = estado.recebidoEm ? (Date.now() - estado.recebidoEm) / 60000 : 0;
    document.querySelectorAll(".ex-alerta-tempo").forEach((el) => {
      const pendente = el.dataset.pendente === "1";
      const espera = parseFloat(el.dataset.espera) + (pendente ? decorrido : 0);
      const meta = parseFloat(el.dataset.meta);
      const razao = espera / meta;
      const total = Math.floor(espera * 60);
      const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
      el.querySelector("b").textContent = h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
      el.querySelector("i").style.width = `${Math.min(razao, 1) * 100}%`;
      el.classList.toggle("acima", pendente && razao > 1);
      el.classList.toggle("perto", pendente && razao > 0.7 && razao <= 1);
    });
  }

  function renderMapa(d) {
    $("exMapa").innerHTML = d.mapa_leitos.map((andar) => {
      const ocupados = andar.leitos.filter((l) => l.estado !== "livre").length;
      return `
      <div class="ex-mapa-andar">
        <div class="ex-mapa-rotulo">${esc(andar.andar)}<small>${ocupados} de ${andar.leitos.length} com chamado</small></div>
        <div class="ex-mapa-leitos">
          ${andar.leitos.map((l) => {
            let estadoVisivel = l.estado;
            if (estado.modulo === "enf" && l.estado === "hotelaria") estadoVisivel = "livre";
            if (estado.modulo === "hot" && l.estado !== "livre") estadoVisivel = l.ativos_hot.length ? "hotelaria" : "livre";
            const linhas = [`Leito ${l.leito} · ${andar.andar}`];
            if (estado.modulo !== "hot") l.ativos_enf.forEach((c) => linhas.push(`🩺 ${c.texto} — ${c.status === "pendente" ? "aguardando" : "em atendimento"} (${minCurto(c.espera_min)})`));
            if (estado.modulo !== "enf") l.ativos_hot.forEach((c) => linhas.push(`🛏 ${c.texto} — ${c.status === "pendente" ? "aguardando" : "em andamento"} (${minCurto(c.espera_min)})`));
            if (linhas.length === 1) linhas.push("Sem chamados ativos");
            linhas.push(`No período: ${l.volume_enf} Enf. · ${l.volume_hot} Hot.`);
            const qtd = (estado.modulo !== "hot" ? l.ativos_enf.length : 0) + (estado.modulo !== "enf" ? l.ativos_hot.length : 0);
            return `<button type="button" class="ex-leito e-${estadoVisivel} ${l.fora_meta && estadoVisivel !== "livre" ? "atraso" : ""}" ${tt(linhas.join("\n"))} aria-label="Leito ${l.leito}">
              ${esc(l.leito)}${qtd ? `<small>${qtd} ativo${qtd > 1 ? "s" : ""}</small>` : ""}
            </button>`;
          }).join("")}
        </div>
      </div>`;
    }).join("") + resumoFilaPorAndar(d);
  }

  // Fila agora por andar (abaixo do mapa): quem aguarda, quem já está em
  // atendimento e a maior espera — o que a coordenação de cada andar olha
  // primeiro na passagem de plantão.
  function resumoFilaPorAndar(d) {
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    const cartoes = d.mapa_leitos.map((andar) => {
      let aguardEnf = 0, atendEnf = 0, aguardHot = 0, andHot = 0, maior = 0;
      andar.leitos.forEach((l) => {
        if (mostraEnf) l.ativos_enf.forEach((c) => {
          if (c.status === "pendente") { aguardEnf++; maior = Math.max(maior, c.espera_min); } else atendEnf++;
        });
        if (mostraHot) l.ativos_hot.forEach((c) => {
          if (c.status === "pendente") { aguardHot++; maior = Math.max(maior, c.espera_min); } else andHot++;
        });
      });
      return `<div class="ex-fila-andar">
        <strong>${esc(andar.andar)}</strong>
        <div class="ex-fila-andar-nums">
          ${mostraEnf ? `<span ${tt("Enfermagem: aguardando / em atendimento")}><i class="ex-tag-modulo enf"></i><b>${aguardEnf}</b> aguard. · ${atendEnf} atend.</span>` : ""}
          ${mostraHot ? `<span ${tt("Hotelaria: aguardando / em andamento")}><i class="ex-tag-modulo hot"></i><b>${aguardHot}</b> aguard. · ${andHot} and.</span>` : ""}
        </div>
        <em class="${maior > 40 ? "longa" : ""}">${maior ? `maior espera ${minCurto(maior)}` : "sem espera"}</em>
      </div>`;
    }).join("");
    return `<div class="ex-subtitulo-bloco" style="margin-top:18px">Fila agora por andar</div><div class="ex-filas-andar">${cartoes}</div>`;
  }

  function renderVolume(d) {
    const cont = $("exVolume");
    const pontos = d.serie.pontos;
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    $("exVolumeSub").textContent = d.serie.granularidade === "hora" ? "Por hora — hoje" : `Por dia — ${ROTULO_PERIODO[estado.periodo].toLowerCase()}`;
    $("exLegendaVolume").innerHTML = `${mostraEnf ? `<span><i class="lg-enf"></i>Enfermagem</span>` : ""}${mostraHot ? `<span><i class="lg-hot"></i>Hotelaria</span>` : ""}${mostraEnf ? `<span><i class="lg-crit-linha"></i>Críticos</span>` : ""}`;
    if (!pontos.length || pontos.every((p) => !p.enf && !p.hot)) {
      cont.innerHTML = `<div class="ex-vazio">Sem chamados no período.</div>`;
      return;
    }
    const W = Math.max(cont.clientWidth, 300), H = 260;
    const m = { t: 12, r: 8, b: 28, l: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const totais = pontos.map((p) => (mostraEnf ? p.enf : 0) + (mostraHot ? p.hot : 0));
    const { max, passo } = escalaY(Math.max(...totais));
    const bw = iw / pontos.length;
    const larg = Math.max(Math.min(bw * 0.68, 34), 2);
    const y = (v) => m.t + ih - (v / max) * ih;

    let grade = "";
    for (let v = 0; v <= max + 0.001; v += passo) {
      grade += `<line class="ex-grade-y" x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
        <text class="ex-eixo" x="${m.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${num(Math.round(v))}</text>`;
    }
    const cadaN = Math.ceil(pontos.length / Math.max(Math.floor(iw / 44), 1));
    let barras = "", rotulos = "", linhaCrit = [];
    pontos.forEach((p, i) => {
      const cx = m.l + bw * i + bw / 2;
      const x = cx - larg / 2;
      const vEnf = mostraEnf ? p.enf : 0;
      const vHot = mostraHot ? p.hot : 0;
      const hEnf = (vEnf / max) * ih, hHot = (vHot / max) * ih;
      const raio = Math.min(4, larg / 3);
      if (vEnf) barras += `<rect x="${x.toFixed(1)}" y="${(m.t + ih - hEnf).toFixed(1)}" width="${larg.toFixed(1)}" height="${hEnf.toFixed(1)}" fill="${COR.enf}" rx="${vHot ? 0 : raio}"/>`;
      if (vHot) barras += `<rect x="${x.toFixed(1)}" y="${(m.t + ih - hEnf - hHot).toFixed(1)}" width="${larg.toFixed(1)}" height="${hHot.toFixed(1)}" fill="${COR.hot}" rx="${raio}"/>`;
      if (vHot && vEnf) barras += `<rect x="${x.toFixed(1)}" y="${(m.t + ih - hEnf - Math.min(raio, hHot)).toFixed(1)}" width="${larg.toFixed(1)}" height="${Math.min(raio, hHot).toFixed(1)}" fill="${COR.hot}"/>`;
      if (mostraEnf) linhaCrit.push(`${cx.toFixed(1)},${y(p.criticos).toFixed(1)}`);
      if (i % cadaN === 0) rotulos += `<text class="ex-eixo" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(p.rotulo)}</text>`;
      const linhasTt = [`${p.dia_semana ? `${p.dia_semana}, ` : ""}${p.rotulo}`];
      if (mostraEnf) linhasTt.push(`Enfermagem: ${p.enf} (críticos: ${p.criticos})`);
      if (mostraHot) linhasTt.push(`Hotelaria: ${p.hot}`);
      if (mostraEnf && p.espera_media_enf != null) linhasTt.push(`Espera média Enf.: ${minCurto(p.espera_media_enf)}`);
      barras += `<rect class="ex-hover-col" x="${(m.l + bw * i).toFixed(1)}" y="${m.t}" width="${bw.toFixed(1)}" height="${ih}" ${tt(linhasTt.join("\n"))}/>`;
    });
    const crit = mostraEnf && linhaCrit.length > 1
      ? `<polyline points="${linhaCrit.join(" ")}" fill="none" stroke="${COR.critica}" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>`
        + (pontos.length <= 40 ? linhaCrit.map((pt) => `<circle cx="${pt.split(",")[0]}" cy="${pt.split(",")[1]}" r="2.6" fill="#fff" stroke="${COR.critica}" stroke-width="1.6" pointer-events="none"/>`).join("") : "")
      : "";
    cont.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Gráfico de volume de chamados">${grade}${barras}${crit}${rotulos}</svg>`;
  }

  function renderStatus(d) {
    const blocos = [];
    if (estado.modulo !== "hot") {
      const s = d.status.enf;
      const segs = [
        { rotulo: "Pendentes", valor: s.pendente, cor: COR.pendente },
        { rotulo: "Em atendimento", valor: s.em_atendimento, cor: COR.atendimento },
        { rotulo: "Finalizados", valor: s.finalizado, cor: COR.finalizado },
      ];
      blocos.push(blocoDonut("Enfermagem", "ponto-enf", segs, `${pct(d.kpis.resolucao_pct_enf)}`, "resolvidos"));
    }
    if (estado.modulo !== "enf") {
      const s = d.status.hot;
      const segs = [
        { rotulo: "Pendentes", valor: s.pendente, cor: COR.pendente },
        { rotulo: "Em andamento", valor: s.em_andamento, cor: "#a78bfa" },
        { rotulo: "Finalizados", valor: s.finalizado, cor: COR.finalizado },
      ];
      blocos.push(blocoDonut("Hotelaria", "ponto-hot", segs, `${pct(d.kpis.resolucao_pct_hot)}`, "resolvidos"));
    }
    $("exStatus").innerHTML = blocos.join("");
  }

  function blocoDonut(titulo, classePonto, segs, centro, rotuloCentro) {
    const total = segs.reduce((s, x) => s + x.valor, 0);
    return `<div>
      <div class="ex-subtitulo-bloco"><i class="${classePonto}"></i>${titulo} · ${num(total)}</div>
      <div class="ex-donut-bloco">
        ${donut(segs, 116, 14, centro, rotuloCentro)}
        <ul class="ex-lista-legenda">${segs.map((s) => `<li><i style="background:${s.cor}"></i><span>${s.rotulo}</span><b>${num(s.valor)}</b><em>${total ? dec(s.valor / total * 100, 0) : 0}%</em></li>`).join("")}</ul>
      </div>
    </div>`;
  }

  function renderSla(d) {
    $("exSla").innerHTML = d.sla_prioridade.map((s) => {
      const cor = s.pct == null ? COR.media : s.pct >= 90 ? COR.baixa : s.pct >= 75 ? "#d49a1f" : COR.critica;
      return `<div class="ex-sla-item" ${tt(`${s.rotulo}: ${s.dentro} de ${s.avaliados} dentro da meta de ${s.meta_min} min`)}>
        ${medidor(s.pct, cor)}
        <div class="ex-sla-info">
          <strong><span class="ex-chip ${s.prioridade}">${s.rotulo}</span> meta ${s.meta_min} min</strong>
          <p>Espera média <b>${minCurto(s.espera_media)}</b> · P90 <b>${minCurto(s.espera_p90)}</b><br>${plural(s.total, "chamado", "chamados")} · ${num(s.avaliados - s.dentro)} fora da meta</p>
        </div>
      </div>`;
    }).join("");
  }

  function renderFaixas(d) {
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    const fe = d.faixas_espera.enf, fh = d.faixas_espera.hot;
    const totEnf = fe.reduce((s, x) => s + x.total, 0), totHot = fh.reduce((s, x) => s + x.total, 0);
    if ((mostraEnf ? totEnf : 0) + (mostraHot ? totHot : 0) === 0) {
      $("exFaixas").innerHTML = `<div class="ex-vazio">Sem atendimentos iniciados no período.</div>`;
      return;
    }
    // Percentual dentro de cada módulo — compara a forma da distribuição
    // mesmo com volumes muito diferentes entre os dois.
    const pe = fe.map((f) => (totEnf ? f.total / totEnf * 100 : 0));
    const ph = fh.map((f) => (totHot ? f.total / totHot * 100 : 0));
    const max = Math.max(...(mostraEnf ? pe : [0]), ...(mostraHot ? ph : [0]), 1);
    $("exFaixas").innerHTML = `
      <div class="ex-faixas">
        ${fe.map((f, i) => `<div class="ex-faixa"><div class="ex-faixa-barras">
          ${mostraEnf ? `<i class="enf" style="height:${pe[i] / max * 100}%" ${tt(`Enfermagem · ${f.rotulo}\n${num(f.total)} chamados (${dec(pe[i], 1)}%)`)}></i>` : ""}
          ${mostraHot ? `<i class="hot" style="height:${ph[i] / max * 100}%" ${tt(`Hotelaria · ${fh[i].rotulo}\n${num(fh[i].total)} chamados (${dec(ph[i], 1)}%)`)}></i>` : ""}
        </div></div>`).join("")}
      </div>
      <div class="ex-faixa-rotulos">${fe.map((f) => `<span>${esc(f.rotulo)}</span>`).join("")}</div>
      <div class="ex-faixas-resumo">
        ${mostraEnf ? `<span><i class="ex-tag-modulo enf"></i>Enf. até 15 min: <b>${dec(pe[0] + pe[1], 0)}%</b></span>` : ""}
        ${mostraHot ? `<span><i class="ex-tag-modulo hot"></i>Hot. até 30 min: <b>${dec(ph[0] + ph[1] + ph[2], 0)}%</b></span>` : ""}
      </div>`;
  }

  function renderTurnos(d) {
    const icones = { "Manhã": "🌅", "Tarde": "☀️", "Noite": "🌙" };
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    $("exTurnos").innerHTML = d.por_turno.map((t) => {
      const total = (mostraEnf ? t.enf : 0) + (mostraHot ? t.hot : 0);
      const pEnf = total ? (mostraEnf ? t.enf : 0) / total * 100 : 0;
      return `<div class="ex-turno" ${tt(`${t.turno} (${t.faixa})\nEnfermagem: ${t.enf} · críticos ${t.criticos}\nHotelaria: ${t.hot}\nEspera média Enf.: ${minCurto(t.espera_media_enf)}\nDentro da meta: ${pct(t.sla_pct)}`)}>
        <div class="ex-turno-icone">${icones[t.turno]}</div>
        <div>
          <strong>${t.turno}<small>${t.faixa}</small></strong>
          <div class="ex-turno-barra"><i style="width:${pEnf}%"></i><i style="width:${100 - pEnf}%"></i></div>
        </div>
        <div class="ex-turno-num"><b>${num(total)}</b>${mostraEnf ? `espera ${minCurto(t.espera_media_enf)} · <span class="ex-pill ${classeSla(t.sla_pct)}">${pct(t.sla_pct)}</span>` : "chamados"}</div>
      </div>`;
    }).join("");
  }

  function renderCalor(d) {
    const modo = estado.modulo === "todos" ? estado.calor : estado.modulo;
    document.querySelectorAll("#exCalorModulo button").forEach((b) => {
      b.classList.toggle("ativo", b.dataset.valor === modo);
      b.disabled = estado.modulo !== "todos" && b.dataset.valor !== estado.modulo;
    });
    const matriz = d.calor.enf.map((linha, i) => linha.map((v, h) => {
      if (modo === "enf") return v;
      if (modo === "hot") return d.calor.hot[i][h];
      return v + d.calor.hot[i][h];
    }));
    const max = Math.max(...matriz.flat(), 1);
    const cor = modo === "hot" ? [124, 58, 237] : modo === "enf" ? [92, 143, 196] : [52, 96, 143];
    let html = `<div class="ex-calor-grade"><span></span>`;
    for (let h = 0; h < 24; h++) html += `<span class="rot rot-hora">${h % 2 === 0 ? `${String(h).padStart(2, "0")}h` : ""}</span>`;
    matriz.forEach((linha, i) => {
      html += `<span class="rot">${d.calor.dias[i]}</span>`;
      linha.forEach((v, h) => {
        // Raiz quadrada: um único pico muito alto não "apaga" o resto do mapa.
        const a = v ? 0.12 + Math.sqrt(v / max) * 0.88 : 0;
        html += `<span class="ex-calor-celula" style="${v ? `background:rgba(${cor.join(",")},${a.toFixed(2)})` : ""}" ${tt(`${d.calor.dias[i]} · ${String(h).padStart(2, "0")}h–${String((h + 1) % 24).padStart(2, "0")}h\n${plural(v, "chamado", "chamados")}`)}></span>`;
      });
    });
    html += `</div>`;

    // Picos: 3 faixas horárias de maior demanda (somando a semana).
    const porHora = Array.from({ length: 24 }, (_, h) => matriz.reduce((s, l) => s + l[h], 0));
    const picos = porHora.map((v, h) => ({ v, h })).sort((a, b) => b.v - a.v).slice(0, 3).filter((p) => p.v > 0);
    const porDia = matriz.map((l, i) => ({ v: l.reduce((s, x) => s + x, 0), d: d.calor.dias[i] })).sort((a, b) => b.v - a.v);
    html += `<div class="ex-calor-escala">menos <i style="background:linear-gradient(90deg, rgba(${cor.join(",")},.1), rgba(${cor.join(",")},1))"></i> mais</div>`;
    if (picos.length) {
      html += `<div class="ex-calor-picos">${picos.map((p, i) => `<span>${i + 1}º pico: <b>${String(p.h).padStart(2, "0")}h–${String((p.h + 1) % 24).padStart(2, "0")}h</b> (${num(p.v)})</span>`).join("")}
        <span>Dia mais movimentado: <b>${porDia[0].d}</b> (${num(porDia[0].v)})</span></div>`;
    }
    $("exCalor").innerHTML = html;
  }

  function renderCategorias(d) {
    const cats = d.por_categoria;
    const total = cats.reduce((s, c) => s + c.total, 0);
    if (!total) {
      $("exCategorias").innerHTML = `<div class="ex-vazio">Sem chamados de enfermagem no período.</div>`;
      return;
    }
    const segs = cats.map((c) => ({ rotulo: c.nome, valor: c.total, cor: COR_CATEGORIA[c.nome] || COR.enf }));
    $("exCategorias").innerHTML = `
      ${donut(segs, 150, 18, num(total), "chamados")}
      <div class="ex-tabela-rolagem">
        <table class="ex-tabela" style="min-width:420px">
          <thead><tr><th>Categoria</th><th class="num">Total</th><th class="num">Críticos</th><th class="num">Espera</th><th class="num">Na meta</th><th class="num">Nota</th></tr></thead>
          <tbody>${cats.map((c) => `<tr>
            <td><span class="ex-tag-modulo" style="background:${COR_CATEGORIA[c.nome]}"></span>${ICONE_CATEGORIA[c.nome] || ""} <strong>${esc(c.nome)}</strong></td>
            <td class="num"><strong>${num(c.total)}</strong> <span class="texto-suave">${c.pct == null ? "" : `${dec(c.pct, 0)}%`}</span></td>
            <td class="num">${num(c.criticos)}</td>
            <td class="num">${minCurto(c.espera_media)}</td>
            <td class="num"><span class="ex-pill ${classeSla(c.sla_pct)}">${pct(c.sla_pct)}</span></td>
            <td class="num"><span class="ex-estrelas">${c.satisfacao == null ? "—" : `★ ${dec(c.satisfacao, 1)}`}</span></td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`;
  }

  function renderSubcategorias(d) {
    const lista = d.top_subcategorias;
    if (!lista.length) {
      $("exSubcategorias").innerHTML = `<div class="ex-vazio">Sem dados no período.</div>`;
      return;
    }
    const max = Math.max(...lista.map((s) => s.total), 1);
    $("exSubcategorias").innerHTML = `<div class="ex-barras">${lista.map((s, i) => `
      <div class="ex-barra-linha" ${tt(`${s.categoria} › ${s.subcategoria}\nPrioridade: ${ROTULO_PRIORIDADE[s.prioridade]}\n${plural(s.total, "chamado", "chamados")}`)}>
        <div>
          <div class="ex-barra-texto"><span><span class="ex-rank">${i + 1}</span>${esc(s.subcategoria)}</span><em>${esc(s.categoria)}</em></div>
          <div class="ex-barra-trilha"><i style="width:${s.total / max * 100}%;background:${COR[s.prioridade]}"></i></div>
        </div>
        <div class="ex-barra-valor">${num(s.total)}</div>
      </div>`).join("")}</div>`;
  }

  function renderServicos(d) {
    const lista = d.por_servico;
    const max = Math.max(...lista.map((s) => s.total), 1);
    $("exServicos").innerHTML = `
      <table class="ex-tabela">
        <thead><tr><th>Serviço</th><th>Volume</th><th>Fila agora</th><th class="num">Espera</th><th class="num">Atendimento</th><th class="num">Nota</th><th class="num">Via Enf.</th></tr></thead>
        <tbody>${lista.map((s) => `<tr>
          <td><span class="ex-tag-modulo" style="background:${COR_SERVICO[s.chave] || COR.hot}"></span><strong>${esc(s.nome)}</strong></td>
          <td><div class="ex-mini-barra"><div class="trilha"><i style="width:${s.total / max * 100}%;background:${COR_SERVICO[s.chave] || COR.hot}"></i></div><b>${num(s.total)}</b></div></td>
          <td><span class="ex-fila-chips">${s.pendentes ? `<span class="p" ${tt("Pendentes")}>${s.pendentes} pend.</span>` : ""}${s.andamento ? `<span class="a" ${tt("Em andamento")}>${s.andamento} and.</span>` : ""}${!s.pendentes && !s.andamento ? `<span class="texto-suave">—</span>` : ""}</span></td>
          <td class="num"><span class="ex-pill ${s.espera_media == null ? "neutro" : s.espera_media <= d.metas.hotelaria_min ? "bom" : s.espera_media <= d.metas.hotelaria_min * 1.5 ? "medio" : "ruim"}">${minCurto(s.espera_media)}</span></td>
          <td class="num">${minCurto(s.atendimento_medio)}</td>
          <td class="num"><span class="ex-estrelas">${s.satisfacao == null ? "—" : `★ ${dec(s.satisfacao, 1)}`}</span></td>
          <td class="num">${num(s.encaminhados)}</td>
        </tr>`).join("")}</tbody>
      </table>`;
  }

  function renderOrigem(d) {
    const o = d.origem_hot;
    const total = o.direto + o.enfermagem;
    const segs = [
      { rotulo: "Pedido direto (Hotelaria)", valor: o.direto, cor: COR.hot },
      { rotulo: "Encaminhado pela Enfermagem", valor: o.enfermagem, cor: COR.enf },
    ];
    const conf = d.confirmacoes_hot || {};
    const rotConf = { expirada: ["Sem resposta (expirada)", "#b7c1cd"], resolvido: ["Resolvido", COR.baixa], nao_resolvido: ["Não resolvido", COR.critica], pendente: ["Aguardando confirmação", COR.pendente], nao_aplicavel: ["Não se aplica", "#dde3ea"] };
    const totalConf = Object.values(conf).reduce((s, v) => s + v, 0);
    const entradas = Object.entries(conf).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    $("exOrigem").innerHTML = `
      <div class="ex-origem">
        ${donut(segs, 116, 14, num(total), "pedidos")}
        <ul class="ex-lista-legenda">${segs.map((s) => `<li><i style="background:${s.cor}"></i><span>${s.rotulo}</span><b>${num(s.valor)}</b><em>${total ? dec(s.valor / total * 100, 0) : 0}%</em></li>`).join("")}</ul>
      </div>
      <div class="ex-confirmacoes">
        <div class="ex-subtitulo-bloco">Confirmação de resolução · ${num(totalConf)} finalizados</div>
        <div class="ex-empilhada">${entradas.map(([k, v]) => `<i style="width:${v / totalConf * 100}%;background:${(rotConf[k] || [k, "#ccc"])[1]}" ${tt(`${(rotConf[k] || [k])[0]}: ${num(v)} (${dec(v / totalConf * 100, 1)}%)`)}></i>`).join("")}</div>
        <ul class="ex-lista-legenda">${entradas.map(([k, v]) => `<li><i style="background:${(rotConf[k] || [k, "#ccc"])[1]}"></i><span>${(rotConf[k] || [k])[0]}</span><b>${num(v)}</b><em>${dec(v / totalConf * 100, 0)}%</em></li>`).join("")}</ul>
      </div>`;
  }

  function renderAndares(d) {
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    const max = Math.max(...d.por_andar.map((a) => (mostraEnf ? a.enf : 0) + (mostraHot ? a.hot : 0)), 1);
    $("exAndares").innerHTML = `
      <table class="ex-tabela">
        <thead><tr><th>Andar</th><th>Volume ${mostraEnf && mostraHot ? "(Enf. + Hot.)" : ""}</th>${mostraEnf ? `<th class="num">Críticos</th><th class="num">Espera Enf.</th><th class="num">Na meta</th>` : ""}${mostraHot ? `<th class="num">Espera Hot.</th>` : ""}<th class="num">Nota</th><th class="num">Ativos</th></tr></thead>
        <tbody>${d.por_andar.map((a) => {
          const e = mostraEnf ? a.enf : 0, h = mostraHot ? a.hot : 0;
          return `<tr>
            <td><strong>${esc(a.andar)}</strong><br><span class="texto-suave" style="font-size:.7rem">${a.leitos} leitos</span></td>
            <td><div class="ex-mini-barra" ${tt(`Enfermagem: ${a.enf}\nHotelaria: ${a.hot}`)}><div class="trilha">
              ${e ? `<i style="width:${e / max * 100}%;background:${COR.enf}"></i>` : ""}${h ? `<i style="width:${h / max * 100}%;background:${COR.hot}"></i>` : ""}
            </div><b>${num(e + h)}</b></div></td>
            ${mostraEnf ? `<td class="num">${num(a.criticos)}</td><td class="num">${minCurto(a.espera_media_enf)}</td><td class="num"><span class="ex-pill ${classeSla(a.sla_pct)}">${pct(a.sla_pct)}</span></td>` : ""}
            ${mostraHot ? `<td class="num">${minCurto(a.espera_media_hot)}</td>` : ""}
            <td class="num"><span class="ex-pill ${classeNota(a.satisfacao)}">${a.satisfacao == null ? "—" : `★ ${dec(a.satisfacao, 2)}`}</span></td>
            <td class="num"><strong>${num(a.ativos)}</strong></td>
          </tr>`;
        }).join("")}</tbody>
        ${d.por_andar.length > 1 ? `<tfoot><tr>
          <td><strong>Total</strong></td>
          <td><strong>${num(d.por_andar.reduce((s, a) => s + (mostraEnf ? a.enf : 0) + (mostraHot ? a.hot : 0), 0))}</strong></td>
          ${mostraEnf ? `<td class="num"><strong>${num(d.por_andar.reduce((s, a) => s + a.criticos, 0))}</strong></td><td class="num">${minCurto(d.kpis.espera_media_enf)}</td><td class="num"><span class="ex-pill ${classeSla(d.kpis.sla_pct_enf)}">${pct(d.kpis.sla_pct_enf)}</span></td>` : ""}
          ${mostraHot ? `<td class="num">${minCurto(d.kpis.espera_media_hot)}</td>` : ""}
          <td class="num"><span class="ex-pill ${classeNota(d.kpis.satisfacao_geral)}">${d.kpis.satisfacao_geral == null ? "—" : `★ ${dec(d.kpis.satisfacao_geral, 2)}`}</span></td>
          <td class="num"><strong>${num(d.por_andar.reduce((s, a) => s + a.ativos, 0))}</strong></td>
        </tr></tfoot>` : ""}
      </table>`;
  }

  function renderReincidencia(d) {
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    const lista = d.reincidencia
      .map((r) => ({ ...r, t: (mostraEnf ? r.enf : 0) + (mostraHot ? r.hot : 0) }))
      .filter((r) => r.t > 0).sort((a, b) => b.t - a.t).slice(0, 8);
    if (!lista.length) {
      $("exReincidencia").innerHTML = `<div class="ex-vazio">Sem dados no período.</div>`;
      return;
    }
    const max = lista[0].t;
    $("exReincidencia").innerHTML = `<div class="ex-barras">${lista.map((r, i) => `
      <div class="ex-barra-linha" ${tt(`Leito ${r.leito} · ${r.andar}\nEnfermagem: ${r.enf}\nHotelaria: ${r.hot}`)}>
        <div>
          <div class="ex-barra-texto"><span><span class="ex-rank">${i + 1}</span>Leito ${esc(r.leito)}</span><em>${esc(r.andar)}</em></div>
          <div class="ex-barra-trilha">
            ${mostraEnf ? `<i style="width:${r.enf / max * 100}%;background:${COR.enf}"></i>` : ""}
            ${mostraHot ? `<i style="width:${r.hot / max * 100}%;background:${COR.hot}"></i>` : ""}
          </div>
        </div>
        <div class="ex-barra-valor">${num(r.t)}</div>
      </div>`).join("")}</div>`;
  }

  function renderSatisfacao(d) {
    const k = d.kpis;
    const mostraEnf = estado.modulo !== "hot";
    const mostraHot = estado.modulo !== "enf";
    const se = d.satisfacao.enf, sh = d.satisfacao.hot;
    const totalEstrela = (n) => (mostraEnf ? se[n] : 0) + (mostraHot ? sh[n] : 0);
    const total = [1, 2, 3, 4, 5].reduce((s, n) => s + totalEstrela(n), 0);
    const nums = [];
    if (mostraEnf) nums.push({ r: "Enfermagem", v: k.satisfacao_enf == null ? "—" : `★ ${dec(k.satisfacao_enf, 2)}` });
    if (mostraHot) nums.push({ r: "Hotelaria", v: k.satisfacao_hot == null ? "—" : `★ ${dec(k.satisfacao_hot, 2)}` });
    if (estado.modulo === "todos") nums.push({ r: "NPS", v: k.nps == null ? "—" : `${k.nps > 0 ? "+" : ""}${k.nps}` });
    $("exSatisfacao").innerHTML = `
      <div class="ex-satisf-topo" style="grid-template-columns:repeat(${nums.length},minmax(0,1fr))">${nums.map((n) => `<div class="ex-satisf-num"><b>${n.v}</b><span>${n.r}</span></div>`).join("")}</div>
      ${[5, 4, 3, 2, 1].map((n) => {
        const t = totalEstrela(n);
        const e = mostraEnf ? se[n] : 0, h = mostraHot ? sh[n] : 0;
        return `<div class="ex-satisf-linha" ${tt(`${n} estrela${n > 1 ? "s" : ""}\nEnfermagem: ${se[n]}\nHotelaria: ${sh[n]}`)}>
          <span>${n}★</span>
          <div class="ex-empilhada">${total ? `<i style="width:${e / total * 100}%;background:${COR.enf}"></i><i style="width:${h / total * 100}%;background:${COR.hot}"></i>` : ""}</div>
          <em>${num(t)} · ${total ? dec(t / total * 100, 0) : 0}%</em>
        </div>`;
      }).join("")}`;
  }

  function renderComentarios(d) {
    const lista = d.comentarios.filter((c) => estado.modulo === "todos" || (estado.modulo === "enf") === (c.modulo === "enfermagem"));
    if (!lista.length) {
      $("exComentarios").innerHTML = `<div class="ex-vazio">Nenhum comentário no período.</div>`;
      return;
    }
    $("exComentarios").innerHTML = lista.map((c) => `
      <div class="ex-comentario ${c.modulo === "hotelaria" ? "hot" : ""}">
        <p>“${esc(c.texto)}”</p>
        <footer><span class="ex-estrelas">${"★".repeat(c.estrelas)}<small>${"★".repeat(5 - c.estrelas)}</small></span><span>Leito ${esc(c.leito)} · ${esc(c.contexto)} · ${esc(c.quando)}</span></footer>
      </div>`).join("");
  }

  const ICONE_EVENTO = {
    aberto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    assumido: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
    finalizado: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  };
  const VERBO = { aberto: "Novo chamado", assumido: "Atendimento iniciado", finalizado: "Finalizado" };

  function renderAtividade(d) {
    const lista = d.atividade.filter((e) => estado.modulo === "todos" || (estado.modulo === "enf") === (e.modulo === "enfermagem"));
    if (!lista.length) {
      $("exAtividade").innerHTML = `<div class="ex-vazio">Sem atividade recente.</div>`;
      return;
    }
    $("exAtividade").innerHTML = lista.map((e) => `
      <div class="ex-evento">
        <div class="ex-evento-icone ${e.tipo}">${ICONE_EVENTO[e.tipo]}</div>
        <div class="ex-evento-texto">
          <strong>${esc(e.texto)}</strong>
          <span><i class="ex-tag-modulo ${e.modulo === "enfermagem" ? "enf" : "hot"}"></i>${VERBO[e.tipo]} · Leito ${esc(e.leito)}</span>
        </div>
        <time>${e.hora}<small>${e.ha_min < 60 ? `há ${Math.round(e.ha_min)} min` : e.ha_min < 1440 ? `há ${Math.floor(e.ha_min / 60)}h` : e.momento.slice(0, 5)}</small></time>
      </div>`).join("");
  }

  // -------------------------------------------------------------------
  // Render geral
  // -------------------------------------------------------------------
  function renderTudo() {
    const d = estado.dados;
    if (!d) return;
    document.body.classList.toggle("modulo-enf", estado.modulo === "enf");
    document.body.classList.toggle("modulo-hot", estado.modulo === "hot");
    const secoes = [renderAgora, renderKpis, renderAlertas, renderMapa, renderVolume, renderStatus, renderSla,
      renderFaixas, renderTurnos, renderCalor, renderCategorias, renderSubcategorias, renderServicos, renderOrigem,
      renderAndares, renderReincidencia, renderSatisfacao, renderComentarios, renderAtividade];
    secoes.forEach((fn) => {
      try { fn(d); } catch (e) { console.error(`Falha ao desenhar ${fn.name}`, e); }
    });
  }

  function marcarControles() {
    document.querySelectorAll("#exPeriodo button").forEach((b) => b.classList.toggle("ativo", b.dataset.valor === estado.periodo));
    document.querySelectorAll("#exModulo button").forEach((b) => b.classList.toggle("ativo", b.dataset.valor === estado.modulo));
    $("exAndar").value = estado.andar;
  }

  function mostrarEsqueleto() {
    ["exAgora", "exKpis"].forEach((id) => { $(id).innerHTML = ""; });
    $("exAgora").innerHTML = `<div class="ex-agora-item" style="grid-column:1/-1;min-height:96px"></div>`;
    $("exKpis").innerHTML = Array.from({ length: 8 }, () => `<div class="ex-esqueleto"></div>`).join("");
  }

  let controladorAtual = null;
  const aoVivo = $("exAoVivo");

  async function carregar() {
    const params = new URLSearchParams();
    if (estado.periodo) params.set("periodo", estado.periodo);
    if (estado.andar) params.set("andar", estado.andar);
    if (controladorAtual) controladorAtual.abort();
    const controlador = new AbortController();
    controladorAtual = controlador;
    try {
      const { dados } = await HRG.fetchJSON(`/api/enfermagem/painel-executivo?${params}`, { signal: controlador.signal, timeout: 20000 });
      if (controlador !== controladorAtual) return;
      estado.dados = dados;
      estado.recebidoEm = Date.now();
      aoVivo.className = "ex-ao-vivo";
      aoVivo.lastChild.textContent = " Ao vivo";
      renderTudo();
    } catch (e) {
      // Requisição substituída por outra mais nova (troca de filtro): ignora.
      if (controlador !== controladorAtual) return;
      if (e.status === 401) { window.location.href = `/enfermagem/login?proximo=${encodeURIComponent(location.pathname)}`; return; }
      aoVivo.className = "ex-ao-vivo erro";
      aoVivo.lastChild.textContent = " Sem conexão";
      HRG.toast(e.message || "Não foi possível atualizar o painel.", "erro");
    }
  }

  // Relógio + "atualizado há Xs" + cronômetros dos alertas.
  function tick() {
    const agora = new Date();
    $("exRelogio").textContent = agora.toLocaleTimeString("pt-BR");
    if (estado.dados) {
      const seg = Math.round((Date.now() - estado.recebidoEm) / 1000);
      $("exAtualizado").textContent = `dados de ${estado.dados.data_hoje} às ${estado.dados.atualizado_em}${seg >= 5 ? ` (há ${seg}s)` : ""}`;
      atualizarCronometros();
    }
    if (document.hidden) { aoVivo.className = "ex-ao-vivo pausado"; aoVivo.lastChild.textContent = " Pausado"; }
  }
  setInterval(tick, 1000);

  // -------------------------------------------------------------------
  // Controles
  // -------------------------------------------------------------------
  document.querySelectorAll("#exPeriodo button").forEach((b) => b.addEventListener("click", () => {
    if (estado.periodo === b.dataset.valor) return;
    estado.periodo = b.dataset.valor;
    salvarPreferencias(); marcarControles(); carregar();
  }));
  document.querySelectorAll("#exModulo button").forEach((b) => b.addEventListener("click", () => {
    estado.modulo = b.dataset.valor;
    salvarPreferencias(); marcarControles(); renderTudo();
  }));
  document.querySelectorAll("#exCalorModulo button").forEach((b) => b.addEventListener("click", () => {
    estado.calor = b.dataset.valor;
    salvarPreferencias();
    if (estado.dados) renderCalor(estado.dados);
  }));
  $("exAndar").addEventListener("change", (e) => {
    estado.andar = e.target.value;
    salvarPreferencias(); carregar();
  });

  $("exImprimir").addEventListener("click", () => window.print());

  $("exTelaCheia").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("modo-tv", Boolean(document.fullscreenElement));
    if (estado.dados) renderVolume(estado.dados);
  });

  $("exExportar").addEventListener("click", () => {
    const d = estado.dados;
    if (!d) return;
    const linhas = [];
    const add = (...cols) => linhas.push(cols.map((c) => {
      const s = c == null ? "" : String(c);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(";"));
    add("Dashboard Executivo — Hospital Rio Grande");
    add("Período", ROTULO_PERIODO[estado.periodo], "Andar", estado.andar || "Todos", "Gerado em", `${d.data_hoje} ${d.atualizado_em}`);
    add();
    add("Indicador", "Valor", "Período anterior", "Variação %");
    Object.entries(d.kpis).forEach(([k, v]) => {
      const c = d.comparativo && d.comparativo[k];
      add(k, v, c ? c.anterior : "", c ? c.delta_pct : "");
    });
    add();
    add("Série", "Enfermagem", "Hotelaria", "Críticos");
    d.serie.pontos.forEach((p) => add(p.rotulo, p.enf, p.hot, p.criticos));
    add();
    add("Categoria (Enfermagem)", "Total", "Críticos", "Espera média (min)", "Atendimento médio (min)", "% na meta", "Satisfação");
    d.por_categoria.forEach((c) => add(c.nome, c.total, c.criticos, c.espera_media, c.atendimento_medio, c.sla_pct, c.satisfacao));
    add();
    add("Serviço (Hotelaria)", "Total", "Pendentes", "Em andamento", "Finalizados", "Espera média (min)", "Atendimento médio (min)", "Satisfação", "Encaminhados pela Enfermagem");
    d.por_servico.forEach((s) => add(s.nome, s.total, s.pendentes, s.andamento, s.finalizados, s.espera_media, s.atendimento_medio, s.satisfacao, s.encaminhados));
    add();
    add("Andar", "Enfermagem", "Hotelaria", "Críticos", "Espera média Enf. (min)", "Espera média Hot. (min)", "% na meta", "Satisfação", "Ativos agora");
    d.por_andar.forEach((a) => add(a.andar, a.enf, a.hot, a.criticos, a.espera_media_enf, a.espera_media_hot, a.sla_pct, a.satisfacao, a.ativos));
    add();
    add("Turno", "Faixa", "Enfermagem", "Hotelaria", "Críticos", "Espera média Enf. (min)", "% na meta");
    d.por_turno.forEach((t) => add(t.turno, t.faixa, t.enf, t.hot, t.criticos, t.espera_media_enf, t.sla_pct));

    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-executivo-${(estado.periodo || "tudo")}-${d.data_hoje.split("/").reverse().join("-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    HRG.toast("Indicadores exportados em CSV.", "sucesso");
  });

  window.addEventListener("resize", HRG.debounce(() => { if (estado.dados) renderVolume(estado.dados); }, 150));

  marcarControles();
  mostrarEsqueleto();
  // `pollWhileVisible` pula a primeira carga se a aba abrir em segundo plano
  // (ex.: aberta com Ctrl+clique) — aí o painel ficaria vazio até alguém
  // olhar para ele. Nesse caso carrega uma vez mesmo assim.
  if (document.hidden) carregar();
  HRG.pollWhileVisible(carregar, 30000);
})();
