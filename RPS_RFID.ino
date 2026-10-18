
#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <SPI.h>
#include <MFRC522.h>

// ==================================================
// 1. CONFIGURACAO DO ESP32
// ==================================================

// Pinos do leitor RFID RC522
constexpr uint8_t PINO_SS = 5;
constexpr uint8_t PINO_RST = 22;

MFRC522 rfid(PINO_SS, PINO_RST);

// Servidor HTTP na porta 80
WebServer servidor(80);

// --------------------------------------------------
// WIFI
// --------------------------------------------------

// false = ESP32 cria sua propria rede Wi-Fi.
// true  = ESP32 conecta a uma rede existente.
constexpr bool USAR_WIFI_EXISTENTE = false;

// Preencher apenas se usar Wi-Fi existente.
const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_SENHA = "SUA_SENHA";

// Rede criada pelo proprio ESP32.
// Troque a senha antes de utilizar.
const char* AP_SSID = "RPG-RFID";
const char* AP_SENHA = "TroqueEstaSenha2026!";

bool arquivosDisponiveis = false;

// ==================================================
// 2. REGRAS DO RPG
// ==================================================

constexpr int VIDA_MAXIMA = 3;

constexpr int DANO_FEITICO = 1;
constexpr int CUSTO_FEITICO = 1;

constexpr int DANO_BOMBA = 2;
constexpr int CUSTO_BOMBA = 2;

constexpr int SUPRIMENTOS_INICIAIS = 10;
constexpr int VIDA_INIMIGO_INICIAL = 3;

// Limites para armazenamento no LittleFS.
constexpr size_t LIMITE_HISTORIA = 3500;
constexpr size_t LIMITE_TITULO = 100;
constexpr size_t LIMITE_SUBTITULO = 160;
constexpr size_t LIMITE_TEXTO_CAMPANHA = 6000;

// ==================================================
// 3. UIDS DAS CARTAS RFID
// ==================================================

// Substitua pelos UIDs reais das suas cartas.

const char* const UID_PERSONAGEM_1 = "AA BB CC DD";
const char* const UID_PERSONAGEM_2 = "11 22 33 44";
const char* const UID_CURA = "55 66 77 88";
const char* const UID_BOMBA = "12 34 56 78";
const char* const UID_FEITICO = "AB CD EF 12";

// ==================================================
// 4. ESTADO DO JOGO
// ==================================================

int vidasPersonagem1 = VIDA_MAXIMA;
int vidasPersonagem2 = VIDA_MAXIMA;

int suprimentos = SUPRIMENTOS_INICIAIS;
int vidaInimigo = VIDA_INIMIGO_INICIAL;

// -1 = nenhum personagem
//  0 = personagem 1
//  1 = personagem 2
int personagemSelecionado = -1;

// Capitulo atual da campanha.
int capituloAtual = 1;

// Ultimo evento ocorrido no jogo.
uint32_t ultimoEventoId = 0;

String ultimoEventoTipo = "INICIO";
String ultimoEventoUID = "";
String ultimaMensagem =
    "A aventura esta prestes a comecar.";

// ==================================================
// 5. FUNCOES AUXILIARES
// ==================================================

void informar(const String& mensagem) {
    Serial.println(mensagem);
}

bool personagemValido(int personagem) {
    return personagem == 0 || personagem == 1;
}

int* obterVidasPersonagem(int personagem) {
    if (personagem == 0) {
        return &vidasPersonagem1;
    }

    if (personagem == 1) {
        return &vidasPersonagem2;
    }

    return nullptr;
}

// --------------------------------------------------
// REGISTRO DE EVENTOS
// --------------------------------------------------

void registrarEvento(
    const String& tipo,
    const String& uid,
    const String& mensagem
) {
    // O JavaScript usa o ID para reconhecer
    // quando um evento novo foi registrado.
    ultimoEventoId++;

    ultimoEventoTipo = tipo;
    ultimoEventoUID = uid;
    ultimaMensagem = mensagem;

    informar("EVENTO: " + mensagem);
}

// --------------------------------------------------
// CONVERSAO SEGURA PARA JSON
// --------------------------------------------------

