import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';

class CuponsController {
  async listar(req, res) {
    try {
      const [cupons] = await pool.execute(
        'SELECT * FROM cupons ORDER BY created_at DESC'
      );

      return res.json(cupons);
    } catch (error) {
      console.error('Erro ao listar cupons:', error);
      return res.status(500).json({ error: 'Erro ao listar cupons' });
    }
  }

  async criar(req, res) {
    try {
      const {
        codigo,
        tipo,
        valor,
        quantidade_maxima,
        data_inicio,
        data_fim,
        ativo = true
      } = req.body;

      if (!codigo || !tipo || !valor || !data_inicio || !data_fim) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }

      if (tipo !== 'percentual' && tipo !== 'fixo') {
        return res.status(400).json({ error: 'Tipo inválido. Use "percentual" ou "fixo"' });
      }

      if (parseFloat(valor) <= 0) {
        return res.status(400).json({ error: 'Valor deve ser maior que zero' });
      }

      if (tipo === 'percentual' && parseFloat(valor) > 100) {
        return res.status(400).json({ error: 'Percentual não pode ser maior que 100%' });
      }

      const [existente] = await pool.execute(
        'SELECT id FROM cupons WHERE codigo = ?',
        [codigo.toUpperCase()]
      );

      if (existente.length > 0) {
        return res.status(400).json({ error: 'Código de cupom já existe' });
      }

      const id = uuidv4();
      await pool.execute(
        `INSERT INTO cupons (id, codigo, tipo, valor, quantidade_maxima, data_inicio, data_fim, ativo) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          codigo.toUpperCase(),
          tipo,
          parseFloat(valor),
          quantidade_maxima || null,
          data_inicio,
          data_fim,
          ativo
        ]
      );

      const [novoCupom] = await pool.execute(
        'SELECT * FROM cupons WHERE id = ?',
        [id]
      );

      return res.status(201).json(novoCupom[0]);
    } catch (error) {
      console.error('Erro ao criar cupom:', error);
      return res.status(500).json({ error: 'Erro ao criar cupom' });
    }
  }

  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const {
        codigo,
        tipo,
        valor,
        quantidade_maxima,
        data_inicio,
        data_fim,
        ativo
      } = req.body;

      const [cupom] = await pool.execute(
        'SELECT * FROM cupons WHERE id = ?',
        [id]
      );

      if (cupom.length === 0) {
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      if (tipo && tipo !== 'percentual' && tipo !== 'fixo') {
        return res.status(400).json({ error: 'Tipo inválido. Use "percentual" ou "fixo"' });
      }

      if (valor !== undefined && parseFloat(valor) <= 0) {
        return res.status(400).json({ error: 'Valor deve ser maior que zero' });
      }

      if (tipo === 'percentual' && valor !== undefined && parseFloat(valor) > 100) {
        return res.status(400).json({ error: 'Percentual não pode ser maior que 100%' });
      }

      if (codigo && codigo.toUpperCase() !== cupom[0].codigo) {
        const [existente] = await pool.execute(
          'SELECT id FROM cupons WHERE codigo = ? AND id != ?',
          [codigo.toUpperCase(), id]
        );

        if (existente.length > 0) {
          return res.status(400).json({ error: 'Código de cupom já existe' });
        }
      }

      const campos = [];
      const valores = [];

      if (codigo !== undefined) {
        campos.push('codigo = ?');
        valores.push(codigo.toUpperCase());
      }
      if (tipo !== undefined) {
        campos.push('tipo = ?');
        valores.push(tipo);
      }
      if (valor !== undefined) {
        campos.push('valor = ?');
        valores.push(parseFloat(valor));
      }
      if (quantidade_maxima !== undefined) {
        campos.push('quantidade_maxima = ?');
        valores.push(quantidade_maxima || null);
      }
      if (data_inicio !== undefined) {
        campos.push('data_inicio = ?');
        valores.push(data_inicio);
      }
      if (data_fim !== undefined) {
        campos.push('data_fim = ?');
        valores.push(data_fim);
      }
      if (ativo !== undefined) {
        campos.push('ativo = ?');
        valores.push(ativo);
      }

      if (campos.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      valores.push(id);

      await pool.execute(
        `UPDATE cupons SET ${campos.join(', ')} WHERE id = ?`,
        valores
      );

      const [cupomAtualizado] = await pool.execute(
        'SELECT * FROM cupons WHERE id = ?',
        [id]
      );

      return res.json(cupomAtualizado[0]);
    } catch (error) {
      console.error('Erro ao atualizar cupom:', error);
      return res.status(500).json({ error: 'Erro ao atualizar cupom' });
    }
  }

  async deletar(req, res) {
    try {
      const { id } = req.params;

      const [cupom] = await pool.execute(
        'SELECT * FROM cupons WHERE id = ?',
        [id]
      );

      if (cupom.length === 0) {
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      await pool.execute('DELETE FROM cupons WHERE id = ?', [id]);

      return res.json({ message: 'Cupom deletado com sucesso' });
    } catch (error) {
      console.error('Erro ao deletar cupom:', error);
      return res.status(500).json({ error: 'Erro ao deletar cupom' });
    }
  }

  async validar(req, res) {
    try {
      const { codigo, valor_pedido } = req.body;

      if (!codigo || !valor_pedido) {
        return res.status(400).json({ error: 'Código do cupom e valor do pedido são obrigatórios' });
      }

      const [cupons] = await pool.execute(
        'SELECT * FROM cupons WHERE codigo = ?',
        [codigo.toUpperCase()]
      );

      if (cupons.length === 0) {
        return res.status(404).json({ error: 'Cupom não encontrado' });
      }

      const cupom = cupons[0];

      // Verificar se está ativo
      if (!cupom.ativo) {
        return res.status(400).json({ error: 'Cupom inativo' });
      }

      // Verificar datas
      const agora = new Date();
      const dataInicio = new Date(cupom.data_inicio);
      const dataFim = new Date(cupom.data_fim);

      if (agora < dataInicio) {
        return res.status(400).json({ error: 'Cupom ainda não está disponível' });
      }

      if (agora > dataFim) {
        return res.status(400).json({ error: 'Cupom expirado' });
      }

      if (cupom.quantidade_maxima !== null && cupom.quantidade_usada >= cupom.quantidade_maxima) {
        return res.status(400).json({ error: 'Cupom esgotado' });
      }

      let desconto = 0;
      if (cupom.tipo === 'percentual') {
        desconto = (parseFloat(valor_pedido) * parseFloat(cupom.valor)) / 100;
      } else {
        desconto = parseFloat(cupom.valor);
      }

      desconto = Math.min(desconto, parseFloat(valor_pedido));

      const valorFinal = parseFloat(valor_pedido) - desconto;

      return res.json({
        valido: true,
        cupom: {
          id: cupom.id,
          codigo: cupom.codigo,
          tipo: cupom.tipo,
          valor: cupom.valor
        },
        desconto: parseFloat(desconto.toFixed(2)),
        valor_original: parseFloat(valor_pedido),
        valor_final: parseFloat(valorFinal.toFixed(2))
      });
    } catch (error) {
      console.error('Erro ao validar cupom:', error);
      return res.status(500).json({ error: 'Erro ao validar cupom' });
    }
  }

  async incrementarUso(cupomId) {
    try {
      await pool.execute(
        'UPDATE cupons SET quantidade_usada = quantidade_usada + 1 WHERE id = ?',
        [cupomId]
      );
      return true;
    } catch (error) {
      console.error('Erro ao incrementar uso do cupom:', error);
      return false;
    }
  }
}

export default new CuponsController();
