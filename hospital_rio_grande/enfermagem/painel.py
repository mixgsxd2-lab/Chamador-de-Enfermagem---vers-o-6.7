# -*- coding: utf-8 -*-
"""Dashboard Executivo — visão consolidada de Enfermagem E Hotelaria.

Agrega, num único payload, tudo o que a tela `/enfermagem/dashboard/executivo`
precisa: KPIs com comparativo do período anterior, série temporal, mapa de
calor dia × hora, cumprimento de meta de tempo (SLA) por prioridade, faixas
de espera, categorias/serviços, andares, turnos, mapa de leitos em tempo
real, alertas, satisfação, reincidência por leito e feed de atividade.

Somente LEITURA: consulta as tabelas dos dois módulos e nunca altera nada.
Todos os números vêm do banco — nenhum valor é estimado ou inventado; quando
não há dado, o campo vem `None` e a tela mostra "—".
"""
from datetime import timedelta

from andares import ANDARES, andar_do_leito
from timeutils import agora, para_texto, parse_dt, limite_periodo, janela_comparativa_anterior
from enfermagem.constants import CATEGORIAS, CATEGORIA_OUTROS
from enfermagem.priority import SLA_MINUTOS, _tier
from hotelaria.models import SERVICOS, descricao_exibicao

# Meta de REFERÊNCIA para a Hotelaria (a Hotelaria não tem faixas de
# prioridade): tempo até a equipe iniciar o atendimento. Usada só para
# destacar pedidos "aguardando há muito tempo" e para o % dentro da meta.
META_HOTELARIA_MIN = 30

TURNOS = [("Manhã", 7, 13), ("Tarde", 13, 19), ("Noite", 19, 7)]
DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]


def _turno(hora):
    if 7 <= hora < 13:
        return "Manhã"
    if 13 <= hora < 19:
        return "Tarde"
    return "Noite"


def _minutos(inicio, fim):
    if inicio is None or fim is None:
        return None
    return max((fim - inicio).total_seconds() / 60, 0)


def _media(valores):
    valores = [v for v in valores if v is not None]
    return round(sum(valores) / len(valores), 1) if valores else None


def _percentil(valores, p):
    valores = sorted(v for v in valores if v is not None)
    if not valores:
        return None
    k = (len(valores) - 1) * p
    baixo = int(k)
    alto = min(baixo + 1, len(valores) - 1)
    return round(valores[baixo] + (valores[alto] - valores[baixo]) * (k - baixo), 1)


def _pct(parte, total):
    return round(parte / total * 100, 1) if total else None


def _delta(atual, anterior):
    if atual is None or anterior is None:
        return None
    if anterior == 0:
        return None if atual == 0 else 100.0
    return round((atual - anterior) / anterior * 100, 1)


# ---------------------------------------------------------------------------
# Leitura e normalização das linhas
# ---------------------------------------------------------------------------
def _carregar_enfermagem(db, inicio, fim, andar, somente_ativos=False):
    sql = "SELECT * FROM enfermagem_chamados WHERE categoria != ?"
    params = [CATEGORIA_OUTROS]
    if somente_ativos:
        sql += " AND status != 'finalizado'"
    if inicio is not None:
        sql += " AND criado_em >= ?"
        params.append(para_texto(inicio))
    if fim is not None:
        sql += " AND criado_em < ?"
        params.append(para_texto(fim))
    if andar:
        sql += " AND andar = ?"
        params.append(andar)
    agora_ref = agora()
    itens = []
    for r in db.execute(sql, params).fetchall():
        criado = parse_dt(r["criado_em"])
        inicio_at = parse_dt(r["inicio_atendimento"])
        fim_at = parse_dt(r["finalizado_em"])
        tier = _tier(r["gravidade_base"])
        espera = _minutos(criado, inicio_at) if inicio_at else _minutos(criado, agora_ref)
        itens.append({
            "id": r["id"], "andar": r["andar"], "leito": r["leito"],
            "categoria": r["categoria"], "subcategoria": r["subcategoria"], "detalhe": r["detalhe"],
            "status": r["status"], "tier": tier, "sla": SLA_MINUTOS[tier],
            "criado": criado, "inicio": inicio_at, "fim": fim_at,
            "espera": espera, "espera_concluida": inicio_at is not None,
            "atendimento": _minutos(inicio_at, fim_at),
            "avaliacao": r["avaliacao"], "comentario": r["comentario_avaliacao"],
        })
    return itens


