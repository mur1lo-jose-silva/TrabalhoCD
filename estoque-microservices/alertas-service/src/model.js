import mongoose from "mongoose";

const alertaSchema = new mongoose.Schema(
  {
    produto_id: { type: String, required: true, index: true },
    nome: { type: String },
    sku: { type: String },
    saldo: { type: Number, required: true },
    estoque_minimo: { type: Number, required: true },
    // RESOLVIDO: o saldo voltou ao minimo. ENCERRADO: o produto foi removido.
    status: { type: String, enum: ["ATIVO", "RESOLVIDO", "ENCERRADO"], default: "ATIVO" },
    resolvido_em: { type: Date, default: null }, // quando deixou de estar ativo
    aberto_por_evento: { type: String },
    ultimo_evento: { type: String },
  },
  { timestamps: { createdAt: "aberto_em", updatedAt: "atualizado_em" } }
);

// No maximo UM alerta ativo por produto, garantido pelo proprio banco.
alertaSchema.index(
  { produto_id: 1 },
  { unique: true, partialFilterExpression: { status: "ATIVO" }, name: "um_ativo_por_produto" }
);

alertaSchema.set("toJSON", {
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Alerta = mongoose.model("Alerta", alertaSchema);

// Ultima versao de estoque aplicada por produto. Descarta eventos repetidos
// ou fora de ordem (idempotencia por versao, ver docs/eventos.md).
const estadoProdutoSchema = new mongoose.Schema(
  {
    _id: { type: String }, // produto_id
    versao: { type: Number, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: "atualizado_em" } }
);

export const EstadoProduto = mongoose.model("EstadoProduto", estadoProdutoSchema);
