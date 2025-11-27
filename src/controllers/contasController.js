import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

class ContasController {
  async getSubscriptions(req, res) {
    try {
      const usuarioId = req.user.id;

      if (!usuarioId) {
        return res.status(401).json({ error: "Usuário não autenticado" });
      }

      const [subscriptions] = await pool.execute(
        "SELECT * FROM assinaturas WHERE usuario_id = ?",
        [usuarioId]
      );

      return res.status(200).json(subscriptions);
    } catch (error) {
      console.error("Erro ao buscar assinaturas:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

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
      const papel = "usuario";

      await pool.execute(
        "INSERT INTO usuarios (id, nome, email, senha, papel) VALUES (?, ?, ?, ?, ?)",
        [usuarioId, nome, email, senhaHash, papel]
      );

      // Gerar token JWT para o novo usuário
      const token = jwt.sign(
        { id: usuarioId, email: email, papel: papel },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );
      
      // Salva a sessão na tabela sessoes_usuarios
      await pool.execute(
        "INSERT INTO sessoes_usuarios (id, usuario_id, hash_token, expira_em, info_dispositivo, info_navegador, endereco_ip, papel) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?, ?, ?)",
        [
          uuidv4(),
          usuarioId,
          crypto.createHash("sha256").update(token).digest("hex"),
          parseInt(process.env.JWT_EXPIRES_IN_SECONDS) || 28800,
          req.headers["user-agent"] || "unknown",
          req.headers["user-agent"] || "unknown",
          req.ip,
          papel,
        ]
      );
      
      const user = { id: usuarioId, nome, email };

      return res.status(201).json({
        message: "Conta criada com sucesso",
        user,
        papel: papel,
        token: token,
      });
    } catch (error) {
      console.error("Erro ao criar conta:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new ContasController();
