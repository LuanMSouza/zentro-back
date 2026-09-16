import { FastifyInstance } from "fastify";
import pool from "../db";
import { validarJWT } from "./middleware";

export async function configuracoesRoutes(app: FastifyInstance) {

    app.put('/perfil', { preHandler: [validarJWT] }, async (request: any, reply) => {
        const { nome } = request.body;
        const userId = request.user.id;

        if (!nome) {
            return reply.status(400).send({ error: "Nome é obrigatório" });
        }
        const novasIniciais = nome.trim().substring(0, 2).toUpperCase();

        try {
            await pool.query(
                'UPDATE usuarios SET nome = $1, iniciais = $2 WHERE id = $3',
                [nome, novasIniciais, userId]
            );

            return reply.send({
                message: "Perfil atualizado com sucesso!"
            });
        } catch (error) {
            console.error("Erro ao atualizar perfil:", error);
            return reply.status(500).send({ error: "Erro ao atualizar perfil no banco de dados" });
        }
    });

app.delete('/espaco/:contaId/membros/:membroId', { preHandler: [validarJWT] }, async (request: any, reply) => {
    const { contaId, membroId } = request.params;
    const adminId = request.user.id;

    try {
        // 1. Verifica permissão do admin
        const permissao = await pool.query(
            'SELECT papel FROM conta_usuarios WHERE usuario_id = $1 AND conta_id = $2',
            [adminId, contaId]
        );

        const papelUsuario = permissao.rows[0]?.papel?.toString().trim().toLowerCase();

        if (papelUsuario !== 'adm') {
            return reply.status(403).send({
                error: "Apenas admins podem remover membros."
            });
        }

        // 2. Remove o vínculo na conta_usuarios
        await pool.query(
            'DELETE FROM conta_usuarios WHERE usuario_id = $1 AND conta_id = $2',
            [membroId, contaId]
        );

        // 3. Limpa a solicitação para permitir que ele seja convidado novamente
        //    (solicitacoes tem UNIQUE (usuario_id, conta_id))
        await pool.query(
            'DELETE FROM solicitacoes WHERE usuario_id = $1 AND conta_id = $2',
            [membroId, contaId]
        );

        return reply.send({ message: "Membro removido e histórico de convites limpo." });
    } catch (error) {
        console.error(error);
        return reply.status(500).send({ error: "Erro ao remover membro" });
    }
});

    app.delete('/espaco/:contaId', { preHandler: [validarJWT] }, async (request: any, reply) => {
        const { contaId } = request.params;
        const adminId = request.user.id;

        try {
            const permissao = await pool.query(
                'SELECT papel FROM conta_usuarios WHERE usuario_id = $1 AND conta_id = $2',
                [adminId, contaId]
            );

            if (permissao.rows[0]?.papel !== 'adm') {
                return reply.status(403).send({ error: "Apenas o administrador pode excluir o espaço." });
            }

            // transacoes, conta_usuarios e solicitacoes têm ON DELETE CASCADE em conta_id
            await pool.query('DELETE FROM contas WHERE id = $1', [contaId]);

            return reply.send({ message: "Espaço excluído permanentemente." });
        } catch (error) {
            app.log.error(error);
            return reply.status(500).send({ error: "Erro ao excluir espaço" });
        }
    });
}