def _carregar_hotelaria(db, inicio, fim, andar, somente_ativos=False):
    sql = "SELECT * FROM hotelaria_chamados WHERE 1 = 1"
    params = []
    if somente_ativos:
        sql += " AND status != 'finalizado'"
    if inicio is not None:
        sql += " AND criado_em >= ?"
        params.append(para_texto(inicio))
    if fim is not None:
        sql += " AND criado_em < ?"
        params.append(para_texto(fim))
    linhas = db.execute(sql, params).fetchall()

    ids = [r["id"] for r in linhas]
    avaliacoes = {}
    if ids:
        # Em blocos, para nunca estourar o limite de parâmetros do SQLite.
        for i in range(0, len(ids), 800):
            bloco = ids[i:i + 800]
            marcadores = ",".join("?" for _ in bloco)
            for a in db.execute(
                f"SELECT chamado_id, estrelas, comentario, criado_em FROM hotelaria_avaliacoes WHERE chamado_id IN ({marcadores})",
                bloco,
            ).fetchall():
                avaliacoes[a["chamado_id"]] = a

    agora_ref = agora()
    itens = []
    for r in linhas:
        andar_item = r["andar"] or andar_do_leito(r["leito"])
        if andar and andar_item != andar:
            continue
        criado = parse_dt(r["criado_em"])
        inicio_at = parse_dt(r["iniciado_em"])
        fim_at = parse_dt(r["finalizado_em"])
        av = avaliacoes.get(r["id"])
        itens.append({
            "id": r["id"], "andar": andar_item, "leito": r["leito"],
            "servico": r["servico"], "servico_nome": SERVICOS.get(r["servico"], {}).get("nome", r["servico"]),
            "descricao": descricao_exibicao(r["descricao"]), "origem": r["origem"],
            "status": r["status"], "criado": criado, "inicio": inicio_at, "fim": fim_at,
            "espera": _minutos(criado, inicio_at) if inicio_at else _minutos(criado, agora_ref),
            "espera_concluida": inicio_at is not None,
            "atendimento": _minutos(inicio_at, fim_at),
            "avaliacao": av["estrelas"] if av else None,
            "comentario": av["comentario"] if av else None,
            "avaliado_em": parse_dt(av["criado_em"]) if av else None,
            "confirmacao": r["confirmacao_resolucao"],
        })
    return itens


# ---------------------------------------------------------------------------
# KPIs (calculados para o período atual e para o anterior equivalente)
# ---------------------------------------------------------------------------
def _sla_enf(itens):
    """(dentro, avaliados): conta quem já foi assumido (dentro/fora da
    meta) + pendentes que JÁ estouraram a meta (violação garantida).
    Pendentes ainda dentro do prazo não entram — o resultado deles ainda
    não é conhecido."""
    dentro = avaliados = 0
    for c in itens:
        if c["espera_concluida"]:
            avaliados += 1
            if c["espera"] <= c["sla"]:
                dentro += 1
        elif c["espera"] > c["sla"]:
            avaliados += 1
    return dentro, avaliados


