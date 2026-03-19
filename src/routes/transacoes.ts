import { FastifyInstance } from "fastify";
import pool from "../db";
import { validarJWT } from "./middleware";

interface CriarTransacaoBody {
    conta_id: number;
    descricao: string;
    valor: number;
    tipo: 'receita' | 'despesa';
    categoria: string;
    data_transacao?: string; // Formato YYYY-MM-DD
}

export async function transacoesRoutes(app: FastifyInstance) {

    app.post('/', { preHandler: [validarJWT] }, async (request, reply) => {
        const { conta_id, descricao, valor, tipo, categoria, data_transacao } = request.body as CriarTransacaoBody;
        const usuario_id = request.user.id;

        try {
            // 1. Validação de Permissão: O usuário pode postar nessa conta?
            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE conta_id = $1 AND usuario_id = $2',
                [conta_id, usuario_id]
            );

            if (permissao.rowCount === 0) {
                return reply.code(403).send({ error: "Você não tem acesso a esta conta." });
            }

            const papel = permissao.rows[0].papel;
            if (papel === 'leitura') {
                return reply.code(403).send({ error: "Seu nível de acesso é apenas de leitura." });
            }

            const query = `
            INSERT INTO transacoes (conta_id, usuario_id, descricao, valor, tipo, categoria, data_transacao, criado_por)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;

            const values = [
                conta_id,
                usuario_id,
                descricao,
                valor,
                tipo,
                categoria,
                data_transacao || new Date().toISOString().split('T')[0],
                usuario_id
            ];

            const result = await pool.query(query, values);

            return reply.code(201).send(result.rows[0]);

        } catch (error) {
            app.log.error(error);
            return reply.code(500).send({ error: "Erro ao lançar transação." });
        }
    });

}