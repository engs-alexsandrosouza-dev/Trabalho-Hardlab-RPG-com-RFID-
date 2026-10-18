
/* =====================================================
   RPG RFID — CRÔNICAS DO REINO
   Arquivo: script.js

   Servidor: ESP32
   Estado do jogo: GET /estado
   Histórias: GET e POST /historias
   ===================================================== */

"use strict";

/* =====================================================
   1. CONFIGURAÇÕES
   ===================================================== */

const CONFIG = {
    endpoint: "/estado",
    intervaloAtualizacao: 700,
    timeoutRequisicao: 4000,
    maxEventosHistorico: 30,
    vidaMaximaPadrao: 3,
    limiteHistoriaBytes: 3500
};

/* =====================================================
   2. ELEMENTOS HTML
   ===================================================== */

const elementos = {
    conexao: document.querySelector(".conexao"),
    statusConexao: document.getElementById("status-conexao"),

    numeroCapitulo: document.getElementById("numero-capitulo"),
    tituloCapitulo: document.getElementById("titulo-capitulo"),
    subtituloCapitulo: document.getElementById("subtitulo-capitulo"),
    textoNarrativa: document.getElementById("texto-narrativa"),
    mensagemEvento: document.getElementById("mensagem-evento"),
    instrucaoJogador: document.getElementById("instrucao-jogador"),

    cartaoP1: document.getElementById("cartao-personagem-1"),
    vidaP1: document.getElementById("vida-personagem-1"),
    barraP1: document.getElementById("barra-vida-personagem-1"),
    progressoP1: document.getElementById("progresso-vida-personagem-1"),

    cartaoP2: document.getElementById("cartao-personagem-2"),
    vidaP2: document.getElementById("vida-personagem-2"),
    barraP2: document.getElementById("barra-vida-personagem-2"),
    progressoP2: document.getElementById("progresso-vida-personagem-2"),

    cartaoInimigo: document.querySelector(".cartao-inimigo"),
    nomeInimigo: document.getElementById("nome-inimigo"),
    vidaInimigo: document.getElementById("vida-inimigo"),
    barraInimigo: document.getElementById("barra-vida-inimigo"),
    progressoInimigo: document.getElementById("progresso-vida-inimigo"),
    statusInimigo: document.getElementById("status-inimigo"),

    suprimentos: document.getElementById("quantidade-suprimentos"),
    personagemSelecionado: document.getElementById("personagem-selecionado"),

    statusLeitor: document.getElementById("status-leitor"),
    ultimoUID: document.getElementById("ultimo-uid"),
    listaEventos: document.getElementById("lista-eventos")
};

/* =====================================================
   3. CONTROLE INTERNO
   ===================================================== */

const controle = {
    ultimoEventoId: null,
    narrativaAtual: null,
    primeiroCarregamento: true,
    conectado: null,
    monitoramentoAtivo: false
};

/* =====================================================
   4. FUNÇÕES AUXILIARES
   ===================================================== */

function limitar(valor, minimo, maximo) {
    return Math.min(Math.max(valor, minimo), maximo);
}

function inteiroSeguro(valor, padrao = 0) {
    if (valor === null || valor === undefined || valor === "") {
        return padrao;
    }

    const numero = Number(valor);

    return Number.isSafeInteger(numero)
        ? numero
        : padrao;
}

function definirTexto(elemento, texto) {
    if (!elemento) return;

    const valor = String(texto ?? "");

    if (elemento.textContent !== valor) {
        elemento.textContent = valor;
    }
}

function destacarCartao(elemento) {
    if (!elemento) return;

    elemento.classList.remove("evento-destaque");
    void elemento.offsetWidth;
    elemento.classList.add("evento-destaque");
}

function atualizarBarra(
    texto,
    barra,
    preenchimento,
    vidaAtual,
    vidaMaxima
) {
    const maxima = Math.max(
        1,
        inteiroSeguro(vidaMaxima, 3)
    );

    const atual = limitar(
        inteiroSeguro(vidaAtual),
        0,
        maxima
    );

    const porcentagem = (atual / maxima) * 100;

    definirTexto(texto, `${atual} / ${maxima}`);

    if (preenchimento) {
        preenchimento.style.width = `${porcentagem}%`;
    }

    if (barra) {
        barra.setAttribute("aria-valuemax", String(maxima));
        barra.setAttribute("aria-valuenow", String(atual));
    }
}

