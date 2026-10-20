
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

    definirTexto(
        document.getElementById("detail-v1"),
        elementos.vidaP1?.textContent
    );

    definirTexto(
        document.getElementById("detail-v2"),
        elementos.vidaP2?.textContent
    );

    const selecionado = inteiroSeguro(
        dados.personagemSelecionado,
        -1
    );

    // -1 = nenhum
    //  0 = personagem 1
    //  1 = personagem 2

    elementos.cartaoP1?.classList.toggle(
        "active",
        selecionado === 0
    );

    elementos.cartaoP2?.classList.toggle(
        "active",
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

    definirTexto(
        document.getElementById("detail-ve"),
        elementos.vidaInimigo?.textContent
    );

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
   13. NAVEGAÇÃO GÓTICA, CÓDICES E HISTÓRIAS
   ===================================================== */

function iniciarMenuHistorias() {

    const $ = id => document.getElementById(id);

    const views = {
        jornada: "ATO I — O DESPERTAR",
        arquivos: "BIBLIOTECA DOS PERGAMINHOS",
        visualizar: "A HISTÓRIA SELADA",
        personagens: "OS ESCOLHIDOS"
    };

    const docs = {
        rpg: [
            "TOMO I · O REINO",
            "Memórias de Eliria",
            "Inscreva a história e as lendas de Eliria."
        ],
        p1: [
            "TOMO II · O PRIMEIRO ESCOLHIDO",
            "O Juramento de Ferro",
            "Registre a origem do primeiro aventureiro."
        ],
        p2: [
            "TOMO III · O SEGUNDO ESCOLHIDO",
            "O Pacto Velado",
            "Registre a origem do segundo aventureiro."
        ]
    };

    const revisoes = {
        rpg: 0,
        p1: 0,
        p2: 0
    };

    const salvando = new Set();
    const encoder = new TextEncoder();

    let atual = "rpg";

    function mensagem(texto) {
        definirTexto($("mensagem-salvamento"), texto);
    }

    /* ---------------------------------------
       NAVEGAÇÃO ENTRE ABAS
       --------------------------------------- */

    function mostrar(nome) {

        document.querySelectorAll("[data-view]")
            .forEach(botao => {
                botao.classList.toggle(
                    "active",
                    botao.dataset.view === nome
                );
            });

        document.querySelectorAll(".section")
            .forEach(secao => {
                secao.classList.toggle(
                    "active",
                    secao.id === nome
                );
            });

        definirTexto(
            $("top-label"),
            views[nome] || "ELIRIA"
        );

        if (nome === "visualizar") {
            carregarVisualizacao();
        }

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }

    document.querySelectorAll("[data-view]")
        .forEach(botao => {
            botao.addEventListener("click", () => {
                mostrar(botao.dataset.view);
            });
        });

    /* ---------------------------------------
       SELEÇÃO DOS PERGAMINHOS
       --------------------------------------- */

    document.querySelectorAll("[data-doc]")
        .forEach(botao => {

            botao.addEventListener("click", () => {

                atual = botao.dataset.doc;

                document.querySelectorAll("[data-doc]")
                    .forEach(item => {
                        item.classList.toggle(
                            "active",
                            item === botao
                        );
                    });

                document.querySelectorAll(".archive-panel")
                    .forEach(painel => {
                        painel.hidden =
                            painel.id !== `panel-${atual}`;
                    });

                const [label, title, desc] = docs[atual];

                definirTexto($("doc-label"), label);
                definirTexto($("doc-title"), title);
                definirTexto($("doc-desc"), desc);

            });

        });

    /* ---------------------------------------
       REGISTRO DE EDIÇÕES
       --------------------------------------- */

    for (const tipo of Object.keys(revisoes)) {

        $("editor-historia-" + tipo)
            ?.addEventListener("input", () => {
                revisoes[tipo]++;
            });

    }

    /* ---------------------------------------
       LEITURA DE JSON
       --------------------------------------- */

    async function lerJSON(url) {

        const resposta = await fetch(url, {
            cache: "no-store"
        });

        if (!resposta.ok) {
            throw new Error(
                "HTTP " + resposta.status
            );
        }

        return await resposta.json();
    }

    /* ---------------------------------------
       CARREGAR HISTÓRIAS DO ESP32
       --------------------------------------- */

    async function carregarHistorias() {

        const iniciais = { ...revisoes };

        try {

            const dados = await lerJSON("/historias");

            for (const tipo of Object.keys(revisoes)) {

                const valor =
                    typeof dados[tipo] === "string"
                        ? dados[tipo]
                        : "";

                if (
                    iniciais[tipo] === revisoes[tipo] &&
                    !salvando.has(tipo)
                ) {

                    $("editor-historia-" + tipo).value =
                        valor;

                    definirTexto(
                        $("visualizacao-" + tipo),
                        valor || "Nenhuma história registrada."
                    );
                }

                definirTexto(
                    $("preview-" + tipo),
                    valor
                );

                if (tipo !== "rpg") {

                    definirTexto(
                        $("detalhe-" + tipo),
                        valor ||
                        "A história ainda não foi escrita."
                    );
                }
            }

        } catch (erro) {

            mensagem(
                "Não foi possível carregar as histórias do ESP32."
            );
        }
    }

    /* ---------------------------------------
       SALVAR HISTÓRIA NO ESP32
       --------------------------------------- */

    async function salvarHistoria(tipo) {

        if (salvando.has(tipo)) return;

        const editor =
            $("editor-historia-" + tipo);

        const botao = document.querySelector(
            `[data-historia="${tipo}"]`
        );

        if (!editor || !botao) return;

        const texto = editor.value;
        const rev = revisoes[tipo];

        if (
            encoder.encode(texto).length >
            CONFIG.limiteHistoriaBytes
        ) {

            mensagem(
                "A história excede 3.500 bytes."
            );

            return;
        }

        salvando.add(tipo);
        botao.disabled = true;

        try {

            const resposta = await fetch(
                "/historias",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded"
                    },

                    body: new URLSearchParams({
                        tipo,
                        texto
                    }).toString()
                }
            );

            if (!resposta.ok) {
                throw new Error(
                    "HTTP " + resposta.status
                );
            }

            definirTexto(
                $("visualizacao-" + tipo),
                texto || "Nenhuma história registrada."
            );

            definirTexto(
                $("preview-" + tipo),
                texto
            );

            if (tipo !== "rpg") {

                definirTexto(
                    $("detalhe-" + tipo),
                    texto ||
                    "A história ainda não foi escrita."
                );
            }

            mensagem(
                rev === revisoes[tipo]
                    ? "✦ Pergaminho selado no ESP32!"
                    : "Pergaminho salvo; há novas edições pendentes."
            );

        } catch (erro) {

            mensagem(
                "Falha ao salvar a história no ESP32."
            );

        } finally {

            botao.disabled = false;
            salvando.delete(tipo);
        }
    }

    /* ---------------------------------------
       BOTÕES PARA SALVAR HISTÓRIAS
       --------------------------------------- */

    document.querySelectorAll(".botao-salvar")
        .forEach(botao => {

            botao.addEventListener("click", () => {

                salvarHistoria(
                    botao.dataset.historia
                );

            });
        });

    /* ---------------------------------------
       ABA VISUALIZAR HISTÓRIA
       --------------------------------------- */

    async function carregarVisualizacao() {

        try {

            const campanha = await lerJSON(
                "/campanha/dados"
            );

            definirTexto(
                $("preview-campaign-title"),
                campanha.titulo ||
                "Nenhuma campanha registrada"
            );

            definirTexto(
                $("preview-campaign-sub"),
                campanha.subtitulo || ""
            );

            definirTexto(
                $("preview-campaign-story"),
                campanha.texto || ""
            );

            definirTexto(
                $("preview-message"),
                ""
            );

        } catch (erro) {

            definirTexto(
                $("preview-message"),
                "Não foi possível carregar a campanha do ESP32."
            );
        }

        try {

            const dados = await lerJSON(
                "/historias"
            );

            for (const tipo of ["rpg", "p1", "p2"]) {

                definirTexto(
                    $("preview-" + tipo),
                    typeof dados[tipo] === "string"
                        ? dados[tipo]
                        : ""
                );
            }

        } catch (erro) {

            definirTexto(
                $("preview-message"),
                "Não foi possível carregar todos os textos do ESP32."
            );
        }
    }

    /* ---------------------------------------
       INICIALIZAÇÃO DOS ARQUIVOS
       --------------------------------------- */

    carregarHistorias();

    if (location.hash === "#visualizar") {
        mostrar("visualizar");
    }
}

/* =====================================================
   14. INICIALIZAÇÃO GERAL
   ===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    () => {
        iniciarJogo();
        iniciarMenuHistorias();
    }
);
