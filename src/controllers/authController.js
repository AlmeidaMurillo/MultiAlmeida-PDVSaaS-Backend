import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { validationResult } from 'express-validator';
import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { logLogin, logLogout, logRegistro, logSessao } from '../utils/logger.js';

let sanitizeEmail = (email) => email?.toLowerCase().trim();
let sanitizeName = (name) => name?.trim();
let logLoginAttempt = () => {};
let logSecurityEvent = () => {};
let SecurityLevel = { INFO: 'INFO', WARNING: 'WARNING', CRITICAL: 'CRITICAL' };
let SecurityEvent = { LOGIN_SUCCESS: 'LOGIN_SUCCESS', LOGOUT: 'LOGOUT', SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY' };

try {
  const sanitizeModule = await import('../utils/sanitize.js');
  sanitizeEmail = sanitizeModule.sanitizeEmail;
  sanitizeName = sanitizeModule.sanitizeName;
} catch (err) {
  console.warn('⚠️  sanitize.js não disponível - usando sanitização básica');
}

try {
  const securityModule = await import('../utils/securityLogger.js');
  logLoginAttempt = securityModule.logLoginAttempt;
  logSecurityEvent = securityModule.logSecurityEvent;
  SecurityLevel = securityModule.SecurityLevel;
  SecurityEvent = securityModule.SecurityEvent;
} catch (err) {
  console.warn('⚠️  securityLogger.js não disponível - logging desabilitado');
}


const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '12h'; // Aumentado para 12h para evitar deslogamento
const REFRESH_TOKEN_EXPIRES_IN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '30', 10); // 30 dias padrão
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
  const isProduction = NODE_ENV === 'production';
  
  let isCrossSite = false;
  try {
    const originHost = origin ? new URL(origin).host : '';
    const backendHost = req.get('host');
    isCrossSite = !!origin && originHost && backendHost && originHost !== backendHost;
  } catch {}

  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isCrossSite ? 'none' : 'lax',
    path: '/', 
    maxAge: REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000,
  };
  
  if (!isLocalhost && !isProduction) {
    options.sameSite = 'none';
    options.secure = true;
  }
  
  res.cookie('refreshToken', token, options);
};

