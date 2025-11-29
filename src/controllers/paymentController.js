import { MercadoPagoConfig, Payment } from "mercadopago";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";

dotenv.config();

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

class PaymentController {
  
  async generateQrCode(req, res) {
    const { amount, description } = req.body;

    if (!amount) {
      return res.status(400).json({
        message: "Dados obrigatórios: amount",
      });
    }

    try {
      const payment = new Payment(client);
      const paymentData = {
        body: {
          transaction_amount: Number(amount),
          description: description || `Pagamento`,
          payment_method_id: "pix",
          payer: {
            email: "test@test.com",
          },
        },
      };

      const paymentResponse = await payment.create(paymentData);

      const qrCodeBase64 =
        paymentResponse.point_of_interaction?.transaction_data
          ?.qr_code_base64 || "";

      return res.status(200).json({
        qrCodeImage: `data:image/png;base64,${qrCodeBase64}`,
      });
    } catch (error) {
      console.error("Erro ao gerar QR Code PIX:", error);
      return res.status(500).json({
        message: "Erro ao gerar QR Code",
        error: error.message,
        details: error.response?.data || error,
      });
    }
  }

  
  async handleWebhook(req, res) {
    let paymentId;
    let notificationType;

    if (req.body && req.body.action && req.body.action.startsWith("payment.")) {
      paymentId = req.body.data?.id;
      notificationType = req.body.type;
    } else if (req.query && req.query["data.id"]) {
      notificationType = req.query.type;
      if (notificationType === "payment") {
        paymentId = req.query["data.id"];
      }
    }

    if (notificationType !== "payment" || !paymentId) {
      return res.status(200).send("Evento ignorado.");
    }

    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: paymentId });

      if (!payment || !payment.external_reference) {
        await connection.rollback();
        return res
          .status(404)
          .send("Pagamento não encontrado ou sem referência externa.");
      }

      const nossoPagamentoId = payment.external_reference;
      const novoStatusPagamento =
        payment.status === "approved"
          ? "aprovado"
          : payment.status === "rejected"
          ? "reprovado"
          : payment.status === "cancelled"
          ? "cancelado"
          : "pendente";

      const [updateResult] = await connection.execute(
        "UPDATE pagamentos_assinatura SET status_pagamento = ?, data_pagamento = NOW(), transaction_id = ? WHERE id = ?",
        [novoStatusPagamento, payment.id, nossoPagamentoId]
      );

      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return res.status(404).send("Registro interno não encontrado.");
      }

      const [pagamentoRows] = await connection.execute(
        "SELECT a.id as assinatura_id, a.plano_id FROM assinaturas a JOIN pagamentos_assinatura pa ON a.id = pa.assinatura_id WHERE pa.id = ?",
        [nossoPagamentoId]
      );

      if (!pagamentoRows.length) {
        await connection.rollback();
        return res
          .status(404)
          .send("Assinatura correspondente não encontrada.");
      }

      const { assinatura_id, plano_id } = pagamentoRows[0];

      if (novoStatusPagamento === "aprovado") {
        const [planoRows] = await connection.execute(
          "SELECT duracao_dias FROM planos WHERE id = ?",
          [plano_id]
        );

        if (!planoRows.length) {
          await connection.rollback();
          return res.status(404).send("Plano não encontrado.");
        }

        const { duracao_dias } = planoRows[0];

        await connection.execute(
          `UPDATE assinaturas 
           SET status = 'ativa', data_assinatura = NOW(), data_vencimento = DATE_ADD(NOW(), INTERVAL ? DAY) 
           WHERE id = ?`,
          [duracao_dias, assinatura_id]
        );

        
        const [assinaturaRows] = await connection.execute(
          "SELECT usuario_id FROM assinaturas WHERE id = ?",
          [assinatura_id]
        );
        
        if (assinaturaRows.length > 0) {
          const usuarioId = assinaturaRows[0].usuario_id;
          await connection.execute("DELETE FROM carrinho_usuarios WHERE usuario_id = ?", [usuarioId]);
        }

      } else if (
        novoStatusPagamento === "reprovado" ||
        novoStatusPagamento === "cancelado"
      ) {
        await connection.execute(
          `UPDATE assinaturas SET status = 'cancelada' WHERE id = ? AND status = 'pendente'`,
          [assinatura_id]
        );
      }

      await connection.commit();
      return res.status(200).send("Webhook processado com sucesso.");
    } catch (error) {
      await connection.rollback();
      console.error("Erro no webhook:", error);
      return res
        .status(500)
        .json({ message: "Erro ao processar webhook", error: error.message });
    } finally {
      connection.release();
    }
  }

  
  async getPaymentStatus(req, res) {
    try {
      const { id } = req.params;
      const [pagamento] = await pool.execute(
        "SELECT status_pagamento as status FROM pagamentos_assinatura WHERE id = ?",
        [id]
      );

      if (Array.isArray(pagamento) && pagamento.length > 0) {
        return res.status(200).json({ status: pagamento[0].status });
      } else {
        return res.status(404).json({ message: "Pagamento não encontrado" });
      }
    } catch (error) {
      return res
        .status(500)
        .json({ message: "Erro ao buscar status do pagamento", error });
    }
  }

  
  async getPaymentDetails(req, res) {
    try {
      const { id } = req.params;
      const [pagamento] = await pool.execute(
        `SELECT 
            pa.id as paymentId, 
            pa.status_pagamento as status, 
            pa.qr_code as qrCode, 
            pa.qr_code_text as qrCodeText, 
            pa.data_expiracao as expirationTime,
            a.usuario_id as usuarioId,
            a.plano_id as planId,
            p.nome as nomePlano,
            p.periodo as periodoPlano,
            p.preco as precoPlano,
            p.duracao_dias as duracaoDiasPlano
         FROM pagamentos_assinatura pa
         JOIN assinaturas a ON pa.assinatura_id = a.id
         JOIN planos p ON a.plano_id = p.id
         WHERE pa.id = ?`,
        [id]
      );

      if (!pagamento.length) {
        return res.status(404).json({ message: "Pagamento não encontrado" });
      }

      const data = pagamento[0];

      if (
        data.expirationTime &&
        new Date() > new Date(data.expirationTime) &&
        data.status === "pendente"
      ) {
        await pool.execute(
          "UPDATE pagamentos_assinatura SET status_pagamento = ? WHERE id = ?",
          ["expirado", id]
        );
        data.status = "expirado";
      }

      return res.status(200).json(data);
    } catch (error) {
      console.error("Erro ao buscar detalhes:", error);
      return res
        .status(500)
        .json({ message: "Erro ao buscar detalhes", error });
    }
  }

  
  async expirePayment(req, res) {
    const { id } = req.params;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const [rows] = await connection.execute(
        "SELECT assinatura_id FROM pagamentos_assinatura WHERE id = ? AND status_pagamento = 'pendente'",
        [id]
      );

      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({
          message: "Pagamento pendente não encontrado ou já processado.",
        });
      }

      const { assinatura_id } = rows[0];

      await connection.execute(
        "UPDATE pagamentos_assinatura SET status_pagamento = 'expirado' WHERE id = ?",
        [id]
      );

      await connection.execute(
        "UPDATE assinaturas SET status = 'inativa' WHERE id = ? AND status = 'ativa'",
        [assinatura_id]
      );

      await connection.commit();
      return res.status(200).json({
        message: "Pagamento expirado com sucesso",
      });
    } catch (error) {
      await connection.rollback();
      console.error("Erro ao expirar:", error);
      return res
        .status(500)
        .json({ message: "Erro ao expirar pagamento", error });
    } finally {
      connection.release();
    }
  }

  
  async initiatePayment(req, res) {
    const usuarioId = req.user.id;
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      
      const [cartItems] = await connection.execute(
        "SELECT plano_id, periodo FROM carrinho_usuarios WHERE usuario_id = ?",
        [usuarioId]
      );

      if (cartItems.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Carrinho vazio" });
      }

      const { plano_id: planId, periodo } = cartItems[0];

      const [planRows] = await connection.execute(
        "SELECT * FROM planos WHERE id = ?",
        [planId]
      );

      if (planRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Plano não encontrado" });
      }

      const plano = planRows[0];

      
      const preco = Number(plano.preco.toString().replace(",", "."));

      const assinaturaId = uuidv4();
      await connection.execute(
        "INSERT INTO assinaturas (id, usuario_id, plano_id, status) VALUES (?, ?, ?, 'pendente')",
        [assinaturaId, usuarioId, planId]
      );

      const paymentId = uuidv4();
      const expirationTime = new Date(Date.now() + 1 * 60 * 1000);

      const paymentClient = new Payment(client);

      const paymentData = {
        body: {
          transaction_amount: preco,
          description: `Assinatura ${plano.nome} - ${periodo}`,
          payment_method_id: "pix",
          payer: {
            email: req.user.email,
          },
          external_reference: paymentId,
          notification_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
        },
      };

      const response = await paymentClient.create(paymentData);

      const qrCodeBase64 =
        response.point_of_interaction?.transaction_data?.qr_code_base64 || "";
      const qrCodeText =
        response.point_of_interaction?.transaction_data?.qr_code || "";

      await connection.execute(
        `INSERT INTO pagamentos_assinatura (
          id, assinatura_id, valor, metodo_pagamento, status_pagamento,
          data_expiracao, qr_code, qr_code_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentId,
          assinaturaId,
          preco,
          "pix",
          "pendente",
          expirationTime,
          qrCodeBase64,
          qrCodeText,
        ]
      );

      await connection.commit();

      return res.status(200).json({
        paymentId,
        qrCode: `data:image/png;base64,${qrCodeBase64}`,
        pixCode: qrCodeText,
        expirationTime,
        plan: {
          nome: plano.nome,
          periodo: plano.periodo,
          preco,
          duracaoDias: plano.duracao_dias,
          beneficios: plano.beneficios,
        },
        user: {
          nome: req.user.nome,
          email: req.user.email,
        },
      });
    } catch (error) {
      await connection.rollback();
      console.error("Erro ao iniciar pagamento:", error);
      return res.status(500).json({
        message: "Erro ao iniciar pagamento",
        error: error.message,
      });
    } finally {
      connection.release();
    }
  }
}

export default new PaymentController();
