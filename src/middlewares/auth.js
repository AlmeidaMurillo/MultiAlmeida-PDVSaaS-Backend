import jwt from 'jsonwebtoken';
import pool from '../db.js';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
if (!ACCESS_TOKEN_SECRET) {
  throw new Error("ACCESS_TOKEN_SECRET não definido nas variáveis de ambiente");
}

export async function authMiddleware(req, res, next) {
  let token = null;
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  } else {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: "Token de acesso não fornecido." });
  }

  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);

    const [sessionRows] = await pool.execute(
      'SELECT 1 FROM sessoes_usuarios WHERE usuario_id = ? AND esta_ativo = TRUE',
      [decoded.id]
    );

    if (sessionRows.length === 0) {
      if (req.cookies && req.cookies.accessToken) {
        res.clearCookie('accessToken');
      }
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (req.cookies && req.cookies.accessToken) {
      res.clearCookie('accessToken');
    }
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Token de acesso expirado." });
    }
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ error: "Token de acesso inválido." });
    }
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
}

// O middleware optionalAuthMiddleware é complexo e não se alinha bem com o novo fluxo.
// A lógica do frontend com interceptors torna-o largamente desnecessário.
// Pode ser removido ou simplificado se um caso de uso específico permanecer.
export async function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
      req.user = decoded;
    } catch (err) {
      // Ignora o erro e continua sem usuário se o token for inválido/expirado
    }
  }
  next();
}


// Middleware que exige ser admin
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }
  // req.user.papel agora é uma string
  if (req.user.papel !== "admin") {
    return res.status(403).json({ error: "Acesso negado" });
  }
  return next();
}


// Middleware que exige empresa
export function requireEmpresa(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  // Admin tem acesso total
  if (req.user.papel === "admin") {
    return next();
  }

  // Usuário comum precisa ter empresa associada
  if (req.user.papel === "usuario") {
    const empresaId = req.headers["x-empresa-id"];
    if (!empresaId) {
      return res
        .status(400)
        .json({ error: "Empresa não selecionada. Use o header X-Empresa-ID" });
    }

    // Verifica se o usuário tem acesso à empresa
    const empresa = req.user.empresas?.find(
      (emp) => emp.empresa_id === empresaId
    );
    if (!empresa) {
      return res.status(403).json({ error: "Acesso negado à empresa selecionada" });
    }

    req.empresaAtual = empresaId;
    return next();
  }

  return res.status(403).json({ error: "Tipo de usuário não autorizado" });
}

// Middleware que exige assinatura ativa ou vencida para não-admins
export async function requireSubscription(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }

  // Admins sempre têm acesso
  if (req.user.papel === "admin") {
    return next();
  }

  // Verifica se o usuário não-admin tem uma assinatura ativa ou vencida
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

