import mongoose from "mongoose";

// Banco proprio e isolado deste servico (Database per Service).
const MONGO_URL =
  process.env.MONGO_URL || "mongodb://mongo:27017/movimentacoes";

export async function conectarMongo() {
  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    try {
      await mongoose.connect(MONGO_URL);
      console.log("[mongo] conectado");
      return;
    } catch (err) {
      console.log(
        `[mongo] falha ao conectar (tentativa ${tentativa}), nova tentativa em 3s`
      );
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("Nao foi possivel conectar ao MongoDB");
}
