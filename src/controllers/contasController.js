import bcrypt from 'bcryptjs';
import { validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';


const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10);
const NODE_ENV = process.env.NODE_ENV;

if (!ACCESS_TOKEN_SECRET) {
  throw new Error("ACCESS_TOKEN_SECRET não definido nas variáveis de ambiente");
}



const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, nome: user.nome, email: user.email, papel: user.papel },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

const setRefreshTokenCookie = (res, token) => {
  const options = {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    expires: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000),
  };
  res.cookie('refreshToken', token, options);
};


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

      const [existingUsers] = await pool.execute(
        "SELECT id FROM usuarios WHERE email = ?",
        [email]
      );

      if (Array.isArray(existingUsers) && existingUsers.length > 0) {
        return res.status(409).json({ error: "Email já cadastrado" });
      }

      
      const usuarioId = uuidv4();
      const senhaHash = await bcrypt.hash(senha, 10);
      const papel = "usuario";

      await pool.execute(
        "INSERT INTO usuarios (id, nome, email, senha, papel) VALUES (?, ?, ?, ?, ?)",
        [usuarioId, nome, email, senhaHash, papel]
      );
      
      const usuario = { id: usuarioId, nome, email, papel };

      
      const accessToken = generateAccessToken(usuario);

      
      const refreshToken = crypto.randomBytes(40).toString('hex');
      const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
      const refreshTokenExpires = new Date(
        Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      );

      
      await pool.execute(
        `INSERT INTO sessoes_usuarios 
         (id, usuario_id, hash_token, expira_em, info_dispositivo, info_navegador, endereco_ip, papel, esta_ativo) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
          uuidv4(),
          usuario.id,
          refreshTokenHash,
          refreshTokenExpires,
          req.headers['user-agent'] || 'unknown',
          req.headers['user-agent'] || 'unknown',
          req.ip,
          usuario.papel,
        ]
      );

      
      setRefreshTokenCookie(res, refreshToken);
      
      return res.status(201).json({
        message: "Conta criada com sucesso",
        accessToken,
        user: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
      });

    } catch (error) {
      console.error("Erro ao criar conta:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new ContasController();
