import { FastifyReply, FastifyRequest } from "fastify";

export async function validarJWT(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    console.error("ERRO DETALHADO:", err);
    return reply.status(401).send({ message: 'Token inválido ou mal formatado' });
  }
}