const clearRefreshTokenCookie = (req, res) => {
  const origin = req.headers.origin || '';
  const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
  const isProduction = NODE_ENV === 'production';
  
  let isCrossSite = false;
  try {
    const originHost = origin ? new URL(origin).host : '';
    const backendHost = req.get('host');
    isCrossSite = !!origin && originHost && backendHost && originHost !== backendHost;
  } catch {}
  
  const options = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isCrossSite ? 'none' : 'lax',
    path: '/',
  };
  
  if (!isLocalhost && !isProduction) {
    options.sameSite = 'none';
    options.secure = true;
  }
  
  res.clearCookie('refreshToken', options);
  
  res.cookie('refreshToken', '', { ...options, maxAge: 0 });
};

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

    let { email, senha } = req.body;
    
    email = sanitizeEmail(email);
    
    if (!email) {
      return res.status(400).json({ error: 'Email inválido' });
    }

    try {
      const [userRows] = await pool.execute(
        'SELECT id, nome, email, senha, papel FROM usuarios WHERE email = ?',
        [email]
      );
      
      const dummyHash = '$2a$10$abcdefghijklmnopqrstuv.wxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';
      const hashToCompare = userRows.length > 0 ? userRows[0].senha : dummyHash;
      const senhaCorreta = await bcrypt.compare(senha, hashToCompare);
      
      if (userRows.length === 0 || !senhaCorreta) {
        // Registrar tentativa de login falhada
        await logLogin(req, { 
          email,
          tentativa_ip: req.ip,
          user_agent: req.headers['user-agent'],
          motivo: userRows.length === 0 ? 'email_nao_encontrado' : 'senha_incorreta'
        }, false);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return res.status(401).json({ error: 'Email ou senha incorretos' });
      }

      const usuario = userRows[0];

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
      
      const sessionId = uuidv4();
      
      await pool.execute(
        `INSERT INTO sessoes_usuarios 
         (id, usuario_id, hash_token, expira_em, info_dispositivo, info_navegador, endereco_ip, papel) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
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

      // Registrar log de login
      await logLogin(req, {
        ...usuario,
        sessao_id: sessionId,
        token_expira_em: refreshTokenExpires.toISOString(),
        dispositivo: req.headers['user-agent'] || 'unknown',
        endereco_ip: req.ip
      }, true);

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

      await pool.execute(
        'UPDATE sessoes_usuarios SET ultimo_acesso = NOW() WHERE id = ?',
        [validSession.id]
      );
      
      const [userRows] = await pool.execute('SELECT id, nome, email, papel FROM usuarios WHERE id = ?', [validSession.usuario_id]);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      const accessToken = await generateAccessToken(userRows[0]);
      
      return res.json({ accessToken });

    } catch (error) {
      console.error('❌ Erro ao renovar token:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async logout(req, res) {
    const { refreshToken } = req.cookies;

    try {
      let userId = null;
      let userEmail = null;
      
      if (refreshToken) {
        const validSession = await findSessionByToken(refreshToken);
        if (validSession) {
          userId = validSession.usuario_id;
          
          // Buscar dados completos do usuário
          const [userRows] = await pool.execute('SELECT email, nome, papel FROM usuarios WHERE id = ?', [userId]);
          if (userRows.length > 0) {
            userEmail = userRows[0].email;
          }
          
          await pool.execute('UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE id = ?', [validSession.id]);
          
          // Registrar log de logout
          await logLogout(req, { 
            id: userId, 
            email: userEmail,
            nome: userRows.length > 0 ? userRows[0].nome : null,
            papel: userRows.length > 0 ? userRows[0].papel : null,
            sessao_id: validSession.id,
            dispositivo: req.headers['user-agent'] || 'unknown',
            endereco_ip: req.ip
          });
        }
      }

      clearRefreshTokenCookie(req, res);
      
      res.status(200).json({ message: 'Logout realizado com sucesso' });

    } catch (error) {
      console.error('Erro no logout:', error);
      
      clearRefreshTokenCookie(req, res);
      
      res.status(500).json({ error: 'Erro ao realizar logout' });
    }
  }


  async hasRefresh(req, res) {
    const { refreshToken } = req.cookies;
    
    if (!refreshToken) {
      return res.json({ hasRefresh: false, sessionActive: false });
    }

    try {
      const validSession = await findSessionByToken(refreshToken);
      
      if (!validSession) {
        return res.json({ hasRefresh: false, sessionActive: false });
      }
      
      const [sessionRows] = await pool.execute(
        'SELECT esta_ativo FROM sessoes_usuarios WHERE id = ?',
        [validSession.id]
      );
      
      const isActive = sessionRows.length > 0 && sessionRows[0].esta_ativo === 1;
      
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

      let { nome, email, senha } = req.body;

      if (!nome || !email || !senha) {
        return res
          .status(400)
          .json({ error: "Nome, email e senha são obrigatórios" });
      }
      
      nome = sanitizeName(nome);
      email = sanitizeEmail(email);
      
      if (!nome || !email) {
        return res.status(400).json({ error: "Nome ou email inválido" });
      }

      const [existingUsers] = await pool.execute(
        "SELECT id FROM usuarios WHERE email = ?",
        [email]
      );

      if (Array.isArray(existingUsers) && existingUsers.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
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
      
      // Registrar log de registro
      await logRegistro(req, {
        ...usuario,
        usuario_id: usuarioId,
        token_expira_em: refreshTokenExpires.toISOString(),
        dispositivo: req.headers['user-agent'] || 'unknown',
        endereco_ip: req.ip,
        metodo_registro: 'formulario_padrao'
      });
      
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