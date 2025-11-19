import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

class ContasController {
  async criarConta(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { nome, email, senha } = req.body;

      if (!nome || !email || !senha) {
        return res
          .status(400)
          .json({ error: "Nome, email e senha são obrigatórios" });
      }

      // Verificar se o email já existe
      const [existingUsers] = await pool.execute(
        "SELECT id FROM usuarios WHERE email = ?",
        [email]
      );

      if (Array.isArray(existingUsers) && existingUsers.length > 0) {
        return res.status(409).json({ error: "Email já cadastrado" });
      }

      // Criar usuário
      const usuarioId = uuidv4();
      const senhaHash = await bcrypt.hash(senha, 10);

      await pool.execute(
        "INSERT INTO usuarios (id, nome, email, senha) VALUES (?, ?, ?, ?)",
        [usuarioId, nome, email, senhaHash]
      );

      // Gerar token JWT para o novo usuário
      const token = jwt.sign(
        { id: usuarioId, email: email, papel: "usuario" },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      return res.status(201).json({
        message: "Conta criada com sucesso",
        usuarioId,
        token,
      });
    } catch (error) {
      console.error("Erro ao criar conta:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new ContasController();
