import jwt from "jsonwebtoken";
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido nas variáveis de ambiente");
}

// Middleware de autenticação
export function authMiddleware(req, res, next) {
  let token;

  // 1. Tenta pegar o token do cabeçalho Authorization
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
    console.log("Token encontrado no header Authorization:", token);
  }
  // 2. Se não estiver no cabeçalho, tenta pegar do cookie (fallback)
  else if (req.cookies.jwt_token) {
    token = req.cookies.jwt_token;
    console.log("Token encontrado no cookie jwt_token:", token);
  }

  if (!token) {
    console.log("Token não fornecido na requisição");
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    console.log("Token verificado com sucesso. Payload:", decoded);
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      console.log("Token expirado:", err.message);
      return res.status(401).json({ error: "Token expirado" });
    }
    console.log("Token inválido:", err.message);
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Middleware que exige ser admin
export function requireAdmin(req, res, next) {
  if (!req.user) {
    console.log("RequireAdmin: Usuário não autenticado");
    return res.status(401).json({ error: "Usuário não autenticado" });
  }
  if (req.user.papel !== "admin") {
    console.log("RequireAdmin: Acesso negado para papel", req.user.papel);
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
