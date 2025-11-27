import jwt from "jsonwebtoken";
import dotenv from 'dotenv';
import pool from '../db.js';
import crypto from 'crypto';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

// Middleware de autenticação opcional
export async function optionalAuthMiddleware(req, res, next) {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    
    // Busca a sessão no banco de dados pelo hash do token
    const [sessionRows] = await pool.execute(
      "SELECT id, usuario_id, expira_em, esta_ativo FROM sessoes_usuarios WHERE hash_token = ?",
      [tokenHash]
    );

    // Se a sessão for encontrada, for válida e estiver ativa, anexa o usuário
    if (sessionRows.length > 0) {
      const session = sessionRows[0];
      const agora = new Date();

      if (session.esta_ativo && agora <= new Date(session.expira_em)) {
        req.user = {
            id: decoded.id,
            email: decoded.email,
            nome: decoded.nome,
            papel: session.papel, // Usa o papel da sessão do banco de dados
            tokenHash: tokenHash
        };
      }
    }
    
    // Continua para a próxima rota, com ou sem usuário autenticado
    return next();
  } catch (err) {
    // Se o token for inválido (assinatura, etc.), continua sem usuário autenticado
    return next();
  }
}

// Middleware de autenticação (estrito)
export async function authMiddleware(req, res, next) {
  let token;

  // 1. Tenta pegar o token do cabeçalho Authorization
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    // 1. Verifica a assinatura do JWT e decodifica sem verificar a expiração, pois o DB é a fonte da verdade.
    const decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // 2. Busca a sessão no banco de dados pelo hash do token
    const [sessionRows] = await pool.execute(
      "SELECT id, usuario_id, expira_em, esta_ativo, papel FROM sessoes_usuarios WHERE hash_token = ?",
      [tokenHash]
    );

    if (sessionRows.length === 0) {
      return res.status(401).json({ error: "Sessão inválida. Por favor, faça login novamente." });
    }

    const session = sessionRows[0];
    const agora = new Date();

    // 3. Verifica se a sessão está ativa e se não expirou.
    if (!session.esta_ativo || agora > new Date(session.expira_em)) {
      // Se a sessão expirou e ainda está marcada como ativa, inativa-a.
      if (session.esta_ativo) {
        await pool.execute(
          "UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE id = ?",
          [session.id]
        );
      } else {
      }
      return res.status(401).json({ error: "Sessão expirada ou inválida. Por favor, faça login novamente." });
    }

    // 4. Se a sessão é válida, anexa os dados do JWT decodificado ao request.
    req.user = { 
        id: decoded.id, 
        email: decoded.email, 
        nome: decoded.nome, 
        papel: session.papel, // Usa o papel da sessão do banco de dados
        tokenHash: tokenHash 
    };
    return next();

  } catch (err) {
    // Este catch agora lida principalmente com JWTs malformados ou com assinatura inválida.
    if (err instanceof jwt.JsonWebTokenError) {
      console.log("Erro de JWT:", err.message);
      return res.status(401).json({ error: "Token inválido ou malformado." });
    }
    
    // Outros erros inesperados
    console.error("Erro inesperado no middleware de autenticação:", err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
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