def _kpis(enf, hot):
    enf_iniciados = [c["espera"] for c in enf if c["espera_concluida"]]
    hot_iniciados = [c["espera"] for c in hot if c["espera_concluida"]]
    dentro, avaliados = _sla_enf(enf)
    hot_dentro = sum(1 for c in hot if c["espera_concluida"] and c["espera"] <= META_HOTELARIA_MIN)
    hot_aval = sum(1 for c in hot if c["espera_concluida"] or c["espera"] > META_HOTELARIA_MIN)
    notas_enf = [c["avaliacao"] for c in enf if c["avaliacao"]]
    notas_hot = [c["avaliacao"] for c in hot if c["avaliacao"]]
    todas = notas_enf + notas_hot
    return {
        "total": len(enf) + len(hot),
        "total_enf": len(enf),
        "total_hot": len(hot),
        "criticos_enf": sum(1 for c in enf if c["tier"] == "critica"),
        "espera_media_enf": _media(enf_iniciados),
        "espera_mediana_enf": _percentil(enf_iniciados, 0.5),
        "espera_p90_enf": _percentil(enf_iniciados, 0.9),
        "atendimento_medio_enf": _media([c["atendimento"] for c in enf]),
        "espera_media_hot": _media(hot_iniciados),
        "atendimento_medio_hot": _media([c["atendimento"] for c in hot]),
        "sla_pct_enf": _pct(dentro, avaliados),
        "sla_pct_hot": _pct(hot_dentro, hot_aval),
        "resolucao_pct_enf": _pct(sum(1 for c in enf if c["status"] == "finalizado"), len(enf)),
        "resolucao_pct_hot": _pct(sum(1 for c in hot if c["status"] == "finalizado"), len(hot)),
        "satisfacao_enf": round(sum(notas_enf) / len(notas_enf), 2) if notas_enf else None,
        "satisfacao_hot": round(sum(notas_hot) / len(notas_hot), 2) if notas_hot else None,
        "satisfacao_geral": round(sum(todas) / len(todas), 2) if todas else None,
        # NPS adaptado à escala de 5 estrelas: 5 = promotor, 1–3 = detrator.
        "nps": round((sum(1 for n in todas if n == 5) - sum(1 for n in todas if n <= 3)) / len(todas) * 100) if todas else None,
        "total_avaliacoes": len(todas),
        "encaminhados_enfermagem": sum(1 for c in hot if c["origem"] == "enfermagem"),
    }


# ---------------------------------------------------------------------------
# Série temporal
# ---------------------------------------------------------------------------
def _serie(enf, hot, periodo, inicio):
    agora_ref = agora()
    if periodo == "hoje":
        pontos = []
        for h in range(agora_ref.hour + 1):
            pontos.append({
                "rotulo": f"{h:02d}h",
                "enf": sum(1 for c in enf if c["criado"].hour == h),
                "hot": sum(1 for c in hot if c["criado"].hour == h),
                "criticos": sum(1 for c in enf if c["criado"].hour == h and c["tier"] == "critica"),
            })
        return {"granularidade": "hora", "pontos": pontos}

    datas = [c["criado"] for c in enf + hot]
    if inicio is None:
        inicio = min(datas) if datas else agora_ref
    dia = inicio.replace(hour=0, minute=0, second=0, microsecond=0)
    fim = agora_ref.replace(hour=0, minute=0, second=0, microsecond=0)
    contagem = {}
    for c in enf:
        chave = c["criado"].date()
        d = contagem.setdefault(chave, {"enf": 0, "hot": 0, "criticos": 0, "esperas": []})
        d["enf"] += 1
        if c["tier"] == "critica":
            d["criticos"] += 1
        if c["espera_concluida"]:
            d["esperas"].append(c["espera"])
    for c in hot:
        contagem.setdefault(c["criado"].date(), {"enf": 0, "hot": 0, "criticos": 0, "esperas": []})["hot"] += 1

    pontos = []
    while dia <= fim:
        d = contagem.get(dia.date(), {"enf": 0, "hot": 0, "criticos": 0, "esperas": []})
        pontos.append({
            "rotulo": dia.strftime("%d/%m"),
            "dia_semana": DIAS_SEMANA[dia.weekday()],
            "enf": d["enf"], "hot": d["hot"], "criticos": d["criticos"],
            "espera_media_enf": _media(d["esperas"]),
        })
        dia += timedelta(days=1)
    return {"granularidade": "dia", "pontos": pontos}


def _tendencia_14_dias(db, andar):
    """Sparklines dos cartões: sempre os últimos 14 dias, independente do
    período escolhido (mostra a tendência recente de cada indicador)."""
    hoje = agora().replace(hour=0, minute=0, second=0, microsecond=0)
    inicio = hoje - timedelta(days=13)
    enf = _carregar_enfermagem(db, inicio, None, andar)
    hot = _carregar_hotelaria(db, inicio, None, andar)
    dias = [(inicio + timedelta(days=i)).date() for i in range(14)]
    por_dia_enf = {d: [] for d in dias}
    por_dia_hot = {d: [] for d in dias}
    for c in enf:
        por_dia_enf.setdefault(c["criado"].date(), []).append(c)
    for c in hot:
        por_dia_hot.setdefault(c["criado"].date(), []).append(c)

    def serie(fn):
        return [fn(por_dia_enf[d], por_dia_hot[d]) for d in dias]

    def sla(e, _h):
        dentro, avaliados = _sla_enf(e)
        return _pct(dentro, avaliados)

    def satisf(e, h):
        notas = [c["avaliacao"] for c in e + h if c["avaliacao"]]
        return round(sum(notas) / len(notas), 2) if notas else None

    return {
        "dias": [d.strftime("%d/%m") for d in dias],
        "total": serie(lambda e, h: len(e) + len(h)),
        "enf": serie(lambda e, h: len(e)),
        "hot": serie(lambda e, h: len(h)),
        "criticos": serie(lambda e, h: sum(1 for c in e if c["tier"] == "critica")),
        "espera_enf": serie(lambda e, h: _media([c["espera"] for c in e if c["espera_concluida"]])),
        "sla_enf": serie(sla),
        "satisfacao": serie(satisf),
        "espera_hot": serie(lambda e, h: _media([c["espera"] for c in h if c["espera_concluida"]])),
    }