/* =====================================================
   5. CONEXÃO COM O ESP32
   ===================================================== */

function atualizarConexao(conectado) {
    if (controle.conectado === conectado) return;

    controle.conectado = conectado;

    elementos.conexao?.classList.toggle(
        "conectado",
        conectado
    );

    elementos.conexao?.classList.toggle(
        "desconectado",
        !conectado
    );

    definirTexto(
        elementos.statusConexao,
        conectado
            ? "Conectado ao ESP32"
            : "Sem comunicação com o ESP32"
    );
}

async function buscarEstado() {
    const controlador = new AbortController();

    const timeout = setTimeout(() => {
        controlador.abort();
    }, CONFIG.timeoutRequisicao);

    try {
        const resposta = await fetch(CONFIG.endpoint, {
            method: "GET",
            cache: "no-store",
            signal: controlador.signal
        });

        if (!resposta.ok) {
            throw new Error(`HTTP ${resposta.status}`);
        }

        const dados = await resposta.json();

        if (
            !dados ||
            typeof dados !== "object" ||
            Array.isArray(dados)
        ) {
            throw new Error("Estado JSON inválido.");
        }

        return dados;

    } finally {
        clearTimeout(timeout);
    }
}

/* =====================================================
   6. PERSONAGENS
   ===================================================== */

function atualizarPersonagens(dados) {
    const vidaMaxima =
        dados.vidaMaxima ?? CONFIG.vidaMaximaPadrao;

    atualizarBarra(
        elementos.vidaP1,
        elementos.barraP1,
        elementos.progressoP1,
        dados.vidasPersonagem1,
        vidaMaxima
    );

    atualizarBarra(
        elementos.vidaP2,
        elementos.barraP2,
        elementos.progressoP2,
        dados.vidasPersonagem2,
        vidaMaxima
    );

    const selecionado = inteiroSeguro(
        dados.personagemSelecionado,
        -1
    );

    // -1 = nenhum
    //  0 = personagem 1
    //  1 = personagem 2

    elementos.cartaoP1?.classList.toggle(
        "selecionado",
        selecionado === 0
    );

    elementos.cartaoP2?.classList.toggle(
        "selecionado",
        selecionado === 1
    );

    const nomes = {
        0: "Personagem I",
        1: "Personagem II"
    };

    definirTexto(
        elementos.personagemSelecionado,
        nomes[selecionado] ?? "Nenhum"
    );
}

/* =====================================================
   7. INIMIGO
   ===================================================== */

function atualizarInimigo(dados) {
    const vida = Math.max(
        0,
        inteiroSeguro(dados.vidaInimigo)
    );

    const vidaMaxima = Math.max(
        1,
        inteiroSeguro(dados.vidaMaximaInimigo, 3)
    );

    atualizarBarra(
        elementos.vidaInimigo,
        elementos.barraInimigo,
        elementos.progressoInimigo,
        vida,
        vidaMaxima
    );

    if (typeof dados.nomeInimigo === "string") {
        definirTexto(
            elementos.nomeInimigo,
            dados.nomeInimigo
        );
    }

    const derrotado = vida === 0;

    elementos.cartaoInimigo?.classList.toggle(
        "derrotado",
        derrotado
    );

    definirTexto(
        elementos.statusInimigo,
        derrotado
            ? "Inimigo derrotado"
            : "Inimigo em combate"
    );
}

/* =====================================================
   8. RECURSOS
   ===================================================== */

function atualizarRecursos(dados) {
    const suprimentos = Math.max(
        0,
        inteiroSeguro(dados.suprimentos)
    );

    definirTexto(
        elementos.suprimentos,
        suprimentos
    );
}

/* =====================================================
   9. NARRATIVA
   ===================================================== */

