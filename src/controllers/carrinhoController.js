import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";

class CarrinhoController {
  
  async listar(req, res) {
    try {
      const usuarioId = req.user.id;

      const [itens] = await pool.execute(`
        SELECT c.*, p.nome, p.preco, p.duracao_dias, p.beneficios
        FROM carrinho_usuarios c
        JOIN planos p ON c.plano_id = p.id
        WHERE c.usuario_id = ?
        ORDER BY c.criado_em DESC
      `, [usuarioId]);

      res.json({ itens });
    } catch (error) {
      console.error("Erro ao listar carrinho:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  
  async adicionar(req, res) {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        if (!req.user || !req.user.id) {
          await connection.rollback();
          return res.status(401).json({ error: "Usuário não autenticado." });
        }

        const usuarioId = req.user.id;
        const { planoId, periodo, quantidade = 1 } = req.body;

        if (!planoId || !periodo) {
          await connection.rollback();
          return res.status(400).json({ error: "Plano e período são obrigatórios" });
        }

        
        const [planos] = await connection.execute(
          "SELECT id FROM planos WHERE id = ? AND periodo = ?",
          [planoId, periodo]
        );

        if (planos.length === 0) {
          await connection.rollback();
          return res.status(404).json({ error: "Plano não encontrado" });
        }

        
        await connection.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuarioId]);

        
        const id = uuidv4();
        await connection.execute(
          "INSERT INTO carrinho_usuarios (id, usuario_id, plano_id, periodo, quantidade) VALUES (?, ?, ?, ?, ?)",
          [id, usuarioId, planoId, periodo, quantidade]
        );

        await connection.commit();
        res.json({ message: "Item adicionado ao carrinho" });
        return; 
      } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_LOCK_DEADLOCK' && retries < maxRetries - 1) {
          retries++;
          console.log(`Deadlock detected, retrying... (${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 100)); 
          continue;
        }
        console.error("Erro ao adicionar ao carrinho:", error);
        res.status(500).json({ error: "Erro interno do servidor" });
        return;
      } finally {
        connection.release();
      }
    }
  }

  
  async remover(req, res) {
    try {
      const usuarioId = req.user.id;
      const { id } = req.params;

      const [result] = await pool.execute(
        "DELETE FROM carrinho_usuarios WHERE id = ? AND usuario_id = ?",
        [id, usuarioId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Item não encontrado no carrinho" });
      }

      res.json({ message: "Item removido do carrinho" });
    } catch (error) {
      console.error("Erro ao remover do carrinho:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  
  async limpar(req, res) {
    try {
      const usuarioId = req.user.id;

      await pool.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuarioId]);

      res.json({ message: "Carrinho limpo" });
    } catch (error) {
      console.error("Erro ao limpar carrinho:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  
  async atualizarQuantidade(req, res) {
    try {
      const usuarioId = req.user.id;
      const { id } = req.params;
      const { quantidade } = req.body;

      if (quantidade <= 0) {
        return res.status(400).json({ error: "Quantidade deve ser maior que zero" });
      }

      const [result] = await pool.execute(
        "UPDATE carrinho_usuarios SET quantidade = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ?",
        [quantidade, id, usuarioId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Item não encontrado no carrinho" });
      }

      res.json({ message: "Quantidade atualizada" });
    } catch (error) {
      console.error("Erro ao atualizar quantidade:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new CarrinhoController();
