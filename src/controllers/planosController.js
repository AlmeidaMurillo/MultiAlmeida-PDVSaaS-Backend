import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { parsePlanos, formatPreco } from "../utils/dataParser.js";

class PlanosController {
  async create(req, res) {
    try {
      let { nome, periodo, preco, duracaoDias, beneficios } = req.body;
      preco = formatPreco(preco); 

      if (
        !nome ||
        !periodo ||
        !preco ||
        !duracaoDias ||
        !beneficios ||
        beneficios.length === 0
      ) {
        console.error("Validação falhou para POST /api/admin/planos:", req.body);
        return res.status(400).json({
          error: "Nome, período, preço, duração e benefícios são obrigatórios",
        });
      }

      const id = uuidv4();
      await pool.execute(
        `INSERT INTO planos (id, nome, periodo, preco, duracao_dias, beneficios) 
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE 
                 preco = VALUES(preco),
                 duracao_dias = VALUES(duracao_dias), 
                 beneficios = VALUES(beneficios)`,
        [id, nome, periodo, preco, duracaoDias, JSON.stringify(beneficios)]
      );

      return res.status(201).json({
        message: "Plano criado/atualizado com sucesso",
        id,
      });
    } catch (error) {
      console.error("Erro criando plano:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async list(req, res) {
    try {
      const { grouped } = req.query;

      const [rows] = await pool.execute(
        'SELECT id, nome, periodo, preco, duracao_dias, beneficios, quantidade_empresas FROM planos ORDER BY nome ASC, FIELD(periodo, "mensal", "trimestral", "semestral", "anual")'
      );

      const parsedPlans = parsePlanos(rows);

      if (grouped === 'true') {
        const planosAgrupados = {};
        parsedPlans.forEach((plano) => {
          if (!planosAgrupados[plano.nome]) {
            planosAgrupados[plano.nome] = {
              id: plano.nome,
              nome: plano.nome,
              empresas: plano.quantidade_empresas,
            };
          }
          planosAgrupados[plano.nome][plano.periodo] = {
            id: plano.id,
            preco: plano.preco,
            duracaoDias: plano.duracao_dias,
            beneficios: plano.beneficios,
          };
        });
        return res.json({ planos: Object.values(planosAgrupados) });
      } else {
        return res.json({ planos: parsedPlans });
      }
    } catch (error) {
      console.error("Erro listando planos:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async get(req, res) {
    try {
      const { id } = req.params;
      const [rows] = await pool.execute("SELECT * FROM planos WHERE id = ?", [
        id,
      ]);

      if (rows.length === 0) {
        return res.status(404).json({ error: "Plano não encontrado" });
      }

      const plano = rows[0];
      if (typeof plano.beneficios === "string") {
        plano.beneficios = JSON.parse(plano.beneficios);
      }
      plano.preco = parseFloat(plano.preco);

      return res.json({ plano });
    } catch (error) {
      console.error("Erro buscando plano:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;
      let { nome, periodo, preco, duracaoDias, beneficios } = req.body;
      preco = formatPreco(preco);

      await pool.execute(
        `UPDATE planos 
                 SET nome = ?, periodo = ?, preco = ?, duracao_dias = ?, beneficios = ?
                 WHERE id = ?`,
        [nome, periodo, preco, duracaoDias, JSON.stringify(beneficios), id]
      );

      return res.status(200).json({ message: "Plano atualizado com sucesso" });
    } catch (error) {
      console.error("Erro atualizando plano:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;
      await pool.execute("DELETE FROM planos WHERE id = ?", [id]);
      return res.status(200).json({ message: "Plano excluído com sucesso" });
    } catch (error) {
      console.error("Erro excluindo plano:", error);
      return res.status(500).json({ error: "Erro interno do servidor" });
    }
  }
}

export default new PlanosController();