function criarParagrafos(texto) {
    const fragmento = document.createDocumentFragment();

    const paragrafos = String(texto ?? "")
        .split(/\n\s*\n/)
        .map(paragrafo => paragrafo.trim())
        .filter(Boolean);

    for (const conteudo of paragrafos) {
        const p = document.createElement("p");

        // Segurança: texto vindo do ESP32 não
        // deve ser interpretado como HTML.
        p.textContent = conteudo;

        fragmento.appendChild(p);
    }

    return fragmento;
}

function atualizarNarrativa(dados) {
    const capitulo = dados.capitulo;

    if (!capitulo || typeof capitulo !== "object") {
        return;
    }

    // Atualiza títulos mesmo sem mudança do ID.
    definirTexto(
        elementos.numeroCapitulo,
        capitulo.numero ?? "Capítulo I"
    );

    definirTexto(
        elementos.tituloCapitulo,
        capitulo.titulo ?? "O Despertar"
    );

    definirTexto(
        elementos.subtituloCapitulo,
        capitulo.subtitulo ?? ""
    );

    const narrativa = String(capitulo.texto ?? "");

    if (controle.narrativaAtual !== narrativa) {
        controle.narrativaAtual = narrativa;

        if (elementos.textoNarrativa) {
            elementos.textoNarrativa.replaceChildren(
                criarParagrafos(narrativa)
            );

            elementos.textoNarrativa.classList.remove(
                "atualizando"
            );

            void elementos.textoNarrativa.offsetWidth;

            elementos.textoNarrativa.classList.add(
                "atualizando"
            );
        }
    }

    if (typeof capitulo.instrucao === "string") {
        definirTexto(
            elementos.instrucaoJogador,
            capitulo.instrucao
        );
    }
}

/* =====================================================
   10. HISTÓRICO DE EVENTOS
   ===================================================== */

function registrarEvento(mensagem) {
    if (!elementos.listaEventos || !mensagem) {
        return;
    }

    const item = document.createElement("li");

    item.textContent = String(mensagem);

    elementos.listaEventos.prepend(item);

    while (
        elementos.listaEventos.children.length >
        CONFIG.maxEventosHistorico
    ) {
        elementos.listaEventos.lastElementChild.remove();
    }
}

function processarEvento(dados) {
    const evento = dados.evento;

    if (!evento || typeof evento !== "object") {
        return;
    }

    const id = evento.id;

    if (!Number.isSafeInteger(id) || id < 0) {
        return;
    }

    // Reinicialização do ESP32 pode reiniciar
    // também a contagem de eventos.
    if (
        controle.ultimoEventoId !== null &&
        id < controle.ultimoEventoId
    ) {
        controle.ultimoEventoId = null;
    }

    if (id === controle.ultimoEventoId) {
        return;
    }

    controle.ultimoEventoId = id;

    if (typeof evento.mensagem === "string") {
        definirTexto(
            elementos.mensagemEvento,
            evento.mensagem
        );

        if (!controle.primeiroCarregamento) {
            registrarEvento(evento.mensagem);
        }
    }

    if (typeof evento.uid === "string") {
        definirTexto(
            elementos.ultimoUID,
            evento.uid
        );
    }

    definirTexto(
        elementos.statusLeitor,
        "Última carta processada"
    );

    if (controle.primeiroCarregamento) {
        return;
    }

    switch (evento.tipo) {
        case "PERSONAGEM_1":
            destacarCartao(elementos.cartaoP1);
            break;

        case "PERSONAGEM_2":
            destacarCartao(elementos.cartaoP2);
            break;

        case "CURA":
            if (dados.personagemSelecionado === 0) {
                destacarCartao(elementos.cartaoP1);
            } else if (dados.personagemSelecionado === 1) {
                destacarCartao(elementos.cartaoP2);
            }
            break;

        case "BOMBA":
        case "FEITICO":
        case "VITORIA":
            destacarCartao(elementos.cartaoInimigo);
            break;
    }
}

/* =====================================================
   11. ATUALIZAÇÃO COMPLETA
   ===================================================== */

