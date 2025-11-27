import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { validationResult } from "express-validator";
import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

class AuthController {
  async login(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, senha } = req.body;

    try {
      const [userRows] = await pool.execute(
        "SELECT id, nome, email, senha, papel FROM usuarios WHERE email = ?",
        [email]
      );

      if (userRows.length === 0) {
        return res.status(401).json({ error: "Email ou senha incorretos" });
      }

      const usuario = userRows[0];
      const senhaCorreta = await bcrypt.compare(senha, usuario.senha);

      if (!senhaCorreta) {
        return res.status(401).json({ error: "Email ou senha incorretos" });
      }

      // Se autenticado com sucesso, gera o token
      const token = jwt.sign(
        {
          id: usuario.id,
          email: usuario.email,
          nome: usuario.nome,
          papel: usuario.papel,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      // Salva a sessão na tabela sessoes_usuarios
      await pool.execute(
        "INSERT INTO sessoes_usuarios (id, usuario_id, hash_token, expira_em, info_dispositivo, info_navegador, endereco_ip, papel) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?, ?, ?)",
        [
          uuidv4(),
          usuario.id,
          crypto.createHash("sha256").update(token).digest("hex"),
          parseInt(process.env.JWT_EXPIRES_IN_SECONDS) || 28800,
          req.headers["user-agent"] || "unknown",
          req.headers["user-agent"] || "unknown",
          req.ip,
          usuario.papel,
        ]
      );
      
      const jsonResponse = {
        token: token,
        user: { id: usuario.id, nome: usuario.nome, email: usuario.email },
        papel: usuario.papel,
      };

      return res.json(jsonResponse);
    } catch (error) {
      console.error("Erro no login:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async logout(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const { onClose } = req.body || {}; // Espera que onClose seja true se for de beforeunload

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        // Se onClose for true, não envia uma resposta. Caso contrário, envia 401.
        if (onClose) return; 
        return res
          .status(401)
          .json({ message: "Token de autorização não fornecido." });
      }

      const token = authHeader.split(" ")[1];
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

      await pool.execute(
        "UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE hash_token = ?",
        [tokenHash]
      );

      // Se onClose for true, não envia uma resposta. Caso contrário, envia 200.
      if (onClose) return; 
      return res.status(200).json({ message: "Logout realizado com sucesso" });
    } catch (error) {
      console.error("Erro no logout:", error);
      // Se onClose for true, não envia uma resposta. Caso contrário, envia 500.
      if (onClose) return;
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async verificarToken(req, res) {
    if (!req.user) {
      return res
        .status(401)
        .json({ message: "Token não fornecido ou inválido" });
    }
    return res.json({ user: req.user });
  }

  async checkAuthStatus(req, res) {
    try {
      const userId = req.user?.id;
      const userPapel = req.user?.papel;

      if (!userId) {
        return res.status(401).json({
          isAuthenticated: false,
          isSubscriptionActive: false,
          hasHadActiveSubscription: false,
          message: "Usuário não autenticado",
        });
      }

      if (userPapel !== "usuario") {
        return res.status(200).json({
          isAuthenticated: true,
          isSubscriptionActive: false,
          isSubscriptionExpired: false,
          hasHadActiveSubscription: false,
          hasAnySubscription: false,
          papel: userPapel,
        });
      }

      await pool.execute(
        'UPDATE assinaturas SET status = "vencida" WHERE usuario_id = ? AND status = "ativa" AND data_vencimento <= NOW()',
        [userId]
      );

      const [assinaturaAtivaRows] = await pool.execute(
        'SELECT status FROM assinaturas WHERE usuario_id = ? AND status = "ativa" AND data_vencimento > NOW()',
        [userId]
      );
      const isSubscriptionActive = assinaturaAtivaRows.length > 0;

      const [assinaturaVencidaRows] = await pool.execute(
        'SELECT status FROM assinaturas WHERE usuario_id = ? AND status = "vencida"',
        [userId]
      );
      const isSubscriptionExpired = assinaturaVencidaRows.length > 0;

      const [assinaturaHistoricoRows] = await pool.execute(
        'SELECT COUNT(*) AS total FROM assinaturas WHERE usuario_id = ? AND status = "ativa"',
        [userId]
      );
      const hasHadActiveSubscription = assinaturaHistoricoRows[0].total > 0;

      const [anySubscriptionRows] = await pool.execute(
        "SELECT COUNT(*) AS total FROM assinaturas WHERE usuario_id = ?",
        [userId]
      );
      const hasAnySubscription = anySubscriptionRows[0].total > 0;

      return res.status(200).json({
        isAuthenticated: true,
        isSubscriptionActive,
        isSubscriptionExpired,
        hasHadActiveSubscription,
        hasAnySubscription,
        papel: userPapel,
      });
    } catch (error) {
      console.error("Erro ao verificar status da autenticação:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async checkAdminAuthStatus(req, res) {
    try {
      if (req.user?.papel !== "admin") {
        return res.status(401).json({
          isAuthenticated: false,
          message: "Admin não autenticado",
        });
      }
      return res.status(200).json({ isAuthenticated: true });
    } catch (error) {
      console.error("Erro ao verificar status da autenticação admin:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getUserDetails(req, res) {
    try {
      const { id } = req.params;
      const [userRows] = await pool.execute(
        "SELECT id, nome, email, papel FROM usuarios WHERE id = ?",
        [id]
      );
      if (userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }
      res.status(200).json(userRows[0]);
    } catch (error) {
      console.error("Erro ao buscar detalhes do usuário:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async getCurrentUserDetails(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res
          .status(401)
          .json({ message: "Usuário não autenticado - ID faltando" });
      }

      const [userRows] = await pool.execute(
        "SELECT id, nome, email, papel FROM usuarios WHERE id = ?",
        [userId]
      );

      if (!userRows || userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      const usuario = userRows[0];
      return res.status(200).json(usuario);
    } catch (error) {
      console.error(
        "Erro inesperado ao buscar detalhes do usuário atual:",
        error
      );
      return res.status(500).json({ error: "Erro inesperado no servidor" });
    }
  }

  async getTokens(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(200).json({ sessions: [] });
      }

      const [sessions] = await pool.execute(
        `SELECT id, criado_em, expira_em, info_dispositivo, info_navegador, endereco_ip, papel 
         FROM sessoes_usuarios 
         WHERE usuario_id = ? AND esta_ativo = TRUE`,
        [userId]
      );

      return res.status(200).json({ sessions });
    } catch (error) {
      console.error("Erro ao obter tokens:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async createToken(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }
      
      const [userRows] = await pool.execute(
        "SELECT id, nome, email, papel FROM usuarios WHERE id = ?",
        [userId]
      );
      
      if (userRows.length === 0) {
          return res.status(404).json({ message: "Usuário não encontrado para criar novo token."});
      }
      
      const user = userRows[0];

      const token = jwt.sign(
        { id: user.id, email: user.email, nome: user.nome, papel: user.papel },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      await pool.execute(
        "INSERT INTO sessoes_usuarios (id, usuario_id, hash_token, expira_em, info_dispositivo, info_navegador, endereco_ip, papel) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), ?, ?, ?, ?)",
        [
          uuidv4(),
          user.id,
          crypto.createHash("sha256").update(token).digest("hex"),
          parseInt(process.env.JWT_EXPIRES_IN_SECONDS) || 28800,
          req.headers["user-agent"] || "unknown",
          req.headers["user-agent"] || "unknown",
          req.ip,
          user.papel,
        ]
      );

      return res.status(201).json({ message: "Token criado com sucesso.", token: token });
    } catch (error) {
      console.error("Erro ao criar token:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new AuthController();