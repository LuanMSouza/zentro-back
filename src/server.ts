import 'dotenv/config';
import fastify from "fastify";
import fastifyJwt from '@fastify/jwt'; // Importe antes das rotas
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth';
import { contasRoutes } from './routes/contas';
import { transacoesRoutes } from './routes/transacoes';
import { configuracoesRoutes } from './routes/configuracoes';

const server = fastify({ logger: true });

const ORIGINS = [
    'https://zentro.dvls.com.br',
    'http://zentro.dvls.com.br',
    'https://controlefinanceirozentro.netlify.app',
    'http://localhost:3000'
]

server.register(cors, {
    origin: ORIGINS,

    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],

    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'token']
})


server.register(fastifyJwt, {
    secret: process.env.JWT_SECRET || 'aaa',
    verify: {
        extractToken: (request) => {
            const authHeader = request.headers.authorization;
            if (!authHeader) return undefined;

            return authHeader.split(' ')[1] || authHeader;
        }
    }
});

server.register(authRoutes, { prefix: '/auth' });
server.register(contasRoutes, { prefix: '/contas' });
server.register(transacoesRoutes, { prefix: '/transacoes' });
server.register(configuracoesRoutes, { prefix: '/configuracoes' });

const start = async () => {
    try {
        await server.listen({ port: 3333, host: '0.0.0.0' });
        console.log("🚀 Servidor rodando em http://localhost:3333");
    } catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};

start();