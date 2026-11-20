import mongoose from "mongoose";

// Banco proprio e isolado deste servico (Database per Service).
const MONGO_URL =
  process.env.MONGO_URL || "mongodb://mongo-catalogo:27017/catalogo";

export async function conectarMongo() {
  for (let tentativa = 1; tentativa <= 20; tentativa++) {
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