function atualizarInterface(dados) {
    atualizarPersonagens(dados);
    atualizarInimigo(dados);
    atualizarRecursos(dados);
    atualizarNarrativa(dados);
    processarEvento(dados);

    controle.primeiroCarregamento = false;
}

/* =====================================================
   12. MONITORAMENTO AUTOMÁTICO
   ===================================================== */

async function cicloAtualizacao() {
    if (!controle.monitoramentoAtivo) return;

    try {
        const dados = await buscarEstado();

        atualizarConexao(true);
        atualizarInterface(dados);

    } catch (erro) {
        atualizarConexao(false);

        console.warn(
            "Falha na comunicação com o ESP32:",
            erro.message
        );

    } finally {
        if (controle.monitoramentoAtivo) {
            setTimeout(
                cicloAtualizacao,
                CONFIG.intervaloAtualizacao
            );
        }
    }
}

function iniciarJogo() {
    if (controle.monitoramentoAtivo) return;

    controle.monitoramentoAtivo = true;

    console.log("Crônicas do Reino iniciado.");

    cicloAtualizacao();
}

/* =====================================================
   13. MENU LATERAL E HISTÓRIAS
   ===================================================== */

function iniciarMenuHistorias() {
    const botaoMenu =
        document.getElementById("botao-menu");

    const fecharMenu =
        document.getElementById("fechar-menu");

    const menu =
        document.getElementById("menu-historias");

    const fundoMenu =
        document.getElementById("fundo-menu");

    const mensagem =
        document.getElementById("mensagem-salvamento");

    if (
        !botaoMenu ||
        !fecharMenu ||
        !menu ||
        !fundoMenu
    ) {
        console.warn("Menu lateral não encontrado.");
        return;
    }

    let focoAnterior = null;

    /* ---------------------------------------
       ABRIR E FECHAR MENU
       --------------------------------------- */

    function abrirMenu() {
        focoAnterior = document.activeElement;

        menu.hidden = false;
        fundoMenu.hidden = false;

        document.body.classList.add("menu-aberto");

        botaoMenu.setAttribute(
            "aria-expanded",
            "true"
        );

        fecharMenu.focus();
    }

    function ocultarMenu() {
        menu.hidden = true;
        fundoMenu.hidden = true;

        document.body.classList.remove("menu-aberto");

        botaoMenu.setAttribute(
            "aria-expanded",
            "false"
        );

        focoAnterior?.focus();
    }

    botaoMenu.addEventListener("click", abrirMenu);
    fecharMenu.addEventListener("click", ocultarMenu);
    fundoMenu.addEventListener("click", ocultarMenu);

    document.addEventListener("keydown", evento => {
        if (menu.hidden) return;

        if (evento.key === "Escape") {
            ocultarMenu();
            return;
        }

        if (evento.key !== "Tab") return;

        const controles = Array.from(
            menu.querySelectorAll(
                'button:not([disabled]), textarea:not([disabled])'
            )
        );

        if (controles.length === 0) return;

        const primeiro = controles[0];
        const ultimo = controles[controles.length - 1];

        if (
            evento.shiftKey &&
            document.activeElement === primeiro
        ) {
            evento.preventDefault();
            ultimo.focus();
        } else if (
            !evento.shiftKey &&
            document.activeElement === ultimo
        ) {
            evento.preventDefault();
            primeiro.focus();
        }
    });

    /* ---------------------------------------
       EDITORES DE HISTÓRIAS
       --------------------------------------- */

    const historias = {
        rpg: {
            editor: document.getElementById(
                "editor-historia-rpg"
            ),
            visualizacao: document.getElementById(
                "visualizacao-rpg"
            )
        },

        p1: {
            editor: document.getElementById(
                "editor-historia-p1"
            ),
            visualizacao: document.getElementById(
                "visualizacao-p1"
            )
        },

        p2: {
            editor: document.getElementById(
                "editor-historia-p2"
            ),
            visualizacao: document.getElementById(
                "visualizacao-p2"
            )
        }
    };

    const revisoes = {
        rpg: 0,
        p1: 0,
        p2: 0
    };

    const salvando = new Set();
    const codificador = new TextEncoder();

    function exibirMensagem(texto) {
        definirTexto(mensagem, texto);
    }

    function atualizarVisualizacao(historia, texto) {
        if (!historia?.visualizacao) return;

        definirTexto(
            historia.visualizacao,
            texto.trim() || "Nenhuma história registrada."
        );
    }

    for (const [tipo, historia] of Object.entries(historias)) {
        historia.editor?.addEventListener("input", () => {
            revisoes[tipo]++;
        });
    }

    /* ---------------------------------------
       SALVAR HISTÓRIA NO ESP32
       --------------------------------------- */

    async function salvarHistoria(tipo) {
        const historia = historias[tipo];

        if (
            !historia?.editor ||
            !historia.visualizacao ||
            salvando.has(tipo)
        ) {
            return;
        }

        const texto = historia.editor.value;

        const tamanho = codificador.encode(texto).length;

        if (tamanho > CONFIG.limiteHistoriaBytes) {
            exibirMensagem(
                "A história ultrapassa o limite de 3.500 bytes."
            );
            return;
        }

        const botao = document.querySelector(
            `.botao-salvar[data-historia="${tipo}"]`
        );

        salvando.add(tipo);

        if (botao) {
            botao.disabled = true;
        }

        const revisaoAoSalvar = revisoes[tipo];

        try {
            const dados = new URLSearchParams({
                tipo: tipo,
                texto: texto
            });

            const resposta = await fetch("/historias", {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body: dados.toString()
            });

            if (!resposta.ok) {
                throw new Error(
                    `Erro HTTP ${resposta.status}`
                );
            }

            atualizarVisualizacao(historia, texto);

            if (revisoes[tipo] !== revisaoAoSalvar) {
                exibirMensagem(
                    "História salva, mas há alterações novas ainda não salvas."
                );
            } else {
                exibirMensagem(
                    "✦ História salva no ESP32!"
                );
            }

        } catch (erro) {
            console.error(
                "Erro ao salvar história:",
                erro
            );

            exibirMensagem(
                "Não foi possível salvar a história no ESP32."
            );

        } finally {
            salvando.delete(tipo);

            if (botao) {
                botao.disabled = false;
            }
        }
    }

    /* ---------------------------------------
       CARREGAR HISTÓRIAS DO ESP32
       --------------------------------------- */

    async function carregarHistorias() {
        const revisoesIniciais = { ...revisoes };

        try {
            const resposta = await fetch("/historias", {
                method: "GET",
                cache: "no-store"
            });

            if (!resposta.ok) {
                throw new Error(
                    `Erro HTTP ${resposta.status}`
                );
            }

            const dados = await resposta.json();

            if (
                !dados ||
                typeof dados !== "object" ||
                Array.isArray(dados)
            ) {
                throw new Error("Resposta inválida.");
            }

            for (
                const [tipo, historia]
                of Object.entries(historias)
            ) {
                if (
                    !historia.editor ||
                    !historia.visualizacao
                ) {
                    continue;
                }

                const texto =
                    typeof dados[tipo] === "string"
                        ? dados[tipo]
                        : "";

                // Evita perder o texto digitado enquanto
                // a requisição estava em andamento.
                if (
                    revisoes[tipo] !== revisoesIniciais[tipo] ||
                    salvando.has(tipo)
                ) {
                    continue;
                }

                historia.editor.value = texto;

                atualizarVisualizacao(
                    historia,
                    texto
                );
            }

        } catch (erro) {
            console.error(
                "Erro ao carregar histórias:",
                erro
            );

            exibirMensagem(
                "Não foi possível carregar as histórias do ESP32."
            );
        }
    }

    /* ---------------------------------------
       BOTÕES DE SALVAR
       --------------------------------------- */

    document.querySelectorAll(".botao-salvar")
        .forEach(botao => {
            botao.addEventListener("click", () => {
                const tipo = botao.dataset.historia;
                salvarHistoria(tipo);
            });
        });

    carregarHistorias();
}

/* =====================================================
   14. INICIALIZAÇÃO GERAL
   ===================================================== */

document.addEventListener("DOMContentLoaded", () => {
    iniciarJogo();
    iniciarMenuHistorias();
});