// Escapa aspas, barras, quebras de linha e
// caracteres de controle.
//
// Isso permite enviar textos escritos pelos
// jogadores sem quebrar a resposta JSON.

String jsonString(const String& texto) {
    String resultado = "\"";

    for (size_t i = 0; i < texto.length(); i++) {
        unsigned char c =
            static_cast<unsigned char>(texto[i]);

        switch (c) {
            case '"':
                resultado += "\\\"";
                break;

            case '\\':
                resultado += "\\\\";
                break;

            case '\n':
                resultado += "\\n";
                break;

            case '\r':
                resultado += "\\r";
                break;

            case '\t':
                resultado += "\\t";
                break;

            default:
                if (c < 0x20) {
                    const char* hex = "0123456789ABCDEF";

                    resultado += "\\u00";
                    resultado += hex[(c >> 4) & 0x0F];
                    resultado += hex[c & 0x0F];
                } else {
                    resultado += static_cast<char>(c);
                }

                break;
        }
    }

    resultado += "\"";

    return resultado;
}

void enviarJSON(int codigo, const String& json) {
    servidor.send(
        codigo,
        "application/json; charset=utf-8",
        json
    );
}

// ==================================================
// 6. SISTEMA DE ARQUIVOS LITTLEFS
// ==================================================

// Os arquivos HTML, CSS e JavaScript ficam
// armazenados no LittleFS do ESP32.
//
// Os textos editados pelo jogador tambem
// sao armazenados nesse sistema de arquivos.

String lerArquivoTexto(
    const char* caminho,
    size_t limite
) {
    if (!arquivosDisponiveis) {
        return "";
    }

    File arquivo = LittleFS.open(caminho, "r");

    if (!arquivo || arquivo.isDirectory()) {
        if (arquivo) {
            arquivo.close();
        }

        return "";
    }

    if (arquivo.size() > limite) {
        arquivo.close();

        informar(
            "Arquivo maior que o limite: " +
            String(caminho)
        );

        return "";
    }

    String conteudo = arquivo.readString();

    arquivo.close();

    return conteudo;
}

// Salva primeiro em um arquivo temporario.
//
// Assim, se a escrita falhar, o arquivo
// original nao e truncado imediatamente.

bool salvarArquivoTexto(
    const char* caminho,
    const String& texto,
    size_t limite
) {
    if (!arquivosDisponiveis) {
        return false;
    }

    if (texto.length() > limite) {
        return false;
    }

    String temporario = String(caminho) + ".tmp";

    File arquivo = LittleFS.open(
        temporario.c_str(),
        "w"
    );

    if (!arquivo) {
        return false;
    }

    size_t escritos = arquivo.write(
        reinterpret_cast<const uint8_t*>(
            texto.c_str()
        ),
        texto.length()
    );

    arquivo.close();

    if (escritos != texto.length()) {
        LittleFS.remove(temporario.c_str());
        return false;
    }

    // Remove o anterior apenas apos a
    // escrita temporaria ser concluida.
    //
    // A substituicao entre dois arquivos
    // nao e uma transacao atomica.

    if (LittleFS.exists(caminho)) {
        if (!LittleFS.remove(caminho)) {
            LittleFS.remove(temporario.c_str());
            return false;
        }
    }

    if (!LittleFS.rename(
        temporario.c_str(),
        caminho
    )) {
        return false;
    }

    return true;
}

// --------------------------------------------------
// ENTREGA DOS ARQUIVOS WEB
// --------------------------------------------------

void servirArquivo(
    const char* caminho,
    const char* tipo
) {
    if (!arquivosDisponiveis) {
        servidor.send(
            503,
            "text/plain; charset=utf-8",
            "LittleFS indisponivel."
        );

        return;
    }

    File arquivo = LittleFS.open(caminho, "r");

    if (!arquivo || arquivo.isDirectory()) {
        if (arquivo) {
            arquivo.close();
        }

        servidor.send(
            404,
            "text/plain; charset=utf-8",
            "Arquivo nao encontrado."
        );

        return;
    }

    servidor.streamFile(arquivo, tipo);

    arquivo.close();
}

// ==================================================
// 7. LEITURA RFID
// ==================================================

