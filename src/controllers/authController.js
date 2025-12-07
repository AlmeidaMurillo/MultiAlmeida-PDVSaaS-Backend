import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { validationResult } from 'express-validator';
import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';


const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRES_IN_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS || '7', 10);
const NODE_ENV = process.env.NODE_ENV;

if (!ACCESS_TOKEN_SECRET) {
  throw new Error('ACCESS_TOKEN_SECRET não definido nas variáveis de ambiente');
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
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/api/auth', 
    expires: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000),
  };
  res.cookie('refreshToken', token, options);
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

      
      const newRefreshToken = crypto.randomBytes(40).toString('hex');
      const newRefreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
      const newRefreshTokenExpires = new Date(
        Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      );

      await pool.execute(
        'UPDATE sessoes_usuarios SET hash_token = ?, expira_em = ?, ultimo_acesso = NOW() WHERE id = ?',
        [newRefreshTokenHash, newRefreshTokenExpires, validSession.id]
      );
      
      
      const [userRows] = await pool.execute('SELECT id, nome, email, papel FROM usuarios WHERE id = ?', [validSession.usuario_id]);
      if (userRows.length === 0) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      const accessToken = generateAccessToken(userRows[0]);
      
      
      setRefreshTokenCookie(res, newRefreshToken);
      return res.json({ accessToken });

    } catch (error) {
      console.error('Erro ao renovar token:', error);
      return res.status(500).json({ error: 'Erro interno do servidor' });
    }
  }

  async logout(req, res) {
    const { refreshToken } = req.cookies;
    console.log('Logout attempt with refreshToken:', refreshToken ? 'found' : 'missing');
    if (!refreshToken) {
      return res.status(204).send(); 
    }

    try {
       
       const [sessions] = await pool.execute(
        'SELECT id, hash_token FROM sessoes_usuarios WHERE esta_ativo = TRUE AND expira_em > NOW()'
      );
      console.log(`Found ${sessions.length} active sessions to check.`);

      let sessionIdToDeactivate = null;
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.hash_token);
        if (isValid) {
          sessionIdToDeactivate = session.id;
          console.log(`Match found! Session ID to deactivate: ${sessionIdToDeactivate}`);
          break;
        }
      }

      if (sessionIdToDeactivate) {
        await pool.execute('UPDATE sessoes_usuarios SET esta_ativo = FALSE WHERE id = ?', [sessionIdToDeactivate]);
        console.log(`Session ${sessionIdToDeactivate} deactivated.`);
      } else {
        console.log('No matching session found for the provided refresh token.');
      }

    } catch (error) {
      console.error('Erro no logout:', error);
      
    } finally {
      
      res.clearCookie('refreshToken', { httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
      res.status(204).send();
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

      // Buscar assinaturas do usuário com detalhes do plano
      const [assinaturasRows] = await pool.execute(
        `SELECT 
          a.id,
          a.plano_id,
          a.status,
          a.data_assinatura,
          a.data_vencimento,
          a.criado_em,
          p.nome as plano_nome,
          p.periodo,
          p.preco,
          p.duracao_dias,
          p.beneficios,
          p.quantidade_empresas
        FROM assinaturas a
        LEFT JOIN planos p ON a.plano_id = p.id
        WHERE a.usuario_id = ?
        ORDER BY a.data_vencimento DESC`,
        [userId]
      );

      return res.status(200).json({
        ...usuario,
        assinaturas: assinaturasRows || []
      });
    } catch (error) {
      console.error(
        "Erro inesperado ao buscar detalhes do usuário atual:",
        error
      );
      return res.status(500).json({ error: "Erro inesperado no servidor" });
    }
  }

  async updateCurrentUserDetails(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado." });
      }

      const { nome, email, telefone, cpf, empresa } = req.body;

      const [userRows] = await pool.execute("SELECT * FROM usuarios WHERE id = ?", [userId]);
      if (userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado." });
      }
      const usuario = userRows[0];

      // Atualizar dados do usuário
      await pool.execute(
        "UPDATE usuarios SET nome = ?, email = ?, telefone = ?, cpf = ? WHERE id = ?",
        [nome, email, telefone, cpf, userId]
      );

      // Atualizar dados da empresa, se houver
      if (usuario.empresa_id && empresa) {
        await pool.execute(
          "UPDATE empresas SET nome = ?, cnpj = ?, endereco = ? WHERE id = ?",
          [empresa.nome, empresa.cnpj, empresa.endereco, usuario.empresa_id]
        );
      }

      res.status(200).json({ message: "Dados atualizados com sucesso." });
    } catch (error) {
      console.error("Erro ao atualizar os dados do usuário:", error);
      res.status(500).json({ error: "Erro interno do servidor." });
    }
  }

  async changePassword(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }

      const { senhaAtual, novaSenha } = req.body;

      if (!senhaAtual || !novaSenha) {
        return res.status(400).json({ message: "Senha atual e nova senha são obrigatórias" });
      }

      // Buscar usuário para verificar senha atual
      const [userRows] = await pool.execute("SELECT senha FROM usuarios WHERE id = ?", [userId]);

      if (!userRows || userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      const usuario = userRows[0];
      const bcrypt = require('bcryptjs');
      const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha);

      if (!senhaValida) {
        return res.status(401).json({ message: "Senha atual incorreta" });
      }

      // Hash da nova senha
      const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

      // Atualizar senha
      await pool.execute("UPDATE usuarios SET senha = ? WHERE id = ?", [novaSenhaHash, userId]);

      return res.status(200).json({ message: "Senha alterada com sucesso" });
    } catch (error) {
      console.error("Erro ao alterar senha:", error);
      return res.status(500).json({ error: "Erro ao alterar senha" });
    }
  }

  async alterarPlano(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: "Usuário não autenticado" });
      }

      const { planoId, periodo } = req.body;

      if (!planoId || !periodo) {
        return res.status(400).json({ message: "Plano e período são obrigatórios" });
      }

      // Verificar se o plano existe
      const [planRows] = await pool.execute("SELECT * FROM planos WHERE id = ?", [planoId]);

      if (!planRows || planRows.length === 0) {
        return res.status(404).json({ message: "Plano não encontrado" });
      }

      const plano = planRows[0];

      // Calcular datas de assinatura
      const dataAssinatura = new Date().toISOString().split('T')[0];
      const dataVencimento = new Date();
      dataVencimento.setDate(dataVencimento.getDate() + plano.duracao_dias);
      const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

      // Verificar se já existe uma assinatura ativa
      const [assinaturaRows] = await pool.execute(
        "SELECT id FROM assinaturas WHERE usuario_id = ? AND status = 'ativa'",
        [userId]
      );

      if (assinaturaRows && assinaturaRows.length > 0) {
        // Atualizar assinatura existente
        await pool.execute(
          "UPDATE assinaturas SET plano_id = ?, data_assinatura = ?, data_vencimento = ?, status = 'ativa' WHERE usuario_id = ? AND status = 'ativa'",
          [planoId, dataAssinatura, dataVencimentoStr, userId]
        );
      } else {
        // Criar nova assinatura
        await pool.execute(
          "INSERT INTO assinaturas (usuario_id, plano_id, data_assinatura, data_vencimento, status) VALUES (?, ?, ?, ?, 'ativa')",
          [userId, planoId, dataAssinatura, dataVencimentoStr]
        );
      }

      return res.status(200).json({ message: "Plano alterado com sucesso" });
    } catch (error) {
      console.error("Erro ao alterar plano:", error);
      return res.status(500).json({ error: "Erro ao alterar plano" });
    }
  }
}

export default new AuthController();