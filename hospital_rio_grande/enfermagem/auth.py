# -*- coding: utf-8 -*-
"""Autenticação da área administrativa do Chamador de Enfermagem.

Mesmo padrão já usado pela Central de Hotelaria (hotelaria/routes.py):
sessão simples de servidor + credenciais de teste configuráveis por
variável de ambiente. Fica num módulo próprio (em vez de dentro de
routes.py) porque tanto as PÁGINAS (enfermagem/routes.py) quanto a API
usada só pela equipe (enfermagem/api.py) precisam do mesmo decorator —
proteger só a tela e deixar a API aberta não protegeria de verdade os
dados dos pacientes.
"""
from functools import wraps

from flask import jsonify, redirect, render_template, request, session, url_for

from enfermagem.acesso import SESSAO_TOKEN, token_valido


def login_requerido(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("enfermagem_logado"):
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Login necessário."}), 401
            return redirect(url_for("enfermagem_pages.login", proximo=request.path))
        return f(*args, **kwargs)
    return decorated


def acesso_paciente_requerido(f):
    """Protege a ENTRADA da tela do paciente (item pedido pelo hospital:
    só quem escaneou o QR Code do leito pode abrir um chamado novo).

    Só é aplicado ao ponto de entrada (`/enfermagem/`) e à criação de
    chamado — o acompanhamento de um chamado já criado (`/acompanhar/...`)
    continua acessível mesmo que o acesso tenha sido revogado depois,
    para não cortar quem já está com um atendimento em andamento."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token_da_url = request.args.get("acesso")
        if token_da_url and token_valido(token_da_url):
            session[SESSAO_TOKEN] = token_da_url

        if not token_valido(session.get(SESSAO_TOKEN)):
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Acesso restrito. Use o QR Code fornecido pela equipe de enfermagem."}), 403
            return render_template(
                "erro.html", codigo=403,
                mensagem="Acesso restrito. Use o QR Code fornecido pela equipe de enfermagem para abrir um chamado.",
            ), 403
        return f(*args, **kwargs)
    return decorated
