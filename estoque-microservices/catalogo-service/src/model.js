import mongoose from "mongoose";

// Evento aguardando publicacao (outbox embutido no proprio documento).
// Como o MongoDB so garante atomicidade dentro de UM documento (sem replica set),
// guardar o evento junto do produto faz "alterar o produto" e "registrar o
// evento" acontecerem na mesma operacao atomica.
const eventoPendenteSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true },
    tipo: { type: String, required: true },
    versao: { type: Number, required: true },
    ocorrido_em: { type: Date, required: true },
    origem: { type: String, required: true },
    dados: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

const produtoSchema = new mongoose.Schema(
  {
    nome: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, unique: true },
    categoria: { type: String, trim: true, default: null },
    preco: { type: Number, min: 0, default: 0 },
    estoque_minimo: {
      type: Number,
      min: 0,
      default: 0,
      validate: { validator: Number.isInteger, message: "deve ser inteiro" },
    },
    // Atributos livres por categoria (ex.: { switch: "Blue", layout: "ABNT2" }).
    // E aqui que o banco de documentos se justifica: cada produto pode ter
    // atributos diferentes sem alterar o esquema.
    atributos: { type: mongoose.Schema.Types.Mixed, default: {} },
    ativo: { type: Boolean, default: true },
    // Incrementada a cada mudanca; viaja nos eventos para o consumidor
    // descartar eventos antigos ou fora de ordem.
    versao: { type: Number, default: 1 },
    eventos_pendentes: { type: [eventoPendenteSchema], default: [] },
  },
  {
    timestamps: { createdAt: "criado_em", updatedAt: "atualizado_em" },
    minimize: false,
  }
);

// Formato devolvido pela API: "id" no lugar de "_id" e sem dados internos.
produtoSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.eventos_pendentes;
    return ret;
  },
});

export const Produto = mongoose.model("Produto", produtoSchema);

// Campos do produto que sao replicados para o servico de Estoque.
export function dadosReplicados(produto) {
  return {
    produto_id: String(produto._id),
    nome: produto.nome,
    sku: produto.sku,
    categoria: produto.categoria ?? null,
    estoque_minimo: produto.estoque_minimo,
  };
}
