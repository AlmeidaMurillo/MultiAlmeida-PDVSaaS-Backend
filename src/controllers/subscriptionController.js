import pool from '../db.js';

class SubscriptionController {
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

      const [planRows] = await pool.execute("SELECT * FROM planos WHERE id = ?", [planoId]);

      if (!planRows || planRows.length === 0) {
        return res.status(404).json({ message: "Plano não encontrado" });
      }

      const plano = planRows[0];

      const dataAssinatura = new Date().toISOString().split('T')[0];
      const dataVencimento = new Date();
      dataVencimento.setDate(dataVencimento.getDate() + plano.duracao_dias);
      const dataVencimentoStr = dataVencimento.toISOString().split('T')[0];

      const [assinaturaRows] = await pool.execute(
        "SELECT id FROM assinaturas WHERE usuario_id = ? AND status = 'ativa'",
        [userId]
      );

      if (assinaturaRows && assinaturaRows.length > 0) {
        await pool.execute(
          "UPDATE assinaturas SET plano_id = ?, data_assinatura = ?, data_vencimento = ?, status = 'ativa' WHERE usuario_id = ? AND status = 'ativa'",
          [planoId, dataAssinatura, dataVencimentoStr, userId]
        );
      } else {
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

export default new SubscriptionController();
