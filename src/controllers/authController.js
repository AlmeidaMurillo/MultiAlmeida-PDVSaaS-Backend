import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { validationResult } from 'express-validator';
import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

// --- Variáveis de Ambiente ---
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10);
const NODE_ENV = process.env.NODE_ENV;

if (!ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET não definido nas variáveis de ambiente');
}

// --- Funções Auxiliares ---

/**
 * Gera um Access Token JWT.
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, nome: user.nome, email: user.email, papel: user.papel },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

/**
 * Define o cookie do Refresh Token na resposta.
 */
const setRefreshTokenCookie = (res, token) => {
  const options = {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth', // O cookie só será enviado para rotas de autenticação
    expires: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000),
  };
  res.cookie('refreshToken', token, options);
};

// --- Classe do Controlador ---

class AuthController {
  async login(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, senha } = req.body;

    try {
      // 1. Validar credenciais do usuário
      const [userRows] = await pool.execute(
        'SELECT id, nome, email, senha, papel FROM usuarios WHERE email = ?',
        [email]
      );
      if (userRows.length === 0) {
        return res.status(401).json({ error: 'Email ou senha incorretos' });
      }

      const usuario = userRows[0];
      const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
      if (!senhaCorreta) {
        return res.status(401).json({ error: 'Email ou senha incorretos' });
      }

      // 2. Gerar Access Token
      const accessToken = generateAccessToken(usuario);

      // 3. Gerar e Hashear Refresh Token
      const refreshToken = crypto.randomBytes(40).toString('hex');
      const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
      const refreshTokenExpires = new Date(
        Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      );

      // 4. Salvar sessão no banco (usando a tabela sessoes_usuarios)
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

      // 5. Enviar tokens
      setRefreshTokenCookie(res, refreshToken);

      return res.json({
        accessToken,
        user: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
      });

    } catch (error) {
      console.error('Erro no login:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async refresh(req, res) {
    // 1. Obter o refresh token do cookie
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token não fornecido.' });
    }

    try {
      // 2. Encontrar todas as sessões ativas do usuário
      const [sessions] = await pool.execute(
        'SELECT id, usuario_id, hash_token, expira_em FROM sessoes_usuarios WHERE esta_ativo = TRUE AND expira_em > NOW()'
      );

      let validSession = null;
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.hash_token);
        if (isValid) {
          validSession = session;
          break;
        }
      }

      if (!validSession) {
        return res.status(403).json({ error: 'Refresh token inválido ou expirado.' });
      }

      // 3. (Rotação) Gerar novo refresh token e atualizar no banco
      const newRefreshToken = crypto.randomBytes(40).toString('hex');
      const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
      const newRefreshTokenExpires = new Date(
        Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      );

      await pool.execute(
        'UPDATE sessoes_usuarios SET hash_token = ?, expira_em = ?, ultimo_acesso = NOW() WHERE id = ?',
        [newRefreshTokenHash, newRefreshTokenExpires, validSession.id]
      );
      
      // 4. Gerar novo access token
      const [userRows] = await pool.execute('SELECT id, nome, email, papel FROM usuarios WHERE id = ?', [validSession.usuario_id]);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      const accessToken = generateAccessToken(userRows[0]);
      
      // 5. Enviar novos tokens
      setRefreshTokenCookie(res, newRefreshToken);
      return res.json({ accessToken });

    } catch (error) {
      console.error('Erro ao renovar token:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async logout(req, res) {
    const { refreshToken } = req.cookies;
    if (!refreshToken) {
      return res.status(204).send(); // Nenhuma ação necessária se não há token
    }

    try {
       // Precisamos encontrar o hash correspondente para invalidá-lo
       const [sessions] = await pool.execute(
        'SELECT id, hash_token FROM sessoes_usuarios WHERE esta_ativo = TRUE AND expira_em > NOW()'
      );

      let sessionIdToDeactivate = null;
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.hash_token);
        if (isValid) {
          sessionIdToDeactivate = session.id;
          break;
        }
      }

      if (sessionIdToDeactivate) {
        await pool.execute('UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE id = ?', [sessionIdToDeactivate]);
      }

    } catch (error) {
      console.error('Erro no logout:', error);
      // Não bloqueie o logout do cliente por um erro de servidor
    } finally {
      // Sempre limpe o cookie do cliente
      res.clearCookie('refreshToken', { httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
      res.status(204).send();
    }
  }

// ... (outros métodos como checkAuthStatus, getUserDetails, etc. podem permanecer aqui)
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
  
  async checkAuthStatus(req, res) {
    try {
      const userId = req.user?.id;
      const userPapel = req.user?.papel;

      if (!userId) {
        return res.status(401).json({
          isAuthenticated: false,
        });
      }

      // A verificação de assinatura permanece a mesma
      if (userPapel === 'usuario') {
        const [assinaturaAtivaRows] = await pool.execute(
          'SELECT 1 FROM assinaturas WHERE usuario_id = ? AND status = "ativa" AND data_vencimento > NOW() LIMIT 1',
          [userId]
        );
        const [assinaturaVencidaRows] = await pool.execute(
          'SELECT 1 FROM assinaturas WHERE usuario_id = ? AND status = "vencida" LIMIT 1',
          [userId]
        );
        
        return res.status(200).json({
          isAuthenticated: true,
          papel: userPapel,
          isSubscriptionActive: assinaturaAtivaRows.length > 0,
          isSubscriptionExpired: assinaturaVencidaRows.length > 0
        });
      }

      return res.status(200).json({
        isAuthenticated: true,
        papel: userPapel,
      });

    } catch (error) {
      console.error("Erro ao verificar status da autenticação:", error);
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
}

export default new AuthController();