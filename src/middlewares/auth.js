import jwt from "jsonwebtoken";

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
  }
  // 2. Se não estiver no cabeçalho, tenta pegar do cookie (fallback)
  else if (req.cookies.jwt_token) {
    token = req.cookies.jwt_token;
  }

  if (!token) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado" });
    }
    return res.status(401).json({ error: "Token inválido" });
  }
}

// Middleware que exige ser admin
export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Usuário não autenticado" });
  }
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
