# -*- coding: utf-8 -*-
from flask import Blueprint, abort, current_app, flash, redirect, render_template, request, session, url_for

from db import get_db
from ratelimit import permitido as rate_limit_permitido
from enfermagem.auth import login_requerido
from enfermagem.constants import ANDARES, CATEGORIAS

pages_bp = Blueprint("enfermagem_pages", __name__, url_prefix="/enfermagem")


def _categorias_publicas():
    """Versão das categorias sem os pesos de gravidade (uso interno do
    motor de prioridade) — só o que a tela do paciente precisa exibir."""
    return {
        nome: {
            "cor": dados["cor"],
            "icone": dados["icone"],
            "descricao": dados["descricao"],
            "opcoes": [texto for texto, _peso in dados["opcoes"]],
        }
        for nome, dados in CATEGORIAS.items()
    }


@pages_bp.route("/")
def paciente_inicio():
    return render_template(
        "enfermagem/paciente.html",
        andares=ANDARES,
        categorias=_categorias_publicas(),
    )


@pages_bp.route("/acompanhar-hotelaria/<int:chamado_id>")
def acompanhar_hotelaria(chamado_id):
    """Acompanhamento de um pedido de Hotelaria feito pelo paciente (categoria
    "Outros") — vive aqui, na área do paciente da Enfermagem, no lugar da
    antiga tela /hotelaria/paciente."""
    db = get_db()
    row = db.execute("SELECT id FROM hotelaria_chamados WHERE id = ?", (chamado_id,)).fetchone()
    if row is None:
        abort(404, description="Chamado não encontrado.")
    return render_template("enfermagem/acompanhar_hotelaria.html", chamado_id=chamado_id)


@pages_bp.route("/acompanhar/<int:chamado_id>")
def acompanhar(chamado_id):
    db = get_db()
    row = db.execute("SELECT id FROM enfermagem_chamados WHERE id = ?", (chamado_id,)).fetchone()
    if row is None:
        abort(404, description="Chamado não encontrado.")
    return render_template("enfermagem/acompanhar.html", chamado_id=chamado_id)


# ---------------------------------------------------------------------------
# Autenticação da área administrativa (mesmo padrão da Central de
# Hotelaria — ver enfermagem/auth.py e hotelaria/routes.py).
# ---------------------------------------------------------------------------
@pages_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        if not rate_limit_permitido(f"enfermagem:{request.remote_addr}"):
            flash("Muitas tentativas de login. Aguarde alguns minutos e tente novamente.")
            return render_template("enfermagem/login.html"), 429

        usuario = request.form.get("usuario", "").strip()
        senha = request.form.get("senha", "").strip()
        if (
            usuario == current_app.config["ENFERMAGEM_USUARIO_TESTE"]
            and senha == current_app.config["ENFERMAGEM_SENHA_TESTE"]
        ):
            session["enfermagem_logado"] = True
            session["enfermagem_usuario"] = usuario
            proximo = request.args.get("proximo") or url_for("enfermagem_pages.central")
            return redirect(proximo)
        flash("Usuário ou senha inválidos.")
    return render_template("enfermagem/login.html")


@pages_bp.route("/logout")
def logout():
    session.pop("enfermagem_logado", None)
    session.pop("enfermagem_usuario", None)
    return redirect(url_for("portal.inicio"))


@pages_bp.route("/dashboard")
@login_requerido
def dashboard():
    return render_template(
        "enfermagem/dashboard.html",
        andares=list(ANDARES.keys()),
        categorias=list(CATEGORIAS.keys()),
    )


@pages_bp.route("/central")
@login_requerido
def central():
    return render_template(
        "enfermagem/central.html",
        andares=list(ANDARES.keys()),
        categorias=list(CATEGORIAS.keys()),
    )


@pages_bp.route("/historico")
@login_requerido
def historico():
    return render_template(
        "enfermagem/historico.html",
        andares=list(ANDARES.keys()),
        categorias=list(CATEGORIAS.keys()),
    )
