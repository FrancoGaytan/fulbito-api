import 'dotenv/config'
import { sendPasswordResetCode } from '../src/services/email.service.js'

// Uso: npx tsx scripts/test-email-reset.ts email@dominio.com [CODIGO]
// Si no se pasa código genera uno simple fijo para ver el correo.

const email = process.argv[2] || 'admin@example.com'
const code = process.argv[3] || '999999'
const ttl = Number(process.env.RESET_CODE_TTL_MINUTES || 15)

async function main() {
  console.log('> Enviando reset code de prueba...')
  await sendPasswordResetCode({ email, code, ttlMinutes: ttl })
  console.log('> Listo. Revisá la casilla (o log consola si provider=console).')
}

main().catch(e => {
  console.error('Fallo enviando email:', e)
  process.exit(1)
})
