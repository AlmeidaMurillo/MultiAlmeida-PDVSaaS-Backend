import pool from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { log } from '../utils/logger.js';

class CuponsController {
  async listar(req, res) {
    try {
      const [cupons] = await pool.execute(
        'SELECT * FROM cupons ORDER BY created_at DESC'
      );

      const cuponsAtivos = cupons.filter(c => c.ativo === 1).length;
      const cuponsInativos = cupons.filter(c => c.ativo === 0).length;
      const cuponsPercentuais = cupons.filter(c => c.tipo === 'percentual').length;
      const cuponsFixos = cupons.filter(c => c.tipo === 'fixo').length;

      return res.json(cupons);
    } catch (error) {
      console.error('Erro ao listar cupons:', error);
      await log('erro', req, 'Erro ao listar cupons', { erro: error.message });
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

      await log('admin_cupom', req, 'Criou cupom', { 
        cupom_id: id,
        codigo: codigo.toUpperCase(), 
        tipo, 
        valor: parseFloat(valor),
        quantidade_maxima: quantidade_maxima || 'Ilimitado',
        quantidade_usada: 0,
        data_inicio,
        data_fim,
        ativo,
        criado_em: new Date().toISOString()
      });

      return res.status(201).json(novoCupom[0]);
    } catch (error) {
      console.error('Erro ao criar cupom:', error);
      await log('erro', req, 'Erro ao criar cupom', { erro: error.message });
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

      // Preparar dados antigos e novos para comparação
      const cupomAntigo = cupom[0];
      const cupomNovo = cupomAtualizado[0];

      // Identificar campos que realmente mudaram
      const camposAlterados = [];
      const alteracoes = {};

      if (codigo !== undefined && cupomAntigo.codigo !== cupomNovo.codigo) {
        camposAlterados.push('codigo');
        alteracoes.codigo = { de: cupomAntigo.codigo, para: cupomNovo.codigo };
      }
      if (tipo !== undefined && cupomAntigo.tipo !== cupomNovo.tipo) {
        camposAlterados.push('tipo');
        alteracoes.tipo = { de: cupomAntigo.tipo, para: cupomNovo.tipo };
      }
      if (valor !== undefined && parseFloat(cupomAntigo.valor) !== parseFloat(cupomNovo.valor)) {
        camposAlterados.push('valor');
        alteracoes.valor = { de: parseFloat(cupomAntigo.valor), para: parseFloat(cupomNovo.valor) };
      }
      if (quantidade_maxima !== undefined && cupomAntigo.quantidade_maxima !== cupomNovo.quantidade_maxima) {
        camposAlterados.push('quantidade_maxima');
        alteracoes.quantidade_maxima = { 
          de: cupomAntigo.quantidade_maxima || 'Ilimitado', 
          para: cupomNovo.quantidade_maxima || 'Ilimitado' 
        };
      }
      if (data_inicio !== undefined && cupomAntigo.data_inicio?.toISOString() !== new Date(cupomNovo.data_inicio).toISOString()) {
        camposAlterados.push('data_inicio');
        alteracoes.data_inicio = { de: cupomAntigo.data_inicio, para: cupomNovo.data_inicio };
      }
      if (data_fim !== undefined && cupomAntigo.data_fim?.toISOString() !== new Date(cupomNovo.data_fim).toISOString()) {
        camposAlterados.push('data_fim');
        alteracoes.data_fim = { de: cupomAntigo.data_fim, para: cupomNovo.data_fim };
      }
      if (ativo !== undefined && cupomAntigo.ativo !== cupomNovo.ativo) {
        camposAlterados.push('ativo');
        alteracoes.ativo = { de: cupomAntigo.ativo ? 'Ativo' : 'Inativo', para: cupomNovo.ativo ? 'Ativo' : 'Inativo' };
      }

      await log('admin_cupom', req, 'Atualizou cupom', { 
        cupom_id: id,
        codigo_cupom: cupomNovo.codigo,
        dados_antigos: {
          codigo: cupomAntigo.codigo,
          tipo: cupomAntigo.tipo,
          valor: parseFloat(cupomAntigo.valor),
          quantidade_maxima: cupomAntigo.quantidade_maxima || 'Ilimitado',
          data_inicio: cupomAntigo.data_inicio,
          data_fim: cupomAntigo.data_fim,
          ativo: cupomAntigo.ativo
        },
        dados_novos: {
          codigo: cupomNovo.codigo,
          tipo: cupomNovo.tipo,
          valor: parseFloat(cupomNovo.valor),
          quantidade_maxima: cupomNovo.quantidade_maxima || 'Ilimitado',
          data_inicio: cupomNovo.data_inicio,
          data_fim: cupomNovo.data_fim,
          ativo: cupomNovo.ativo
        },
        campos_alterados: camposAlterados,
        alteracoes: alteracoes,
        total_campos_alterados: camposAlterados.length,
        atualizado_em: new Date().toISOString()
      });

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

      await log('admin_cupom', req, 'Deletou cupom', { 
        cupom_id: id,
        dados_deletados: {
          codigo: cupom[0].codigo,
          tipo: cupom[0].tipo,
          valor: parseFloat(cupom[0].valor),
          quantidade_maxima: cupom[0].quantidade_maxima || 'Ilimitado',
          quantidade_usada: cupom[0].quantidade_usada,
          data_inicio: cupom[0].data_inicio,
          data_fim: cupom[0].data_fim,
          ativo: cupom[0].ativo ? 'Ativo' : 'Inativo'
        },
        deletado_em: new Date().toISOString()
      });

      return res.json({ message: 'Cupom deletado com sucesso' });
    } catch (error) {
      console.error('Erro ao deletar cupom:', error);
      await log('erro', req, 'Erro ao deletar cupom', { erro: error.message });
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
