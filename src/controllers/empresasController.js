import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";

class EmpresasController {
  
  async list(req, res) {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          e.*,
          CASE 
            WHEN e.data_vencimento IS NULL THEN 'Sem vencimento'
            WHEN e.data_vencimento < CURDATE() THEN 'Vencido'
            WHEN DATEDIFF(e.data_vencimento, CURDATE()) <= 7 THEN 'Vence em breve'
            ELSE 'Ativo'
          END as status_vencimento,
          DATEDIFF(e.data_vencimento, CURDATE()) as dias_restantes
        FROM empresas e 
        ORDER BY e.criado_em DESC
      `);

      return res.json({ empresas: rows });
    } catch (err) {
      console.error("Erro listando empresas:", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  }

  
  async get(req, res) {
    try {
      const { id } = req.params;
      const [rows] = await pool.execute("SELECT * FROM empresas WHERE id = ?", [
        id,
      ]);

      const empresa = rows[0];
      if (!empresa) {
        return res.status(404).json({ error: "Empresa não encontrada" });
      }

      return res.json({ empresa });
    } catch (err) {
      console.error("Erro obtendo empresa:", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  }

  
  async create(req, res) {
    try {
      const { nome, email, cnpj, telefone, periodo, plano, status } = req.body;

      if (!nome) {
        return res.status(400).json({ error: "Nome é obrigatório" });
      }

      const id = uuidv4();
      await pool.execute(
        `INSERT INTO empresas 
          (id, nome, email, cnpj, telefone, periodo, plano, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          nome,
          email || null,
          cnpj || null,
          telefone || null,
          periodo || null,
          plano || null,
          status || "Pendente",
        ]
      );

      return res.status(201).json({ id });
    } catch (err) {
      console.error("Erro criando empresa:", err);
      return res.status(500).json({ error: "Erro interno" });
    }
  }
}

export default new EmpresasController();
