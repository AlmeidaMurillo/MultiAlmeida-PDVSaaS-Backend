import jwt from 'jsonwebtoken';
import pool from '../db.js';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  throw new Error("ACCESS_TOKEN_SECRET não definido nas variáveis de ambiente");
}

export async function authMiddleware(req, res, next) {
  let token = null;
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({ error: "Token de acesso não fornecido." });
  }

  if (token.split('.').length !== 3) {
    return res.status(401).json({ error: "Token malformado." });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
      algorithms: ['HS256'],
      complete: false
    });

    if (!decoded.id || !decoded.email || !decoded.papel) {
      return res.status(401).json({ error: 'Token inválido: payload incompleto.' });
    }

    const [sessionRows] = await pool.execute(
      'SELECT usuario_id, papel FROM sessoes_usuarios WHERE usuario_id = ? AND esta_ativo = TRUE AND expira_em > NOW()',
      [decoded.id]
    );

    if (sessionRows.length === 0) {
      if (req.cookies && req.cookies.accessToken) {
        res.clearCookie('accessToken');
      }
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    if (sessionRows[0].papel !== decoded.papel) {
      console.warn(`⚠️ Papel inconsistente para usuário ${decoded.id}`);
      return res.status(401).json({ error: 'Sessão inválida.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (req.cookies && req.cookies.accessToken) {
      res.clearCookie('accessToken');
    }
    
    console.warn(`⚠️ Falha de autenticação: ${err.message} | IP: ${req.ip}`);
    
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Token de acesso expirado." });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: "Token de acesso inválido." });
    }
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }
  if (req.user.papel !== "admin") {
    return res.status(403).json({ error: "Acesso negado" });
  }
  return next();
}

export async function requireSubscription(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  if (req.user.papel === "admin") {
    return next();
  }

  try {
    const [assinaturasRows] = await pool.execute(
      `SELECT id FROM assinaturas 
       WHERE usuario_id = ? 
       AND (status = 'ativa' OR status = 'vencida')`,
      [req.user.id]
    );

    if (assinaturasRows.length === 0) {
      return res.status(403).json({ 
        error: "Acesso negado. Você não possui uma assinatura ativa ou vencida para acessar o painel." 
      });
    }

    return next();
  } catch (err) {
    console.error("Erro na verificação de assinatura:", err);
    return res.status(500).json({ error: "Erro interno no servidor ao verificar assinatura." });
  }
}

