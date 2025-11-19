import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { validationResult } from "express-validator";
import pool from "../db.js";

dotenv.config();

// 🔐 Configuração do JWT
const JWT_SECRET = process.env.JWT_SECRET || "";
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

class AuthController {
  // 🔑 Login
  async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, senha } = req.body;

      // 🔎 Tenta login como admin
      const [adminRows] = await pool.execute(
        "SELECT * FROM admins WHERE email = ?",
        [email]
      );

      if (adminRows.length > 0) {
        const admin = adminRows[0];

        if (await bcrypt.compare(senha, admin.senha)) {
          const token = jwt.sign(
            { id: admin.id, email: admin.email, papel: "admin" },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES }
          );

          const { senha: _, ...adminSemSenha } = admin;

          res.cookie("jwt_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 8 * 60 * 60 * 1000, // 8h
          });

          return res.json({ user: adminSemSenha, tipo: "admin", token });
        } else {
          return res.status(401).json({ error: "Email ou senha incorretos" });
        }
      }

      // 👤 Se não for admin, tenta login como usuário
      const [userRows] = await pool.execute(
        "SELECT * FROM usuarios WHERE email = ?",
        [email]
      );

      if (userRows.length === 0) {
        return res.status(401).json({ error: "Email ou senha incorretos" });
      }

      const usuario = userRows[0];

      if (!(await bcrypt.compare(senha, usuario.senha))) {
        return res.status(401).json({ error: "Email ou senha incorretos" });
      }

      const token = jwt.sign(
        { id: usuario.id, email: usuario.email, papel: "usuario" },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      const { senha: _, ...usuarioSemSenha } = usuario;

      res.cookie("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 8 * 60 * 60 * 1000, // 8h
      });

      return res.json({ user: usuarioSemSenha, tipo: "usuario", token });
    } catch (error) {
      console.error("Erro no login:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  // 🚪 Logout
  async logout(req, res) {
    res.clearCookie("jwt_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
    return res.status(200).json({ message: "Logout realizado com sucesso" });
  }

  // 🔑 Verificar token
  async verificarToken(req, res) {
    if (!req.user) {
      return res
        .status(401)
        .json({ message: "Token não fornecido ou inválido" });
    }
    return res.json({ user: req.user });
  }

  // 👥 Verificar status da autenticação e assinatura
  async checkAuthStatus(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          isAuthenticated: false,
          isSubscriptionActive: false,
          message: "Usuário não autenticado",
        });
      }

      const [assinaturaRows] = await pool.execute(
        'SELECT status FROM assinaturas WHERE usuario_id = ? AND status = "ativa" AND data_vencimento > NOW()',
        [userId]
      );

      const isSubscriptionActive = assinaturaRows.length > 0;

      return res
        .status(200)
        .json({ isAuthenticated: true, isSubscriptionActive });
    } catch (error) {
      console.error("Erro ao verificar status da autenticação:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  // 👑 Verificar status da autenticação do admin
  async checkAdminAuthStatus(req, res) {
    try {
      const userId = req.user?.id;
      const papel = req.user?.papel;

      if (!userId || papel !== "admin") {
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

  // 👤 Buscar detalhes de um usuário
  async getUserDetails(req, res) {
    try {
      const { id } = req.params;

      const [userRows] = await pool.execute(
        "SELECT id, nome, email FROM usuarios WHERE id = ?",
        [id]
      );

      if (userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      const usuario = userRows[0];

      return res.status(200).json({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
      });
    } catch (error) {
      console.error("Erro ao buscar detalhes do usuário:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  // 👤 Buscar detalhes do usuário atual
  async getCurrentUserDetails(req, res) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }

      const [userRows] = await pool.execute(
        "SELECT id, nome, email FROM usuarios WHERE id = ?",
        [userId]
      );

      if (userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      const usuario = userRows[0];

      return res.status(200).json({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
      });
    } catch (error) {
      console.error("Erro ao buscar detalhes do usuário atual:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new AuthController();
