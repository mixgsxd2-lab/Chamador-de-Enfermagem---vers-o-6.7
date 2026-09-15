# -*- coding: utf-8 -*-
"""Andares e leitos do hospital — dado fixo compartilhado por Enfermagem E
Hotelaria (antes vivia só em `enfermagem/constants.py`; a Hotelaria aceitava
leito como texto livre, sem validação).

Unificar os dois módulos aqui em um só lugar:
  - evita que o paciente da Hotelaria digite um leito com erro de digitação;
  - permite validar leito/andar da mesma forma nos dois sistemas;
  - habilita métricas de "distribuição por andar" também no dashboard da
    Hotelaria (antes impossível: a tabela nem tinha essa coluna).

`enfermagem/constants.py` reexporta `ANDARES`/`leito_valido` a partir daqui
para não quebrar nenhum import já existente no restante do código.
"""

ANDARES = {
    "1º Andar": [f"10{i}" if i < 10 else f"1{i}" for i in range(1, 13)],
    "2º Andar": [f"20{i}" if i < 10 else f"2{i}" for i in range(1, 13)],
    "3º Andar": [f"30{i}" if i < 10 else f"3{i}" for i in range(1, 13)],
}


def leito_valido(andar, leito):
    return andar in ANDARES and leito in ANDARES[andar]


def andar_do_leito(leito):
    """Descobre o andar a partir do número do leito, quando ele corresponde
    a um leito oficial conhecido (usado para preencher `andar` em chamados
    que só têm o leito, sem exigir que o andar seja informado à parte)."""
    for andar, leitos in ANDARES.items():
        if leito in leitos:
            return andar
    return None