String lerUID() {
    String uid;

    const byte tamanho = rfid.uid.size;

    if (
        tamanho == 0 ||
        tamanho > sizeof(rfid.uid.uidByte)
    ) {
        return "";
    }

    uid.reserve(
        static_cast<unsigned int>(tamanho) * 3U
    );

    for (byte i = 0; i < tamanho; i++) {
        if (i > 0) {
            uid += ' ';
        }

        const byte valor = rfid.uid.uidByte[i];

        if (valor < 0x10) {
            uid += '0';
        }

        uid += String(valor, HEX);
    }

    uid.toUpperCase();

    return uid;
}

// ==================================================
// 8. PERSONAGENS
// ==================================================

String selecionarPersonagem(int personagem) {
    if (!personagemValido(personagem)) {
        return "Personagem invalido.";
    }

    personagemSelecionado = personagem;

    if (personagem == 0) {
        return "Personagem 1 selecionado.";
    }

    return "Personagem 2 selecionado.";
}

// ==================================================
// 9. CURA
// ==================================================

String executarCura() {
    if (!personagemValido(personagemSelecionado)) {
        return "Selecione um personagem antes da cura.";
    }

    int* vidas = obterVidasPersonagem(
        personagemSelecionado
    );

    if (
        vidas == nullptr ||
        *vidas < 0 ||
        *vidas > VIDA_MAXIMA
    ) {
        return "Estado de vida invalido.";
    }

    if (*vidas >= VIDA_MAXIMA) {
        return "O personagem ja possui vida maxima.";
    }

    ++(*vidas);

    return (
        "Cura realizada: +1 vida. Vida atual: " +
        String(*vidas)
    );
}

// ==================================================
// 10. DANO AO INIMIGO
// ==================================================

String causarDano(
    int dano,
    const char* origem
) {
    if (dano <= 0 || origem == nullptr) {
        return "Dano invalido.";
    }

    if (vidaInimigo <= 0) {
        vidaInimigo = 0;

        return "O inimigo ja foi derrotado.";
    }

    if (dano >= vidaInimigo) {
        vidaInimigo = 0;
    } else {
        vidaInimigo -= dano;
    }

    String mensagem =
        String(origem) +
        ": inimigo recebeu " +
        String(dano) +
        " de dano.";

    if (vidaInimigo == 0) {
        capituloAtual = 2;

        mensagem += " O inimigo foi derrotado!";
    } else {
        mensagem +=
            " Vida restante: " +
            String(vidaInimigo) +
            ".";
    }

    return mensagem;
}

// ==================================================
// 11. BOMBA
// ==================================================

String executarBomba() {
    if (vidaInimigo <= 0) {
        return "O inimigo ja foi derrotado.";
    }

    if (suprimentos < CUSTO_BOMBA) {
        return "Suprimentos insuficientes para a bomba.";
    }

    suprimentos -= CUSTO_BOMBA;

    return causarDano(DANO_BOMBA, "Bomba");
}

// ==================================================
// 12. FEITICO
// ==================================================

String executarFeitico() {
    if (vidaInimigo <= 0) {
        return "O inimigo ja foi derrotado.";
    }

    if (suprimentos < CUSTO_FEITICO) {
        return "Suprimentos insuficientes para o feitico.";
    }

    suprimentos -= CUSTO_FEITICO;

    return causarDano(DANO_FEITICO, "Feitico");
}

// ==================================================
// 13. PROCESSAMENTO DAS CARTAS
// ==================================================

