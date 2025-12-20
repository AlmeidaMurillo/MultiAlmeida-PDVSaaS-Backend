import pool from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { log } from '../utils/logger.js';

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

        if (periodo !== 'mensal' && periodo !== 'anual') {
          await connection.rollback();
          return res.status(400).json({ 
            error: "Período inválido. Use 'mensal' ou 'anual'." 
          });
        }

        // SEGURANÇA: Validar quantidade no backend - NÃO CONFIAR NO FRONTEND
        const quantidadeInt = parseInt(quantidade);
        if (isNaN(quantidadeInt) || quantidadeInt < 1 || quantidadeInt > 100) {
          await connection.rollback();
          return res.status(400).json({ 
            error: "Quantidade inválida. Deve ser entre 1 e 100" 
          });
        }

        
        const [planos] = await connection.execute(
          "SELECT id FROM planos WHERE id = ? AND periodo = ?",
          [planoId, periodo]
        );

        if (planos.length === 0) {
          await connection.rollback();
          return res.status(404).json({ error: "Plano não encontrado" });
        }

        const [existingItems] = await connection.execute(
          "SELECT id FROM carrinho_usuarios WHERE usuario_id = ? AND plano_id = ? AND periodo = ?",
          [usuarioId, planoId, periodo]
        );

        if (existingItems.length > 0) {
          await connection.commit();
          return res.json({ message: "Item já está no carrinho" });
        }

        await connection.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuarioId]);

        
        const id = uuidv4();
        await connection.execute(
          "INSERT INTO carrinho_usuarios (id, usuario_id, plano_id, periodo, quantidade) VALUES (?, ?, ?, ?, ?)",
          [id, usuarioId, planoId, periodo, quantidadeInt]
        );

        await connection.commit();
        
        // Buscar detalhes do plano adicionado
        const [planoDetalhes] = await connection.execute(
          'SELECT nome, periodo, preco FROM planos WHERE id = ? AND periodo = ?',
          [planoId, periodo]
        );

        await log('carrinho_adicionar', req, 'Adicionou item ao carrinho', { 
          item_id: id,
          plano_id: planoId,
          plano_nome: planoDetalhes[0]?.nome,
          periodo,
          quantidade,
          preco_unitario: planoDetalhes[0] ? parseFloat(planoDetalhes[0].preco) : null,
          valor_total: planoDetalhes[0] ? parseFloat(planoDetalhes[0].preco) * quantidade : null,
          adicionado_em: new Date().toISOString()
        });
        
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

      // Buscar detalhes antes de remover
      const [itemDetalhes] = await pool.execute(
        `SELECT c.id, c.plano_id, c.periodo, c.quantidade, p.nome, p.preco
         FROM carrinho_usuarios c
         JOIN planos p ON c.plano_id = p.id AND c.periodo = p.periodo
         WHERE c.id = ? AND c.usuario_id = ?`,
        [id, usuarioId]
      );

      const [result] = await pool.execute(
        "DELETE FROM carrinho_usuarios WHERE id = ? AND usuario_id = ?",
        [id, usuarioId]
      );

      if (result.affectedRows === 0) {
        await log('tentativa_acesso', req, 'Tentou remover item inexistente do carrinho', { 
          item_id: id,
          tentativa_ip: req.ip,
          timestamp: new Date().toISOString()
        });
        return res.status(404).json({ error: "Item não encontrado no carrinho" });
      }

      const item = itemDetalhes[0];
      await log('carrinho_remover', req, 'Removeu item do carrinho', { 
        item_id: id,
        plano_id: item.plano_id,
        plano_nome: item.nome,
        periodo: item.periodo,
        quantidade: item.quantidade,
        valor_removido: parseFloat(item.preco) * item.quantidade,
        removido_em: new Date().toISOString()
      });

      res.json({ message: "Item removido do carrinho" });
    } catch (error) {
      console.error("Erro ao remover do carrinho:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  
  async limpar(req, res) {
    try {
      const usuarioId = req.user.id;

      // Buscar detalhes antes de limpar
      const [itensCarrinho] = await pool.execute(
        `SELECT c.id, c.plano_id, c.quantidade, c.cupom_codigo, c.cupom_desconto, p.nome, p.preco
         FROM carrinho_usuarios c
         JOIN planos p ON c.plano_id = p.id AND c.periodo = p.periodo
         WHERE c.usuario_id = ?`,
        [usuarioId]
      );

      const valorTotal = itensCarrinho.reduce((total, item) => {
        return total + (parseFloat(item.preco) * item.quantidade);
      }, 0);

      const [result] = await pool.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuarioId]);

      await log('carrinho_limpar', req, 'Limpou o carrinho', { 
        itens_removidos: result.affectedRows,
        itens_detalhes: itensCarrinho.map(item => ({
          plano_nome: item.nome,
          quantidade: item.quantidade,
          valor: parseFloat(item.preco) * item.quantidade
        })),
        valor_total_perdido: parseFloat(valorTotal.toFixed(2)),
        cupom_aplicado: itensCarrinho[0]?.cupom_codigo || null,
        limpo_em: new Date().toISOString()
      });

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

      // SEGURANÇA: Validar quantidade rigorosamente no backend
      const quantidadeInt = parseInt(quantidade);
      if (isNaN(quantidadeInt) || quantidadeInt < 1 || quantidadeInt > 100) {
        return res.status(400).json({ 
          error: "Quantidade inválida. Deve ser entre 1 e 100" 
        });
      }

      const [result] = await pool.execute(
        "UPDATE carrinho_usuarios SET quantidade = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ?",
        [quantidadeInt, id, usuarioId]
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

  async aplicarCupom(req, res) {
    try {
      const usuarioId = req.user.id;
      const { codigo } = req.body;

      if (!codigo) {
        return res.status(400).json({ error: "Código do cupom é obrigatório" });
      }


      const [cartItems] = await pool.execute(
        `SELECT c.id, c.plano_id, c.quantidade, c.cupom_codigo, p.preco 
         FROM carrinho_usuarios c
         JOIN planos p ON c.plano_id = p.id AND c.periodo = p.periodo
         WHERE c.usuario_id = ?`,
        [usuarioId]
      );

      if (cartItems.length > 0 && cartItems[0].cupom_codigo) {
        return res.status(400).json({ 
          error: "Já existe um cupom aplicado. Remova-o primeiro para aplicar outro cupom." 
        });
      }

      if (cartItems.length === 0) {
        return res.status(404).json({ error: "Carrinho vazio" });
      }

      const valorTotal = cartItems.reduce((total, item) => {
        return total + (parseFloat(item.preco) * item.quantidade);
      }, 0);

      const [cupons] = await pool.execute(
        'SELECT * FROM cupons WHERE codigo = ?',
        [codigo.toUpperCase()]
      );

      if (cupons.length === 0) {
        await log('cupom_invalido', req, 'Tentou aplicar cupom inexistente', { 
          codigo_tentado: codigo,
          tentativa_ip: req.ip,
          usuario_id: usuarioId,
          timestamp: new Date().toISOString()
        });
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      const cupom = cupons[0];
      const agora = new Date();
      const dataInicio = new Date(cupom.data_inicio);
      const dataFim = new Date(cupom.data_fim);

      if (!cupom.ativo) {
        await log('cupom_invalido', req, 'Tentou aplicar cupom inativo', { 
          cupom_id: cupom.id,
          codigo: cupom.codigo,
          tipo: cupom.tipo,
          valor: cupom.valor,
          data_inicio: cupom.data_inicio,
          data_fim: cupom.data_fim,
          tentativa_ip: req.ip,
          timestamp: new Date().toISOString()
        });
        return res.status(400).json({ error: 'Cupom inativo' });
      }

      if (agora < dataInicio) {
        await log('cupom_invalido', req, 'Tentou aplicar cupom antes do início', { 
          cupom_id: cupom.id,
          codigo: cupom.codigo,
          data_inicio: cupom.data_inicio,
          data_atual: agora.toISOString(),
          dias_faltando: Math.ceil((dataInicio - agora) / (1000 * 60 * 60 * 24)),
          timestamp: new Date().toISOString()
        });
        return res.status(400).json({ error: 'Cupom ainda não está disponível' });
      }

      if (agora > dataFim) {
        await log('cupom_invalido', req, 'Tentou aplicar cupom expirado', { 
          cupom_id: cupom.id,
          codigo: cupom.codigo,
          data_fim: cupom.data_fim,
          data_atual: agora.toISOString(),
          dias_expirado: Math.ceil((agora - dataFim) / (1000 * 60 * 60 * 24)),
          timestamp: new Date().toISOString()
        });
        return res.status(400).json({ error: 'Cupom expirado' });
      }

      if (cupom.quantidade_maxima !== null && cupom.quantidade_usada >= cupom.quantidade_maxima) {
        await log('cupom_invalido', req, 'Tentou aplicar cupom esgotado', { 
          cupom_id: cupom.id,
          codigo: cupom.codigo,
          quantidade_maxima: cupom.quantidade_maxima,
          quantidade_usada: cupom.quantidade_usada,
          timestamp: new Date().toISOString()
        });
        return res.status(400).json({ error: 'Cupom esgotado' });
      }

      // SEGURANÇA CRÍTICA: Calcular desconto no backend baseado no preço do banco
      let desconto = 0;
      if (cupom.tipo === 'percentual') {
        desconto = (valorTotal * parseFloat(cupom.valor)) / 100;
      } else {
        // Desconto fixo não pode ser maior que o valor total
        desconto = Math.min(parseFloat(cupom.valor), valorTotal);
      }

      // Garantir que desconto não seja maior que o valor total
      desconto = Math.min(desconto, valorTotal);
      
      // Garantir que desconto seja válido
      if (isNaN(desconto) || desconto < 0) {
        return res.status(500).json({ error: 'Erro ao calcular desconto' });
      }

      for (const item of cartItems) {
        await pool.execute(
          'UPDATE carrinho_usuarios SET cupom_codigo = ?, cupom_desconto = ? WHERE id = ?',
          [cupom.codigo, desconto, item.id]
        );
      }

      const valorFinalCompra = valorTotal - desconto;

      await log('cupom_aplicado', req, 'Aplicou cupom ao carrinho', { 
        cupom_id: cupom.id,
        cupom_codigo: cupom.codigo,
        cupom_tipo: cupom.tipo,
        cupom_valor: cupom.valor,
        cupom_data_inicio: cupom.data_inicio,
        cupom_data_fim: cupom.data_fim,
        desconto_aplicado: parseFloat(desconto.toFixed(2)),
        valor_total: parseFloat(valorTotal.toFixed(2)),
        valor_desconto: parseFloat(desconto.toFixed(2)),
        valor_final_compra: parseFloat(valorFinalCompra.toFixed(2)),
        quantidade_itens: cartItems.length,
        quantidade_usada_antes: cupom.quantidade_usada,
        quantidade_maxima: cupom.quantidade_maxima || 'Ilimitado',
        itens_carrinho: cartItems.map(item => ({
          plano_id: item.plano_id,
          quantidade: item.quantidade,
          preco: parseFloat(item.preco)
        })),
        aplicado_em: new Date().toISOString()
      });

      res.json({
        message: 'Cupom aplicado com sucesso',
        cupom: {
          codigo: cupom.codigo,
          tipo: cupom.tipo,
          valor: cupom.valor,
          desconto: parseFloat(desconto.toFixed(2)),
          valor_original: parseFloat(valorTotal.toFixed(2)),
          valor_desconto: parseFloat(desconto.toFixed(2)),
          valor_final_compra: parseFloat(valorFinalCompra.toFixed(2)),
          valor_final: parseFloat(valorFinalCompra.toFixed(2))
        }
      });
    } catch (error) {
      console.error("Erro ao aplicar cupom:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async removerCupom(req, res) {
    try {
      const usuarioId = req.user.id;

      // Buscar detalhes do cupom antes de remover
      const [carrinhoAtual] = await pool.execute(
        'SELECT cupom_codigo, cupom_desconto FROM carrinho_usuarios WHERE usuario_id = ? AND cupom_codigo IS NOT NULL LIMIT 1',
        [usuarioId]
      );

      await pool.execute(
        'UPDATE carrinho_usuarios SET cupom_codigo = NULL, cupom_desconto = 0 WHERE usuario_id = ?',
        [usuarioId]
      );

      await log('cupom_removido', req, 'Removeu cupom do carrinho', {
        cupom_codigo: carrinhoAtual[0]?.cupom_codigo,
        desconto_perdido: carrinhoAtual[0] ? parseFloat(carrinhoAtual[0].cupom_desconto) : 0,
        removido_em: new Date().toISOString()
      });

      res.json({ message: 'Cupom removido com sucesso' });
    } catch (error) {
      console.error("Erro ao remover cupom:", error);
      res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new CarrinhoController();
