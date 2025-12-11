import pool from '../db.js';
import bcrypt from 'bcryptjs';

class UserController {
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

      const { nome, email } = req.body;

      const [userRows] = await pool.execute("SELECT * FROM usuarios WHERE id = ?", [userId]);
      if (userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado." });
      }

      await pool.execute(
        "UPDATE usuarios SET nome = ?, email = ? WHERE id = ?",
        [nome, email, userId]
      );


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

      const [userRows] = await pool.execute("SELECT senha FROM usuarios WHERE id = ?", [userId]);

      if (!userRows || userRows.length === 0) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      const usuario = userRows[0];
      const senhaValida = await bcrypt.compare(senhaAtual, usuario.senha);

      if (!senhaValida) {
        return res.status(401).json({ message: "Senha atual incorreta" });
      }

      const novaSenhaHash = await bcrypt.hash(novaSenha, 10);

      await pool.execute("UPDATE usuarios SET senha = ? WHERE id = ?", [novaSenhaHash, userId]);

      return res.status(200).json({ message: "Senha alterada com sucesso" });
    } catch (error) {
      console.error("Erro ao alterar senha:", error);
      return res.status(500).json({ error: "Erro ao alterar senha" });
    }
  }

  async me(req, res) {
    res.status(200).json({ user: req.user });
  }

  async getSubscriptions(req, res) {
    try {
      const usuarioId = req.user?.id;

      if (!usuarioId) {
        return res.status(401).json({ error: "Usuário não autenticado" });
      }

      const [subscriptions] = await pool.execute(
        "SELECT * FROM assinaturas WHERE usuario_id = ?",
        [usuarioId]
      );

      return res.status(200).json(subscriptions);
    } catch (error) {
      console.error("Erro ao buscar assinaturas:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new UserController();