void processarCarta(const String& uid) {
    if (uid.isEmpty()) {
        registrarEvento(
            "ERRO",
            "",
            "UID invalido ou vazio."
        );

        return;
    }

    informar("UID detectado: " + uid);

    String tipo;
    String mensagem;

    if (uid == UID_PERSONAGEM_1) {
        tipo = "PERSONAGEM_1";
        mensagem = selecionarPersonagem(0);
    }
    else if (uid == UID_PERSONAGEM_2) {
        tipo = "PERSONAGEM_2";
        mensagem = selecionarPersonagem(1);
    }
    else if (uid == UID_CURA) {
        tipo = "CURA";
        mensagem = executarCura();
    }
    else if (uid == UID_BOMBA) {
        tipo = "BOMBA";
        mensagem = executarBomba();
    }
    else if (uid == UID_FEITICO) {
        tipo = "FEITICO";
        mensagem = executarFeitico();
    }
    else {
        tipo = "DESCONHECIDA";
        mensagem = "Carta nao cadastrada.";
    }

    // Se um golpe derrotou o inimigo,
    // o evento recebe o tipo VITORIA.

    if (
        vidaInimigo == 0 &&
        (tipo == "BOMBA" || tipo == "FEITICO") &&
        capituloAtual == 2 &&
        mensagem.indexOf("foi derrotado!") >= 0
    ) {
        tipo = "VITORIA";
    }

    registrarEvento(tipo, uid, mensagem);
}

// ==================================================
// 14. CAMPANHA: CONTEUDO NARRATIVO
// ==================================================

// Textos padrao, usados enquanto o jogador
// ainda nao escreveu a propria campanha.

String tituloCampanha() {
    String salvo = lerArquivoTexto(
        "/campanha_titulo.txt",
        LIMITE_TITULO
    );

    return salvo.isEmpty()
        ? "O Despertar"
        : salvo;
}

String subtituloCampanha() {
    String salvo = lerArquivoTexto(
        "/campanha_subtitulo.txt",
        LIMITE_SUBTITULO
    );

    return salvo.isEmpty()
        ? "Toda lenda comeca com uma escolha."
        : salvo;
}

String textoCampanha() {
    String salvo = lerArquivoTexto(
        "/campanha_texto.txt",
        LIMITE_TEXTO_CAMPANHA
    );

    if (!salvo.isEmpty()) {
        return salvo;
    }

    return
        "Uma nevoa antiga cobre os caminhos do reino."
        "\n\n"
        "Dois aventureiros foram chamados para "
        "enfrentar uma ameaca nas sombras."
        "\n\n"
        "Aproxime uma carta de personagem para "
        "iniciar a jornada.";
}

// ==================================================
// 15. API: GET /estado
// ==================================================

void atenderEstado() {
    String numero;
    String titulo;
    String subtitulo;
    String narrativa;
    String instrucao;

    if (capituloAtual == 1) {
        numero = "Capitulo I";

        titulo = tituloCampanha();
        subtitulo = subtituloCampanha();
        narrativa = textoCampanha();

        instrucao =
            "Aproxime uma carta RFID para continuar.";
    }
    else {
        numero = "Capitulo II";

        titulo = "A Vitoria";

        subtitulo =
            "O primeiro desafio foi superado.";

        narrativa =
            "O guardiao das sombras caiu diante dos "
            "aventureiros."
            "\n\n"
            "O caminho para o reino finalmente "
            "esta aberto."
            "\n\n"
            "Uma nova etapa da jornada aguarda "
            "seus herois.";

        instrucao =
            "Fim desta etapa da campanha.";
    }

    String json;
    json.reserve(
        512 +
        narrativa.length() +
        ultimaMensagem.length()
    );

    json += "{";

    json += "\"vidasPersonagem1\":";
    json += String(vidasPersonagem1);
    json += ",";

    json += "\"vidasPersonagem2\":";
    json += String(vidasPersonagem2);
    json += ",";

    json += "\"vidaMaxima\":";
    json += String(VIDA_MAXIMA);
    json += ",";

    json += "\"personagemSelecionado\":";
    json += String(personagemSelecionado);
    json += ",";

    json += "\"suprimentos\":";
    json += String(suprimentos);
    json += ",";

    json += "\"vidaInimigo\":";
    json += String(vidaInimigo);
    json += ",";

    json += "\"vidaMaximaInimigo\":";
    json += String(VIDA_INIMIGO_INICIAL);
    json += ",";

    json += "\"nomeInimigo\":";
    json += jsonString("Guardiao das Sombras");
    json += ",";

    // Ultimo evento de RFID.
    json += "\"evento\":{";

    json += "\"id\":";
    json += String(ultimoEventoId);
    json += ",";

    json += "\"tipo\":";
    json += jsonString(ultimoEventoTipo);
    json += ",";

    json += "\"uid\":";
    json += jsonString(ultimoEventoUID);
    json += ",";

    json += "\"mensagem\":";
    json += jsonString(ultimaMensagem);

    json += "},";

    // Capitulo atual.
    json += "\"capitulo\":{";

    json += "\"id\":";
    json += String(capituloAtual);
    json += ",";

    json += "\"numero\":";
    json += jsonString(numero);
    json += ",";

    json += "\"titulo\":";
    json += jsonString(titulo);
    json += ",";

    json += "\"subtitulo\":";
    json += jsonString(subtitulo);
    json += ",";

    json += "\"texto\":";
    json += jsonString(narrativa);
    json += ",";

    json += "\"instrucao\":";
    json += jsonString(instrucao);

    json += "}";

    json += "}";

    enviarJSON(200, json);
}

