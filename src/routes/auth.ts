import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import pool from '../db';


interface LoginBody {
    usuario: string;
    senha: string;
}

interface RegisterBody {
    nome: string;
    usuario: string;
    senha: string;
    email: string;
}

export async function authRoutes(app: FastifyInstance) {

    app.post('/registrar', async (request, reply) => {
        const { nome, usuario, senha, email } = request.body as RegisterBody;
        const hash = await bcrypt.hash(senha, 10);

        try {
            const result = await pool.query(
                'INSERT INTO usuarios (nome, usuario, senha, email) VALUES ($1, $2, $3, $4) RETURNING id',
                [nome, usuario, hash, email]
            );
            return reply.code(201).send({ id: result.rows[0].id });
        } catch (err: any) {
            return reply.code(400).send({ error: "Usuário ou email já existem" });
        }
    });

    app.post('/login', async (request, reply) => {
        const { usuario, senha } = request.body as LoginBody;

        console.log('recebendo dados...' + usuario);
        

        const result = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);
        const user = result.rows[0];

        if (!user) {
            return reply.code(401).send({ error: "Usuário não encontrado" });
        }

        const senhaValida = await bcrypt.compare(senha, user.senha);

        if (!senhaValida) {
            return reply.code(401).send({ error: "Senha incorreta" });
        }

        const token = app.jwt.sign({
            id: user.id,
            nome: user.nome
        }, {
            expiresIn: '7d'
        });

        return {
            message: "Logado com sucesso!",
            token,
            id: user.id,
            nome: user.nome,
        };
    });
}