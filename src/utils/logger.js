import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Sistema centralizado de logs no MySQL
 * Todos os logs do sistema são salvos aqui
 */

/**
 * Registra um evento no sistema
 * @param {string} tipo - Tipo do log: 'rate_limit', 'login', 'logout', 'registro', 'pagamento', 'compra', 'erro', 'admin', 'sessao', 'acesso'
 * @param {object} req - Request do Express (opcional)
 * @param {string} acao - Descrição da ação
 * @param {object} detalhes - Detalhes adicionais (será convertido para JSON)
 * @param {object} usuario - Dados do usuário (opcional)
 */
export async function log(tipo, req, acao, detalhes = {}, usuario = null) {
  try {
    const id = uuidv4();
    const usuarioId = usuario?.id || req?.user?.id || null;
    const email = usuario?.email || req?.user?.email || null;
    const nome = usuario?.nome || req?.user?.nome || null;
    const cargo = usuario?.papel || req?.user?.papel || null;
    const ip = req?.ip || req?.connection?.remoteAddress || null;
    
    await pool.execute(
      `INSERT INTO logs_sistema (id, tipo, usuario_id, email, nome, cargo, ip, acao, detalhes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tipo,
        usuarioId,
        email,
        nome,
        cargo,
        ip,
        acao,
        JSON.stringify(detalhes)
      ]
    );

    // Log no console apenas para erros críticos em desenvolvimento
    if (process.env.NODE_ENV !== 'production' && (tipo === 'erro' || tipo === 'ataque_detectado')) {
      console.log(`📝 [${tipo.toUpperCase()}] ${acao}`, {
        usuario: email || usuarioId || 'anônimo',
        nome: nome || 'N/A',
        cargo: cargo || 'N/A',
        ip,
      });
    }
  } catch (error) {
    // Não deixar o log quebrar a aplicação
    console.error('❌ Erro ao registrar log:', error);
  }
}

/**
 * Atalhos para tipos específicos de logs
 */

export const logRateLimit = async (req, limiterName) => {
  await log('rate_limit', req, `Rate limit atingido: ${limiterName}`, {
    rota: req.path,
    metodo: req.method,
    limiter: limiterName,
    userAgent: req.get('user-agent'),
  });
};

export const logLogin = async (req, usuario, sucesso = true) => {
  await log(
    'login',
    req,
    sucesso ? 'Login realizado com sucesso' : 'Tentativa de login falhou',
    {
      sucesso,
      userAgent: req.get('user-agent'),
      navegador: req.get('user-agent')?.split(' ')[0] || 'desconhecido',
    },
    usuario
  );
};

export const logLogout = async (req, usuario) => {
  await log('logout', req, 'Logout realizado', {
    userAgent: req.get('user-agent'),
  }, usuario);
};

export const logRegistro = async (req, usuario) => {
  await log('registro', req, 'Novo usuário registrado', {
    nome: usuario.nome,
    papel: usuario.papel,
  }, usuario);
};

export const logPagamento = async (req, usuario, acao, detalhes) => {
  await log('pagamento', req, acao, detalhes, usuario);
};

export const logCompra = async (req, usuario, detalhes) => {
  await log('compra', req, 'Compra realizada', detalhes, usuario);
};

export const logErro = async (req, erro, detalhes = {}) => {
  await log('erro', req, erro.message || 'Erro no sistema', {
    ...detalhes,
    stack: erro.stack,
    codigo: erro.code,
  });
};

export const logAdmin = async (req, acao, detalhes = {}) => {
  await log('admin', req, acao, detalhes);
};

export const logSessao = async (req, acao, detalhes = {}) => {
  await log('sessao', req, acao, detalhes);
};

export const logAcesso = async (req, recurso, detalhes = {}) => {
  await log('acesso', req, `Acesso a ${recurso}`, detalhes);
};

export default {
  log,
  logRateLimit,
  logLogin,
  logLogout,
  logRegistro,
  logPagamento,
  logCompra,
  logErro,
  logAdmin,
  logSessao,
  logAcesso,
};