// ==================================================
// 16. HISTORIAS DOS PERSONAGENS E DO REINO
// ==================================================

// GET /historias
//
// Retorna:
// {
//   "rpg": "...",
//   "p1": "...",
//   "p2": "..."
// }

void atenderHistoriasGET() {
    if (!arquivosDisponiveis) {
        enviarJSON(
            503,
            "{\"erro\":\"LittleFS indisponivel\"}"
        );

        return;
    }

    String rpg = lerArquivoTexto(
        "/historia_rpg.txt",
        LIMITE_HISTORIA
    );

    String p1 = lerArquivoTexto(
        "/historia_p1.txt",
        LIMITE_HISTORIA
    );

    String p2 = lerArquivoTexto(
        "/historia_p2.txt",
        LIMITE_HISTORIA
    );

    String json = "{";

    json += "\"rpg\":";
    json += jsonString(rpg);
    json += ",";

    json += "\"p1\":";
    json += jsonString(p1);
    json += ",";

    json += "\"p2\":";
    json += jsonString(p2);

    json += "}";

    enviarJSON(200, json);
}

// POST /historias
//
// Campos enviados pelo JavaScript:
// tipo = rpg, p1 ou p2
// texto = conteudo da historia

void atenderHistoriasPOST() {
    if (!arquivosDisponiveis) {
        enviarJSON(
            503,
            "{\"erro\":\"LittleFS indisponivel\"}"
        );

        return;
    }

    if (
        !servidor.hasArg("tipo") ||
        !servidor.hasArg("texto")
    ) {
        enviarJSON(
            400,
            "{\"erro\":\"Campos ausentes\"}"
        );

        return;
    }

    String tipo = servidor.arg("tipo");
    String texto = servidor.arg("texto");

    const char* caminho = nullptr;

    if (tipo == "rpg") {
        caminho = "/historia_rpg.txt";
    }
    else if (tipo == "p1") {
        caminho = "/historia_p1.txt";
    }
    else if (tipo == "p2") {
        caminho = "/historia_p2.txt";
    }
    else {
        enviarJSON(
            400,
            "{\"erro\":\"Tipo de historia invalido\"}"
        );

        return;
    }

    if (texto.length() > LIMITE_HISTORIA) {
        enviarJSON(
            413,
            "{\"erro\":\"Historia muito longa\"}"
        );

        return;
    }

    bool sucesso = salvarArquivoTexto(
        caminho,
        texto,
        LIMITE_HISTORIA
    );

    if (!sucesso) {
        enviarJSON(
            500,
            "{\"erro\":\"Falha ao salvar historia\"}"
        );

        return;
    }

    informar("Historia salva: " + tipo);

    enviarJSON(
        200,
        "{\"ok\":true}"
    );
}

// ==================================================
// 17. CAMPANHA: GET /campanha/dados
// ==================================================

void atenderCampanhaGET() {
    if (!arquivosDisponiveis) {
        enviarJSON(
            503,
            "{\"erro\":\"LittleFS indisponivel\"}"
        );

        return;
    }

    String titulo = lerArquivoTexto(
        "/campanha_titulo.txt",
        LIMITE_TITULO
    );

    String subtitulo = lerArquivoTexto(
        "/campanha_subtitulo.txt",
        LIMITE_SUBTITULO
    );

    String texto = lerArquivoTexto(
        "/campanha_texto.txt",
        LIMITE_TEXTO_CAMPANHA
    );

    String json = "{";

    json += "\"titulo\":";
    json += jsonString(titulo);
    json += ",";

    json += "\"subtitulo\":";
    json += jsonString(subtitulo);
    json += ",";

    json += "\"texto\":";
    json += jsonString(texto);

    json += "}";

    enviarJSON(200, json);
}

