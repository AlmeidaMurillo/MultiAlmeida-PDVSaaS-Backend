import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";

class CarrinhoController {
  
  async listar(req, res) {
    try {
      const usuarioId = req.user.id;

      const [itens] = await pool.execute(`
        SELECT c.id, c.usuario_id, c.plano_id, c.periodo, c.quantidade, c.cupom_codigo, c.cupom_desconto, c.criado_em, c.atualizado_em,
               p.nome, p.preco, p.duracao_dias, p.beneficios,
               cup.tipo as cupom_tipo, cup.valor as cupom_valor
        FROM carrinho_usuarios c
        JOIN planos p ON c.plano_id = p.id AND c.periodo = p.periodo
        LEFT JOIN cupons cup ON c.cupom_codigo = cup.codigo
        WHERE c.usuario_id = ?
        ORDER BY c.criado_em DESC
      `, [usuarioId]);

      console.log(`[DEBUG] Carrinho carregado para usuário ${usuarioId}:`, itens.map(i => ({
        id: i.id,
        cupom_codigo: i.cupom_codigo,
        cupom_desconto: i.cupom_desconto,
        cupom_tipo: i.cupom_tipo
      })));

      // Formata os itens com os dados do plano parseados
      const itensFormatados = itens.map(item => ({
        id: item.id,
        usuario_id: item.usuario_id,
        plano_id: item.plano_id,
        periodo: item.periodo,
        quantidade: item.quantidade,
        cupom_codigo: item.cupom_codigo,
        cupom_desconto: item.cupom_desconto ? parseFloat(item.cupom_desconto) : 0,
        cupom_tipo: item.cupom_tipo,
        cupom_valor: item.cupom_valor ? parseFloat(item.cupom_valor) : null,
        criado_em: item.criado_em,
        atualizado_em: item.atualizado_em,
        nome: item.nome,
        preco: parseFloat(item.preco),
        duracao_dias: item.duracao_dias,
        beneficios: typeof item.beneficios === 'string' 
          ? JSON.parse(item.beneficios) 
          : item.beneficios
      }));

      res.json({ itens: itensFormatados });
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

  // Aplicar cupom ao carrinho
  async aplicarCupom(req, res) {
    try {
      const usuarioId = req.user.id;
      const { codigo } = req.body;

      if (!codigo) {
        return res.status(400).json({ error: "Código do cupom é obrigatório" });
      }

      // Buscar carrinho do usuário
      const [cartItems] = await pool.execute(
        `SELECT c.id, c.plano_id, c.quantidade, p.preco 
         FROM carrinho_usuarios c
         JOIN planos p ON c.plano_id = p.id AND c.periodo = p.periodo
         WHERE c.usuario_id = ?`,
        [usuarioId]
      );

      if (cartItems.length === 0) {
        return res.status(404).json({ error: "Carrinho vazio" });
      }

      // Calcular valor total
      const valorTotal = cartItems.reduce((total, item) => {
        return total + (parseFloat(item.preco) * item.quantidade);
      }, 0);

      // Validar cupom
      const [cupons] = await pool.execute(
        'SELECT * FROM cupons WHERE codigo = ?',
        [codigo.toUpperCase()]
      );

      if (cupons.length === 0) {
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      const cupom = cupons[0];
      const agora = new Date();
      const dataInicio = new Date(cupom.data_inicio);
      const dataFim = new Date(cupom.data_fim);

      // Verificar se está ativo
      if (!cupom.ativo) {
        return res.status(400).json({ error: 'Cupom inativo' });
      }

      // Verificar datas
      if (agora < dataInicio) {
        return res.status(400).json({ error: 'Cupom ainda não está disponível' });
      }

      if (agora > dataFim) {
        return res.status(400).json({ error: 'Cupom expirado' });
      }

      // Verificar quantidade máxima de usos
      if (cupom.quantidade_maxima !== null && cupom.quantidade_usada >= cupom.quantidade_maxima) {
        return res.status(400).json({ error: 'Cupom esgotado' });
      }

      // Calcular desconto
      let desconto = 0;
      if (cupom.tipo === 'percentual') {
        desconto = (valorTotal * parseFloat(cupom.valor)) / 100;
      } else {
        desconto = parseFloat(cupom.valor);
      }

      desconto = Math.min(desconto, valorTotal);

      // Atualizar todos os itens do carrinho com o cupom
      for (const item of cartItems) {
        await pool.execute(
          'UPDATE carrinho_usuarios SET cupom_codigo = ?, cupom_desconto = ? WHERE id = ?',
          [cupom.codigo, desconto, item.id]
        );
      }

      res.json({
        message: 'Cupom aplicado com sucesso',
        cupom: {
          codigo: cupom.codigo,
          tipo: cupom.tipo,
          valor: cupom.valor,
          desconto: parseFloat(desconto.toFixed(2)),
          valor_original: parseFloat(valorTotal.toFixed(2)),
          valor_final: parseFloat((valorTotal - desconto).toFixed(2))
        }
      });
    } catch (error) {
      console.error("Erro ao aplicar cupom:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  // Remover cupom do carrinho
  async removerCupom(req, res) {
    try {
      const usuarioId = req.user.id;

      await pool.execute(
        'UPDATE carrinho_usuarios SET cupom_codigo = NULL, cupom_desconto = 0 WHERE usuario_id = ?',
        [usuarioId]
      );

      res.json({ message: 'Cupom removido com sucesso' });
    } catch (error) {
      console.error("Erro ao remover cupom:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new CarrinhoController();
