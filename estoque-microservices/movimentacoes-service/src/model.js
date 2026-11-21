import mongoose from "mongoose";

const movimentacaoSchema = new mongoose.Schema(
  {
    produto_id: { type: Number, required: true },
    tipo: { type: String, enum: ["ENTRADA", "SAIDA"], required: true },
    quantidade: { type: Number, required: true, min: 1 },
    observacao: { type: String },
  },
  { timestamps: true }
);

export const Movimentacao = mongoose.model("Movimentacao", movimentacaoSchema);
