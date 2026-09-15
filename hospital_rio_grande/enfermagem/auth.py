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

from flask import jsonify, redirect, request, session, url_for


def login_requerido(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("enfermagem_logado"):
            if request.path.startswith("/api/"):
                return jsonify({"erro": "Login necessário."}), 401
            return redirect(url_for("enfermagem_pages.login", proximo=request.path))
        return f(*args, **kwargs)
    return decorated
