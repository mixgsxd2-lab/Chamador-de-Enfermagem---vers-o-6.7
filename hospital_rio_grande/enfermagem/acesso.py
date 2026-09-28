# -*- coding: utf-8 -*-
"""Controle de acesso da tela do PACIENTE via QR Code (item pedido pelo
hospital: a tela onde o paciente abre um chamado não pode ficar exposta a
qualquer um que descubra a URL — só quem escaneia o QR Code afixado no
leito/quarto).

Como funciona:
  - Existe um único TOKEN válido por vez, guardado em `enfermagem_config`.
  - O QR Code (gerado em Configurações) aponta para a tela do paciente com
    esse token na query string (`?acesso=<token>`).
  - Ao abrir esse link, o token é validado e guardado na SESSÃO do
    navegador (cookie) — o paciente não precisa escanear de novo a cada
    chamado.
  - "Revogar acesso" (botão em Configurações) troca o token por um novo.
    Isso invalida instantaneamente todo QR Code/link já impresso ou
    compartilhado: a sessão de quem já tinha acesso guarda o token ANTIGO,
    que deixa de bater com o token atual no banco.
"""
import secrets

from db import get_db

CHAVE_TOKEN = "acesso_paciente_token"

# Chave usada na sessão do navegador do paciente para lembrar que ele já
# validou um token (evita pedir o QR Code de novo a cada tela/chamado).
SESSAO_TOKEN = "enfermagem_acesso_paciente"


def _gerar_token():
    return secrets.token_urlsafe(24)


def obter_token():
    """Token atual — cria um na primeira vez que for pedido."""
    db = get_db()
    row = db.execute("SELECT valor FROM enfermagem_config WHERE chave = ?", (CHAVE_TOKEN,)).fetchone()
    if row is not None:
        return row["valor"]

    token = _gerar_token()
    db.execute("INSERT INTO enfermagem_config (chave, valor) VALUES (?, ?)", (CHAVE_TOKEN, token))
    db.commit()
    return token


def revogar_acesso():
    """Gera um novo token, invalidando todo QR Code/link distribuído até
    agora. Retorna o novo token."""
    db = get_db()
    token = _gerar_token()
    db.execute(
        "INSERT INTO enfermagem_config (chave, valor) VALUES (?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (CHAVE_TOKEN, token),
    )
    db.commit()
    return token


def token_valido(token):
    return bool(token) and token == obter_token()