# ---------------------------------------------------------------------------
# Payload completo
# ---------------------------------------------------------------------------
def montar_painel(db, periodo, andar):
    agora_ref = agora()
    inicio = limite_periodo(periodo)
    enf = _carregar_enfermagem(db, inicio, None, andar)
    hot = _carregar_hotelaria(db, inicio, None, andar)

    kpis = _kpis(enf, hot)
    comparativo = None
    janela = janela_comparativa_anterior(periodo) if periodo else None
    if janela is not None:
        ini_ant, fim_ant = janela
        anterior = _kpis(_carregar_enfermagem(db, ini_ant, fim_ant, andar), _carregar_hotelaria(db, ini_ant, fim_ant, andar))
        comparativo = {
            chave: {"anterior": anterior[chave], "delta_pct": _delta(kpis[chave], anterior[chave])}
            for chave in kpis
        }

    # ---- Ativos AGORA (independem do período: é o retrato do momento) ----
    ativos_enf = _carregar_enfermagem(db, None, None, andar, somente_ativos=True)
    ativos_hot = _carregar_hotelaria(db, None, None, andar, somente_ativos=True)

    agora_bloco = {
        "pendentes_enf": sum(1 for c in ativos_enf if c["status"] == "pendente"),
        "em_atendimento_enf": sum(1 for c in ativos_enf if c["status"] == "em_atendimento"),
        "pendentes_hot": sum(1 for c in ativos_hot if c["status"] == "pendente"),
        "andamento_hot": sum(1 for c in ativos_hot if c["status"] == "em_andamento"),
        "criticos_ativos": sum(1 for c in ativos_enf if c["tier"] == "critica"),
        "fora_sla_enf": sum(1 for c in ativos_enf if c["status"] == "pendente" and c["espera"] > c["sla"]),
        "fora_meta_hot": sum(1 for c in ativos_hot if c["status"] == "pendente" and c["espera"] > META_HOTELARIA_MIN),
        "maior_espera_enf": round(max((c["espera"] for c in ativos_enf if c["status"] == "pendente"), default=0), 1) or None,
        "maior_espera_hot": round(max((c["espera"] for c in ativos_hot if c["status"] == "pendente"), default=0), 1) or None,
    }
    agora_bloco["total_ativos"] = len(ativos_enf) + len(ativos_hot)
    total_leitos = sum(len(v) for a, v in ANDARES.items() if not andar or a == andar)
    leitos_com_ativo = {(c["andar"], c["leito"]) for c in ativos_enf + ativos_hot}
    agora_bloco["leitos_com_chamado"] = len(leitos_com_ativo)
    agora_bloco["total_leitos"] = total_leitos

    # ---- Alertas: críticos, fora da meta e Hotelaria aguardando demais ----
    alertas = []
    for c in ativos_enf:
        acima = c["status"] == "pendente" and c["espera"] > c["sla"]
        if c["tier"] == "critica" or acima:
            alertas.append({
                "modulo": "enfermagem", "id": c["id"], "andar": c["andar"], "leito": c["leito"],
                "titulo": c["subcategoria"], "subtitulo": c["categoria"], "prioridade": c["tier"],
                "status": c["status"], "espera_min": round(c["espera"], 1), "meta_min": c["sla"], "acima": acima,
                "desde": c["criado"].strftime("%H:%M"),
            })
    for c in ativos_hot:
        if c["status"] == "pendente" and c["espera"] > META_HOTELARIA_MIN:
            alertas.append({
                "modulo": "hotelaria", "id": c["id"], "andar": c["andar"], "leito": c["leito"],
                "titulo": c["descricao"], "subtitulo": c["servico_nome"], "prioridade": "hotelaria",
                "status": c["status"], "espera_min": round(c["espera"], 1), "meta_min": META_HOTELARIA_MIN, "acima": True,
                "desde": c["criado"].strftime("%H:%M"),
            })
    ordem = {"critica": 0, "media": 1, "baixa": 2, "hotelaria": 3}
    alertas.sort(key=lambda a: (not (a["prioridade"] == "critica" and a["status"] == "pendente"),
                                ordem[a["prioridade"]], -a["espera_min"]))

    # ---- Mapa de leitos (estado atual) + volume do período por leito ----
    volume_leito = {}
    for c in enf:
        volume_leito.setdefault((c["andar"], c["leito"]), [0, 0])[0] += 1
    for c in hot:
        volume_leito.setdefault((c["andar"], c["leito"]), [0, 0])[1] += 1
    mapa = []
    for nome_andar, leitos in ANDARES.items():
        if andar and nome_andar != andar:
            continue
        linha = []
        for leito in leitos:
            e_ativos = [c for c in ativos_enf if c["andar"] == nome_andar and c["leito"] == leito]
            h_ativos = [c for c in ativos_hot if c["andar"] == nome_andar and c["leito"] == leito]
            if any(c["tier"] == "critica" for c in e_ativos):
                estado = "critica"
            elif any(c["tier"] == "media" for c in e_ativos):
                estado = "media"
            elif e_ativos:
                estado = "baixa"
            elif h_ativos:
                estado = "hotelaria"
            else:
                estado = "livre"
            vol = volume_leito.get((nome_andar, leito), [0, 0])
            linha.append({
                "leito": leito, "estado": estado,
                "ativos_enf": [{"id": c["id"], "texto": c["subcategoria"], "status": c["status"],
                                "espera_min": round(c["espera"], 1), "prioridade": c["tier"]} for c in e_ativos],
                "ativos_hot": [{"id": c["id"], "texto": c["servico_nome"], "status": c["status"],
                                "espera_min": round(c["espera"], 1)} for c in h_ativos],
                "volume_enf": vol[0], "volume_hot": vol[1],
                "fora_meta": any(c["status"] == "pendente" and c["espera"] > c["sla"] for c in e_ativos)
                or any(c["status"] == "pendente" and c["espera"] > META_HOTELARIA_MIN for c in h_ativos),
            })
        mapa.append({"andar": nome_andar, "leitos": linha})

    # ---- Mapa de calor dia da semana × hora ----
    calor_enf = [[0] * 24 for _ in range(7)]
    calor_hot = [[0] * 24 for _ in range(7)]
    for c in enf:
        calor_enf[c["criado"].weekday()][c["criado"].hour] += 1
    for c in hot:
        calor_hot[c["criado"].weekday()][c["criado"].hour] += 1

    # ---- Meta de tempo (SLA) por prioridade ----
    sla_prioridade = []
    for tier, rotulo in (("critica", "Crítico"), ("media", "Médio"), ("baixa", "Baixo")):
        grupo = [c for c in enf if c["tier"] == tier]
        dentro, avaliados = _sla_enf(grupo)
        esperas = [c["espera"] for c in grupo if c["espera_concluida"]]
        sla_prioridade.append({
            "prioridade": tier, "rotulo": rotulo, "meta_min": SLA_MINUTOS[tier], "total": len(grupo),
            "dentro": dentro, "avaliados": avaliados, "pct": _pct(dentro, avaliados),
            "espera_media": _media(esperas), "espera_p90": _percentil(esperas, 0.9),
        })

    faixas = [(0, 5, "até 5 min"), (5, 15, "5–15"), (15, 30, "15–30"), (30, 60, "30–60"), (60, None, "60+ min")]

    def distribuir(itens):
        esperas = [c["espera"] for c in itens if c["espera_concluida"]]
        return [{"rotulo": r, "total": sum(1 for e in esperas if e >= a and (b is None or e < b))} for a, b, r in faixas]

    # ---- Enfermagem: categorias e subcategorias ----
    por_categoria = []
    for nome in CATEGORIAS:
        if nome == CATEGORIA_OUTROS:
            continue
        grupo = [c for c in enf if c["categoria"] == nome]
        dentro, avaliados = _sla_enf(grupo)
        notas = [c["avaliacao"] for c in grupo if c["avaliacao"]]
        por_categoria.append({
            "nome": nome, "total": len(grupo), "pct": _pct(len(grupo), len(enf)),
            "criticos": sum(1 for c in grupo if c["tier"] == "critica"),
            "espera_media": _media([c["espera"] for c in grupo if c["espera_concluida"]]),
            "atendimento_medio": _media([c["atendimento"] for c in grupo]),
            "sla_pct": _pct(dentro, avaliados),
            "satisfacao": round(sum(notas) / len(notas), 2) if notas else None,
        })
    contagem_sub = {}
    for c in enf:
        chave = (c["categoria"], c["subcategoria"], c["tier"])
        contagem_sub[chave] = contagem_sub.get(chave, 0) + 1
    top_sub = sorted(contagem_sub.items(), key=lambda kv: -kv[1])[:10]

    # ---- Hotelaria: serviços ----
    por_servico = []
    for chave, dados in SERVICOS.items():
        if chave == "outros":
            continue
        grupo = [c for c in hot if c["servico"] == chave]
        notas = [c["avaliacao"] for c in grupo if c["avaliacao"]]
        por_servico.append({
            "chave": chave, "nome": dados["nome"], "total": len(grupo),
            "pendentes": sum(1 for c in grupo if c["status"] == "pendente"),
            "andamento": sum(1 for c in grupo if c["status"] == "em_andamento"),
            "finalizados": sum(1 for c in grupo if c["status"] == "finalizado"),
            "espera_media": _media([c["espera"] for c in grupo if c["espera_concluida"]]),
            "atendimento_medio": _media([c["atendimento"] for c in grupo]),
            "satisfacao": round(sum(notas) / len(notas), 2) if notas else None,
            "encaminhados": sum(1 for c in grupo if c["origem"] == "enfermagem"),
        })
    confirmacoes = {}
    for c in hot:
        if c["status"] == "finalizado":
            confirmacoes[c["confirmacao"]] = confirmacoes.get(c["confirmacao"], 0) + 1

    # ---- Andares ----
    por_andar = []
    for nome_andar in ANDARES:
        if andar and nome_andar != andar:
            continue
        e = [c for c in enf if c["andar"] == nome_andar]
        h = [c for c in hot if c["andar"] == nome_andar]
        dentro, avaliados = _sla_enf(e)
        notas = [c["avaliacao"] for c in e + h if c["avaliacao"]]
        por_andar.append({
            "andar": nome_andar, "enf": len(e), "hot": len(h),
            "criticos": sum(1 for c in e if c["tier"] == "critica"),
            "espera_media_enf": _media([c["espera"] for c in e if c["espera_concluida"]]),
            "espera_media_hot": _media([c["espera"] for c in h if c["espera_concluida"]]),
            "sla_pct": _pct(dentro, avaliados),
            "satisfacao": round(sum(notas) / len(notas), 2) if notas else None,
            "ativos": sum(1 for c in ativos_enf + ativos_hot if c["andar"] == nome_andar),
            "leitos": len(ANDARES[nome_andar]),
        })

    # ---- Turnos ----
    por_turno = []
    for nome, h_ini, h_fim in TURNOS:
        e = [c for c in enf if _turno(c["criado"].hour) == nome]
        h = [c for c in hot if _turno(c["criado"].hour) == nome]
        dentro, avaliados = _sla_enf(e)
        por_turno.append({
            "turno": nome, "faixa": f"{h_ini:02d}h–{h_fim:02d}h", "enf": len(e), "hot": len(h),
            "criticos": sum(1 for c in e if c["tier"] == "critica"),
            "espera_media_enf": _media([c["espera"] for c in e if c["espera_concluida"]]),
            "sla_pct": _pct(dentro, avaliados),
        })

    # ---- Satisfação ----
    def distribuicao(itens):
        dist = {str(n): 0 for n in range(1, 6)}
        for c in itens:
            if c["avaliacao"]:
                dist[str(c["avaliacao"])] += 1
        return dist

    comentarios = []
    for c in enf:
        if c["comentario"]:
            comentarios.append({"modulo": "enfermagem", "estrelas": c["avaliacao"], "texto": c["comentario"],
                                "leito": c["leito"], "andar": c["andar"], "quando": c["fim"] or c["criado"],
                                "contexto": c["subcategoria"]})
    for c in hot:
        if c["comentario"]:
            comentarios.append({"modulo": "hotelaria", "estrelas": c["avaliacao"], "texto": c["comentario"],
                                "leito": c["leito"], "andar": c["andar"], "quando": c["avaliado_em"] or c["criado"],
                                "contexto": c["servico_nome"]})
    comentarios.sort(key=lambda x: x["quando"], reverse=True)
    for x in comentarios:
        x["quando"] = x["quando"].strftime("%d/%m %H:%M")

    # ---- Reincidência por leito ----
    reincidencia = sorted(
        ({"andar": a, "leito": l, "enf": v[0], "hot": v[1], "total": v[0] + v[1]} for (a, l), v in volume_leito.items()),
        key=lambda x: -x["total"],
    )[:8]

    # ---- Feed de atividade (eventos mais recentes dos dois módulos) ----
    eventos = []
    limite_feed = agora_ref - timedelta(days=2)
    for c in (enf if inicio is not None and inicio >= limite_feed else _carregar_enfermagem(db, limite_feed, None, andar)):
        for momento, tipo in ((c["criado"], "aberto"), (c["inicio"], "assumido"), (c["fim"], "finalizado")):
            if momento and momento >= limite_feed:
                eventos.append({"momento": momento, "modulo": "enfermagem", "tipo": tipo, "leito": c["leito"],
                                "andar": c["andar"], "texto": c["subcategoria"], "prioridade": c["tier"]})
    for c in (hot if inicio is not None and inicio >= limite_feed else _carregar_hotelaria(db, limite_feed, None, andar)):
        for momento, tipo in ((c["criado"], "aberto"), (c["inicio"], "assumido"), (c["fim"], "finalizado")):
            if momento and momento >= limite_feed:
                eventos.append({"momento": momento, "modulo": "hotelaria", "tipo": tipo, "leito": c["leito"],
                                "andar": c["andar"], "texto": c["servico_nome"], "prioridade": "hotelaria"})
    eventos.sort(key=lambda e: e["momento"], reverse=True)
    eventos = eventos[:18]
    for e in eventos:
        e["ha_min"] = round(_minutos(e["momento"], agora_ref), 1)
        e["hora"] = e["momento"].strftime("%H:%M")
        e["momento"] = e["momento"].strftime("%d/%m %H:%M")

    return {
        "atualizado_em": agora_ref.strftime("%H:%M:%S"),
        "data_hoje": agora_ref.strftime("%d/%m/%Y"),
        "periodo": periodo or "",
        "andar": andar or "",
        "metas": {"enfermagem": SLA_MINUTOS, "hotelaria_min": META_HOTELARIA_MIN},
        "kpis": kpis,
        "comparativo": comparativo,
        "agora": agora_bloco,
        "tendencia_14d": _tendencia_14_dias(db, andar),
        "serie": _serie(enf, hot, periodo, inicio),
        "calor": {"enf": calor_enf, "hot": calor_hot, "dias": DIAS_SEMANA},
        "sla_prioridade": sla_prioridade,
        "faixas_espera": {"enf": distribuir(enf), "hot": distribuir(hot)},
        "status": {
            "enf": {s: sum(1 for c in enf if c["status"] == s) for s in ("pendente", "em_atendimento", "finalizado")},
            "hot": {s: sum(1 for c in hot if c["status"] == s) for s in ("pendente", "em_andamento", "finalizado")},
        },
        "por_categoria": por_categoria,
        "top_subcategorias": [{"categoria": k[0], "subcategoria": k[1], "prioridade": k[2], "total": v} for k, v in top_sub],
        "por_servico": por_servico,
        "origem_hot": {
            "direto": sum(1 for c in hot if c["origem"] != "enfermagem"),
            "enfermagem": sum(1 for c in hot if c["origem"] == "enfermagem"),
        },
        "confirmacoes_hot": confirmacoes,
        "por_andar": por_andar,
        "por_turno": por_turno,
        "satisfacao": {"enf": distribuicao(enf), "hot": distribuicao(hot)},
        "comentarios": comentarios[:8],
        "reincidencia": reincidencia,
        "mapa_leitos": mapa,
        "alertas": alertas[:12],
        "total_alertas": len(alertas),
        "atividade": eventos,
    }
