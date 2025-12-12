import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { validationResult } from 'express-validator';
import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';


const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '2h';
const REFRESH_TOKEN_EXPIRES_IN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10);
const NODE_ENV = process.env.NODE_ENV;

if (!ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET não definido nas variáveis de ambiente');
}



const generateAccessToken = async (user) => {
  return jwt.sign(
    { 
      id: user.id, 
      nome: user.nome, 
      email: user.email, 
      papel: user.papel
    },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};


const setRefreshTokenCookie = (req, res, token) => {
  const origin = req.headers.origin || '';
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  
  const options = {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: isLocalhost ? 'lax' : 'none',
    path: '/', 
    maxAge: REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  };
  
  console.log('🍪 Definindo cookie refreshToken:', {
    origem: origin,
    isLocalhost,
    options
  });
  
  res.cookie('refreshToken', token, options);
};

// Limpa o cookie usando EXATAMENTE as mesmas configurações da criação
const clearRefreshTokenCookie = (req, res) => {
  const origin = req.headers.origin || '';
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  
  const options = {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: isLocalhost ? 'lax' : 'none',
    path: '/',
  };
  
  // Limpa o cookie definindo maxAge como 0
  res.clearCookie('refreshToken', options);
  
  // Garante que o cookie seja sobrescrito com valor vazio
  res.cookie('refreshToken', '', { ...options, maxAge: 0 });
};

// Access token NÃO é armazenado em cookie - fica no localStorage do frontend
// Apenas refresh token vai em cookie httpOnly




const findSessionByToken = async (refreshToken) => {
  const [sessions] = await pool.execute(
    'SELECT id, usuario_id, hash_token, expira_em FROM sessoes_usuarios WHERE esta_ativo = TRUE AND expira_em > NOW()'
  );

  for (const session of sessions) {
    const isValid = await bcrypt.compare(refreshToken, session.hash_token);
    if (isValid) {
      return session;
    }
  }
  return null;
};

class AuthController {
  async login(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, senha } = req.body;

    try {
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

      const accessToken = await generateAccessToken(usuario);
      const refreshToken = crypto.randomBytes(40).toString('hex');
      const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
      const refreshTokenExpires = new Date(
        Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      );

      await pool.execute(
        'UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE usuario_id = ?',
        [usuario.id]
      );
      
      await pool.execute(
        `INSERT INTO sessoes_usuarios 
         (id, usuario_id, hash_token, expira_em, info_dispositivo, info_navegador, endereco_ip, papel) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

      setRefreshTokenCookie(req, res, refreshToken);

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
    const { refreshToken } = req.cookies;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token não fornecido.' });
    }

    try {
      const validSession = await findSessionByToken(refreshToken);

      if (!validSession) {
        return res.status(403).json({ error: 'Refresh token inválido ou expirado.' });
      }

      // SEGURANÇA: Não renova a data de expiração - expira_em permanece a data original
      // Apenas atualiza o último acesso para tracking
      await pool.execute(
        'UPDATE sessoes_usuarios SET ultimo_acesso = NOW() WHERE id = ?',
        [validSession.id]
      );
      
      const [userRows] = await pool.execute('SELECT id, nome, email, papel FROM usuarios WHERE id = ?', [validSession.usuario_id]);
      if (userRows.length === 0) {
        console.log('❌ Usuário não encontrado');
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      const accessToken = await generateAccessToken(userRows[0]);
      
      // Não gera novo refresh token - mantém o mesmo
      return res.json({ accessToken });

    } catch (error) {
      console.error('❌ Erro ao renovar token:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async logout(req, res) {
    const { refreshToken } = req.cookies;

    try {
      // Se houver refresh token, desativa a sessão no banco
      if (refreshToken) {
        const validSession = await findSessionByToken(refreshToken);
        if (validSession) {
          await pool.execute('UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE id = ?', [validSession.id]);
        }
      }

      // SEMPRE limpa o cookie, mesmo se não houver token
      clearRefreshTokenCookie(req, res);
      
      // Retorna sucesso
      res.status(200).json({ message: 'Logout realizado com sucesso' });

    } catch (error) {
      console.error('Erro no logout:', error);
      
      // Mesmo com erro, limpa o cookie
      clearRefreshTokenCookie(req, res);
      
      res.status(500).json({ error: 'Erro ao realizar logout' });
    }
  }


  async hasRefresh(req, res) {
    const { refreshToken } = req.cookies;
    
    console.log('🔍 Verificando has-refresh:', {
      temCookie: !!refreshToken,
      cookies: Object.keys(req.cookies),
      origem: req.headers.origin
    });
    
    if (!refreshToken) {
      console.log('⚠️ Nenhum refreshToken encontrado nos cookies');
      return res.json({ hasRefresh: false, sessionActive: false });
    }

    try {
      const validSession = await findSessionByToken(refreshToken);
      console.log('✅ Sessão válida:', {
        encontrada: !!validSession,
        sessionId: validSession?.id
      });
      
      // Verifica se a sessão foi encontrada e se está ativa
      if (!validSession) {
        return res.json({ hasRefresh: false, sessionActive: false });
      }
      
      // Verifica se está ativa no banco (pode ter sido desativada por login em outro lugar)
      const [sessionRows] = await pool.execute(
        'SELECT esta_ativo FROM sessoes_usuarios WHERE id = ?',
        [validSession.id]
      );
      
      const isActive = sessionRows.length > 0 && sessionRows[0].esta_ativo === 1;
      
      console.log('✅ Status da sessão:', {
        sessionId: validSession.id,
        estaAtivo: isActive
      });
      
      return res.json({ 
        hasRefresh: isActive,
        sessionActive: isActive
      });
    } catch (error) {
      console.error('❌ Erro ao verificar has-refresh:', error);
      return res.json({ hasRefresh: false, sessionActive: false });
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

  
  async checkAuthStatus(req, res) {
    try {
      const userId = req.user?.id;
      const userPapel = req.user?.papel;

      if (!userId) {
        return res.status(401).json({
          isAuthenticated: false,
        });
      }

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

      
      const accessToken = await generateAccessToken(usuario);

      
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

      
      setRefreshTokenCookie(req, res, refreshToken);
      
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

export default new AuthController();