// ==================================================
// 18. CAMPANHA: POST /campanha/dados
// ==================================================

void atenderCampanhaPOST() {
    if (!arquivosDisponiveis) {
        enviarJSON(
            503,
            "{\"erro\":\"LittleFS indisponivel\"}"
        );

        return;
    }

    if (
        !servidor.hasArg("titulo") ||
        !servidor.hasArg("subtitulo") ||
        !servidor.hasArg("texto")
    ) {
        enviarJSON(
            400,
            "{\"erro\":\"Campos ausentes\"}"
        );

        return;
    }

    String titulo = servidor.arg("titulo");
    String subtitulo = servidor.arg("subtitulo");
    String texto = servidor.arg("texto");

    titulo.trim();
    subtitulo.trim();
    texto.trim();

    if (titulo.isEmpty() || texto.isEmpty()) {
        enviarJSON(
            400,
            "{\"erro\":\"Titulo e historia obrigatorios\"}"
        );

        return;
    }

    if (
        titulo.length() > LIMITE_TITULO ||
        subtitulo.length() > LIMITE_SUBTITULO ||
        texto.length() > LIMITE_TEXTO_CAMPANHA
    ) {
        enviarJSON(
            413,
            "{\"erro\":\"Limite de texto excedido\"}"
        );

        return;
    }

    bool salvouTitulo = salvarArquivoTexto(
        "/campanha_titulo.txt",
        titulo,
        LIMITE_TITULO
    );

    if (!salvouTitulo) {
        enviarJSON(
            500,
            "{\"erro\":\"Falha ao salvar titulo\"}"
        );

        return;
    }

    bool salvouSubtitulo = salvarArquivoTexto(
        "/campanha_subtitulo.txt",
        subtitulo,
        LIMITE_SUBTITULO
    );

    if (!salvouSubtitulo) {
        enviarJSON(
            500,
            "{\"erro\":\"Falha ao salvar subtitulo\"}"
        );

        return;
    }

    bool salvouTexto = salvarArquivoTexto(
        "/campanha_texto.txt",
        texto,
        LIMITE_TEXTO_CAMPANHA
    );

    if (!salvouTexto) {
        enviarJSON(
            500,
            "{\"erro\":\"Falha ao salvar texto\"}"
        );

        return;
    }

    informar("Campanha salva no LittleFS.");

    enviarJSON(
        200,
        "{\"ok\":true}"
    );
}

// ==================================================
// 19. CONFIGURACAO DO WIFI
// ==================================================

void iniciarWiFi() {
    if (USAR_WIFI_EXISTENTE) {
        informar("Conectando ao Wi-Fi existente...");

        WiFi.mode(WIFI_STA);
        WiFi.begin(WIFI_SSID, WIFI_SENHA);

        unsigned long inicio = millis();

        while (
            WiFi.status() != WL_CONNECTED &&
            millis() - inicio < 15000
        ) {
            delay(250);
        }

        if (WiFi.status() == WL_CONNECTED) {
            informar("Wi-Fi conectado!");

            informar(
                "Abra no navegador: http://" +
                WiFi.localIP().toString() +
                "/"
            );

            return;
        }

        informar(
            "Falha no Wi-Fi. Criando rede propria."
        );

        WiFi.disconnect();
    }

    WiFi.mode(WIFI_AP);

    bool sucesso = WiFi.softAP(
        AP_SSID,
        AP_SENHA
    );

    if (!sucesso) {
        informar("Erro ao criar rede Wi-Fi!");
        return;
    }

    informar("Rede Wi-Fi criada.");

    informar(
        "Nome da rede: " +
        String(AP_SSID)
    );

    informar(
        "Abra no navegador: http://" +
        WiFi.softAPIP().toString() +
        "/"
    );
}

