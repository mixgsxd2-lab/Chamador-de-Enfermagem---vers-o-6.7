# -*- coding: utf-8 -*-
"""Horário oficial do sistema — compartilhado por Enfermagem e Hotelaria.

Regra importante: TODOS os timestamps gravados no banco (criação, início de
atendimento, finalização, etc.) são calculados aqui, no backend, sempre no
fuso America/Fortaleza. O relógio do dispositivo do paciente ou do
profissional NUNCA é usado como fonte de horário — isso garante que o tempo
de espera, o tempo de atendimento e a ordenação por prioridade sejam
consistentes mesmo com vários dispositivos diferentes usando o sistema ao
mesmo tempo.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Fortaleza")


def agora():
    """Horário oficial do sistema, sem tzinfo (mais simples de gravar e
    comparar no SQLite, que não guarda fuso horário)."""
    return datetime.now(FUSO).replace(tzinfo=None)


def para_texto(dt):
    """Converte um datetime para texto ISO, para gravar no SQLite."""
    if dt is None:
        return None
    return dt.isoformat(sep=" ", timespec="seconds")


def parse_dt(texto):
    """Converte o texto ISO gravado no SQLite de volta para datetime."""
    if not texto:
        return None
    return datetime.fromisoformat(texto)


def formata_data_br(dt):
    if dt is None:
        return None
    return dt.strftime("%d/%m/%Y %H:%M")


def formata_hora(dt):
    if dt is None:
        return None
    return dt.strftime("%H:%M")


def formata_duracao(inicio, fim=None):
    """'Xh Ymin' ou 'Ymin' entre dois datetimes (fim default = agora())."""
    if inicio is None:
        return None
    if fim is None:
        fim = agora()
    segundos = int((fim - inicio).total_seconds())
    if segundos < 0:
        segundos = 0
    minutos_totais = segundos // 60
    horas, minutos = divmod(minutos_totais, 60)
    if horas > 0:
        return f"{horas}h {minutos:02d}min"
    return f"{minutos}min"


def duracao_minutos(inicio, fim=None):
    if inicio is None:
        return None
    if fim is None:
        fim = agora()
    return round((fim - inicio).total_seconds() / 60, 1)


# ---------------------------------------------------------------------------
# Helpers de período/agregação — compartilhados por Enfermagem e Hotelaria.
# Antes cada módulo tinha sua própria cópia quase idêntica destas funções
# (enfermagem/api.py::_limite_periodo, hotelaria/routes.py::_limite_periodo e
# o agrupamento "por_dia" repetido em enfermagem/api.py::metricas e
# hotelaria/routes.py::api_dashboard_resumo).
# ---------------------------------------------------------------------------
def limite_periodo(periodo):
    """Converte um atalho de período ('hoje'/'7dias'/'30dias') no limite
    inferior (datetime) de 'criado_em' a considerar. `None` para qualquer
    outro valor (sem filtro de período = histórico inteiro)."""
    hoje = agora().replace(hour=0, minute=0, second=0, microsecond=0)
    if periodo == "hoje":
        return hoje
    if periodo == "7dias":
        return hoje - timedelta(days=6)
    if periodo == "30dias":
        return hoje - timedelta(days=29)
    return None


def janela_comparativa_anterior(periodo):
    """Para os atalhos de período conhecidos, devolve (inicio, fim) da janela
    IMEDIATAMENTE ANTERIOR à atual, com exatamente a mesma duração — usado
    para os comparativos "vs. período anterior" dos dashboards (ex.: "+12%
    vs. ontem"). Deliberadamente não inventa uma base de comparação: se o
    período não é um atalho conhecido (ex.: sem filtro = histórico inteiro,
    onde "período anterior" não tem significado claro), devolve `None` e o
    comparativo simplesmente não é calculado pelo chamador."""
    inicio_atual = limite_periodo(periodo)
    if inicio_atual is None:
        return None
    duracao = agora() - inicio_atual
    if duracao.total_seconds() <= 0:
        return None
    return (inicio_atual - duracao, inicio_atual)


def agrupar_por_dia(datas):
    """Agrupa um iterável de `datetime` (valores `None` são ignorados) em
    contagem por dia no formato 'DD/MM', ordenado cronologicamente (não
    alfabeticamente — "05/01" precisa vir antes de "20/01" mesmo em ordem de
    string "05" < "20", mas "05/12" tem que vir DEPOIS de "20/01")."""
    por_dia = {}
    for dt in datas:
        if dt is None:
            continue
        chave = dt.strftime("%d/%m")
        por_dia[chave] = por_dia.get(chave, 0) + 1
    return dict(sorted(por_dia.items(), key=lambda item: (item[0][3:], item[0][:2])))


def agrupar_por_hora(datas):
    """Agrupa um iterável de `datetime` por hora do dia (0-23) — usado para
    identificar horários de maior demanda. Sempre devolve as 24 posições,
    mesmo com contagem zero, para o gráfico ter um eixo estável."""
    contagem = [0] * 24
    for dt in datas:
        if dt is not None:
            contagem[dt.hour] += 1
    return contagem
