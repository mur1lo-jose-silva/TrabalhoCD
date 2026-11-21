// Gera dados ficticios de produtos para popular/testar o catalogo.
// Usado so na interface (botao "Popular"): cada item vira um POST /produtos
// comum, com categoria, preco, estoque minimo e estoque inicial aleatorios.

const CATEGORIAS = [
  {
    categoria: "Periféricos",
    sigla: "PER",
    nomes: ["Teclado Mecânico", "Mouse Gamer", "Mousepad", "Headset", "Webcam HD"],
    atributos: () => ({ conexao: escolher(["USB", "Wireless", "Bluetooth"]) }),
  },
  {
    categoria: "Monitores",
    sigla: "MON",
    nomes: ['Monitor 24"', 'Monitor 27"', "Monitor Ultrawide", 'Monitor 32"'],
    atributos: () => ({
      resolucao: escolher(["1080p", "1440p", "4K"]),
      taxa: escolher(["60Hz", "75Hz", "144Hz", "165Hz"]),
    }),
  },
  {
    categoria: "Armazenamento",
    sigla: "ARM",
    nomes: ["SSD NVMe", "SSD SATA", "HD Externo", "Pendrive", "Cartão SD"],
    atributos: () => ({ capacidade: escolher(["256GB", "512GB", "1TB", "2TB", "4TB"]) }),
  },
  {
    categoria: "Componentes",
    sigla: "CMP",
    nomes: ["Memória RAM", "Placa de Vídeo", "Processador", "Fonte", "Placa-mãe"],
    atributos: () => ({ garantia: escolher(["12 meses", "24 meses", "36 meses"]) }),
  },
  {
    categoria: "Redes",
    sigla: "RED",
    nomes: ["Roteador", "Switch 8 portas", "Adaptador Wi-Fi", "Repetidor"],
    atributos: () => ({ padrao: escolher(["Wi-Fi 5", "Wi-Fi 6", "Gigabit"]) }),
  },
  {
    categoria: "Áudio",
    sigla: "AUD",
    nomes: ["Caixa de Som", "Microfone", "Fone de Ouvido", "Interface de Áudio"],
    atributos: () => ({ conexao: escolher(["P2", "USB", "XLR", "Bluetooth"]) }),
  },
  {
    categoria: "Cabos e Adaptadores",
    sigla: "CAB",
    nomes: ["Cabo HDMI", "Cabo USB-C", "Hub USB", "Adaptador DisplayPort", "Cabo de Rede"],
    atributos: () => ({ comprimento: escolher(["1m", "1,5m", "2m", "3m"]) }),
  },
  {
    categoria: "Acessórios",
    sigla: "ACE",
    nomes: ["Suporte de Monitor", "Cooler", "Filtro de Linha", "Base para Notebook"],
    atributos: () => ({ cor: escolher(["Preto", "Branco", "Cinza"]) }),
  },
];

const MARCAS = ["Nexus", "Orion", "Volt", "Pixel", "Titan", "Zync", "Kron", "Lumen", "Apex", "Hydra"];
const LINHAS = ["Pro", "Lite", "Max", "Plus", "X", "V2", "Ultra", "Go", "One", "Neo"];

const escolher = (lista) => lista[Math.floor(Math.random() * lista.length)];
const inteiro = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const preco = (min, max) => Math.round((Math.random() * (max - min) + min) * 100) / 100;

// Gera `quantidade` produtos com SKUs unicos dentro do lote. O prefixo de tempo
// (base36) reduz a chance de colidir com itens ja cadastrados.
export function gerarProdutos(quantidade) {
  const base = Date.now().toString(36).slice(-4).toUpperCase();
  const produtos = [];
  for (let i = 0; i < quantidade; i++) {
    const grupo = escolher(CATEGORIAS);
    const minimo = inteiro(2, 25);
    produtos.push({
      nome: `${escolher(MARCAS)} ${escolher(grupo.nomes)} ${escolher(LINHAS)}`,
      sku: `${grupo.sigla}-${base}-${String(i + 1).padStart(4, "0")}`,
      categoria: grupo.categoria,
      preco: preco(15, 2500),
      estoque_minimo: minimo,
      // Alguns itens ja nascem abaixo do minimo de proposito, para exercitar os alertas.
      estoque_inicial: inteiro(0, 300),
      atributos: grupo.atributos(),
    });
  }
  return produtos;
}
