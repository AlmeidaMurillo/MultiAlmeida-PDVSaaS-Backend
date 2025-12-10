import pool from '../db.js';

class ContasController {
  async getSubscriptions(req, res) {
    try {
      const usuarioId = req.user.id;

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

export default new ContasController();