// ==================================================
// 20. CONFIGURACAO DO SERVIDOR HTTP
// ==================================================

void configurarServidor() {
    // ------------------------------------------------
    // INTERFACE PRINCIPAL
    // ------------------------------------------------

    servidor.on("/", HTTP_GET, []() {
        servirArquivo(
            "/index.html",
            "text/html; charset=utf-8"
        );
    });

    // ------------------------------------------------
    // PAGINA DE EDICAO DA CAMPANHA
    // ------------------------------------------------

    servidor.on(
        "/campanha.html",
        HTTP_GET,
        []() {
            servirArquivo(
                "/campanha.html",
                "text/html; charset=utf-8"
            );
        }
    );

    // ------------------------------------------------
    // CSS
    // ------------------------------------------------

    servidor.on(
        "/style.css",
        HTTP_GET,
        []() {
            servirArquivo(
                "/style.css",
                "text/css; charset=utf-8"
            );
        }
    );

    // ------------------------------------------------
    // JAVASCRIPT
    // ------------------------------------------------

    servidor.on(
        "/script.js",
        HTTP_GET,
        []() {
            servirArquivo(
                "/script.js",
                "application/javascript; charset=utf-8"
            );
        }
    );

    // ------------------------------------------------
    // ESTADO DO RPG
    // ------------------------------------------------

    servidor.on(
        "/estado",
        HTTP_GET,
        atenderEstado
    );

    // ------------------------------------------------
    // HISTORIAS DO MENU LATERAL
    // ------------------------------------------------

    servidor.on(
        "/historias",
        HTTP_GET,
        atenderHistoriasGET
    );

    servidor.on(
        "/historias",
        HTTP_POST,
        atenderHistoriasPOST
    );

    // ------------------------------------------------
    // HISTORIA PRINCIPAL DA CAMPANHA
    // ------------------------------------------------

    servidor.on(
        "/campanha/dados",
        HTTP_GET,
        atenderCampanhaGET
    );

    servidor.on(
        "/campanha/dados",
        HTTP_POST,
        atenderCampanhaPOST
    );

    // ------------------------------------------------
    // OUTRAS ROTAS
    // ------------------------------------------------

    servidor.onNotFound([]() {
        servidor.send(
            404,
            "text/plain; charset=utf-8",
            "Pagina nao encontrada."
        );
    });

    servidor.begin();

    informar("Servidor HTTP iniciado.");
}

// ==================================================
// 21. INICIALIZACAO
// ==================================================

void setup() {
    Serial.begin(115200);

    delay(300);

    informar("============================");
    informar("INICIANDO RPG RFID");
    informar("============================");

    // Inicializacao do leitor RFID.
    SPI.begin();
    rfid.PCD_Init();

    informar("Leitor RFID inicializado.");

    // Monta LittleFS sem formatar automaticamente.
    arquivosDisponiveis = LittleFS.begin(false);

    if (arquivosDisponiveis) {
        informar("LittleFS inicializado.");
    } else {
        informar(
            "ERRO: LittleFS indisponivel."
        );

        informar(
            "Envie os arquivos da pasta data."
        );
    }

    // Configura Wi-Fi.
    iniciarWiFi();

    // Configura as rotas HTTP.
    configurarServidor();

    informar("----------------------------");

    informar(
        "Vidas personagem 1: " +
        String(vidasPersonagem1)
    );

    informar(
        "Vidas personagem 2: " +
        String(vidasPersonagem2)
    );

    informar(
        "Suprimentos: " +
        String(suprimentos)
    );

    informar(
        "Vida do inimigo: " +
        String(vidaInimigo)
    );

    informar("----------------------------");
    informar("Sistema pronto!");
}

// ==================================================
// 22. LOOP PRINCIPAL
// ==================================================

void loop() {
    // Atende as requisicoes do navegador.
    // Deve ser chamado continuamente.
    servidor.handleClient();

    // Verifica novas cartas RFID.
    if (!rfid.PICC_IsNewCardPresent()) {
        return;
    }

    if (!rfid.PICC_ReadCardSerial()) {
        return;
    }

    const String uid = lerUID();

    processarCarta(uid);

    // Finaliza comunicacao com a carta.
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
}
