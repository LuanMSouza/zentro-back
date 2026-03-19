import "@fastify/jwt"

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: { id: number, nome: string } // Formato do que você assinou no login
        user: {
            id: number,
            nome: string
        }
    }
}