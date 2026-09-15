# -*- coding: utf-8 -*-
"""Motor de prioridade do Chamador de Enfermagem.

A prioridade NÃO é apenas "quem chamou primeiro". Ela é recalculada a cada
consulta (não fica gravada no banco) a partir de quatro fatores:

  1. Gravidade da subopção escolhida pelo paciente (0-100), definida em
     enfermagem/constants.py — ex.: "Dor no peito" pesa mais que "Dor leve".
  2. Tempo de espera: quanto mais tempo um chamado aguarda, maior o bônus de
     prioridade que ele recebe (envelhecimento/"aging"), para que nenhum
     chamado fique esquecido — mesmo um de baixa gravidade eventualmente
     sobe de patamar se ninguém atender.
  3. Reincidência: leitos que chamaram várias vezes em um curto intervalo
     recebem um bônus, pois isso costuma indicar uma situação não resolvida.
  4. Chamado logo após um atendimento: se o mesmo leito abre um novo chamado
     pouco tempo depois de um atendimento anterior ter sido finalizado, é
     sinal de que o problema pode não ter sido realmente resolvido.

O resultado é convertido em uma das quatro faixas exigidas pela
especificação: 🔴 CRÍTICA, 🟠 ALTA, 🟡 MÉDIA, 🟢 BAIXA.

Importante: esta pontuação é uma priorização OPERACIONAL da fila de
atendimento. Ela nunca substitui a avaliação clínica da equipe de
enfermagem.
"""
from enfermagem.constants import (
    PRIORIDADE_LABELS, PRIORIDADE_EMOJI, CATEGORIA_OUTROS,
)

# ---------------------------------------------------------------------------
# Parâmetros do algoritmo (ajustáveis conforme protocolo do hospital)
# ---------------------------------------------------------------------------
JANELA_REINCIDENCIA_HORAS = 3
BONUS_POR_REINCIDENCIA = 12
BONUS_REINCIDENCIA_MAXIMO = 36

JANELA_POS_ATENDIMENTO_MIN = 20
BONUS_POS_ATENDIMENTO_RECENTE = 25

BONUS_POR_MINUTO_ESPERA = 1.5
BONUS_ESPERA_MAXIMO = 60

LIMIAR_CRITICA = 90
LIMIAR_ALTA = 65
LIMIAR_MEDIA = 40

# ---------------------------------------------------------------------------
# Meta operacional de tempo de espera (SLA) por faixa de prioridade — em
# minutos, desde a criação do chamado até o início do atendimento. É uma
# meta de GESTÃO DA FILA (ajuda a equipe a enxergar o que já está atrasado),
# não uma diretriz clínica; ajustável pelo hospital conforme seu protocolo.
# Usada para o indicador "chamados acima do tempo esperado" dos dashboards e
# para o destaque "Atenção imediata" da Central.
# ---------------------------------------------------------------------------
SLA_MINUTOS = {
    "critica": 10,
    "alta": 20,
    "media": 40,
    "baixa": 90,
}


def excedeu_sla(tier, tempo_espera_min):
    """True se `tempo_espera_min` já ultrapassa a meta de tempo da faixa de
    prioridade `tier`. `tempo_espera_min` deve ser o tempo até o início do
    atendimento (ou o tempo de espera corrente, se ainda pendente) — nunca o
    tempo total incluindo o atendimento em si."""
    limite = SLA_MINUTOS.get(tier)
    if limite is None or tempo_espera_min is None:
        return False
    return tempo_espera_min > limite


def _tier(score):
    if score >= LIMIAR_CRITICA:
        return "critica"
    if score >= LIMIAR_ALTA:
        return "alta"
    if score >= LIMIAR_MEDIA:
        return "media"
    return "baixa"


def calcular_prioridade(chamado, chamados_mesmo_leito=None, referencia=None):
    """Calcula a prioridade de um chamado (pendente, em atendimento ou já
    finalizado — usado no histórico para mostrar a faixa que ele atingiu).

    chamado: instância de ChamadoEnfermagem.
    chamados_mesmo_leito: outras chamadas do MESMO leito nas últimas
        `JANELA_REINCIDENCIA_HORAS` horas (sem incluir `chamado`), usadas
        para os bônus de reincidência e pós-atendimento recente.
    referencia: datetime usado como "agora" para calcular o tempo de
        espera. Por padrão: agora() para chamados ativos, ou o horário em
        que o chamado foi assumido/finalizado para chamados já concluídos
        (assim o histórico mostra a prioridade que ele realmente atingiu
        antes de ser atendido, sem continuar "envelhecendo" depois).
    """
    from timeutils import agora, duracao_minutos

    if chamado.categoria == CATEGORIA_OUTROS:
        # Nunca deveria acontecer (Outros não entra na fila de enfermagem),
        # mas devolvemos algo seguro em vez de estourar um erro.
        return {"score": 0, "tier": "baixa", "tempo_espera_min": 0}

    chamados_mesmo_leito = chamados_mesmo_leito or []

    if referencia is None:
        if chamado.status == "finalizado":
            referencia = chamado.inicio_atendimento or chamado.finalizado_em or agora()
        elif chamado.status == "em_atendimento":
            referencia = chamado.inicio_atendimento or agora()
        else:
            referencia = agora()

    tempo_espera_min = duracao_minutos(chamado.criado_em, referencia) or 0.0

    score = float(chamado.gravidade_base)

    # 2. Envelhecimento por tempo de espera.
    bonus_espera = min(tempo_espera_min * BONUS_POR_MINUTO_ESPERA, BONUS_ESPERA_MAXIMO)
    score += bonus_espera

    # 3. Reincidência do leito na janela recente.
    reincidencias = len(chamados_mesmo_leito)
    bonus_reincidencia = min(reincidencias * BONUS_POR_REINCIDENCIA, BONUS_REINCIDENCIA_MAXIMO)
    score += bonus_reincidencia

    # 4. Novo chamado logo após um atendimento anterior finalizado.
    bonus_pos_atendimento = 0
    for outro in chamados_mesmo_leito:
        if outro.status == "finalizado" and outro.finalizado_em and chamado.criado_em:
            minutos_depois = (chamado.criado_em - outro.finalizado_em).total_seconds() / 60
            if 0 <= minutos_depois <= JANELA_POS_ATENDIMENTO_MIN:
                bonus_pos_atendimento = BONUS_POS_ATENDIMENTO_RECENTE
                break
    score += bonus_pos_atendimento

    score = round(min(score, 150), 1)
    tier = _tier(score)

    return {
        "score": score,
        "tier": tier,
        "tier_label": PRIORIDADE_LABELS[tier],
        "tier_emoji": PRIORIDADE_EMOJI[tier],
        "tempo_espera_min": round(tempo_espera_min, 1),
        "bonus_espera": round(bonus_espera, 1),
        "bonus_reincidencia": bonus_reincidencia,
        "bonus_pos_atendimento": bonus_pos_atendimento,
    }
